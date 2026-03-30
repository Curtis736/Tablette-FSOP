const { executeQuery, executeNonQuery } = require('../config/database');
const FactorialService = require('./FactorialService');

class FactorialShiftSyncService {
    static _isUniqueConstraintViolation(error) {
        const n = error?.number ?? error?.originalError?.number;
        return n === 2601 || n === 2627;
    }

    static _eventLookupKey(e) {
        return `${String(e.FactorialEmployeeId).trim()}|${String(e.ShiftId).trim()}|${String(e.EventType).trim()}`;
    }

    static async _loadExistingEventKeysSet(events) {
        const tuples = events
            .filter(ev => ev?.FactorialEmployeeId && ev?.ShiftId && ev?.EventType)
            .map(ev => ({
                FactorialEmployeeId: ev.FactorialEmployeeId,
                ShiftId: ev.ShiftId,
                EventType: ev.EventType
            }));
        if (tuples.length === 0) return new Set();

        const keysJson = JSON.stringify(tuples);
        const rows = await executeQuery(
            `
            SELECT ce.FactorialEmployeeId, ce.ShiftId, ce.EventType
            FROM OPENJSON(@keysJson) WITH (
                FactorialEmployeeId NVARCHAR(100) '$.FactorialEmployeeId',
                ShiftId NVARCHAR(100) '$.ShiftId',
                EventType NVARCHAR(3) '$.EventType'
            ) j
            INNER JOIN [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_CLOCK_EVENTS] ce
              ON ce.FactorialEmployeeId = j.FactorialEmployeeId
             AND ce.ShiftId = j.ShiftId
             AND ce.EventType = j.EventType
            `,
            { keysJson }
        );

        const set = new Set();
        for (const row of rows || []) {
            set.add(this._eventLookupKey(row));
        }
        return set;
    }

    static _toDate(value) {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return null;
        return d;
    }

    static _pickFirst(shift, keys) {
        for (const k of keys) {
            const v = shift?.[k];
            if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return null;
    }

    static _extractShiftId(shift) {
        const v =
            this._pickFirst(shift, ['id', 'shift_id', 'shiftId', 'uuid', 'attendance_shift_id', 'attendance_shift_uuid']) ??
            null;
        return v ? String(v).trim() : null;
    }

    static _extractEmployeeId(shift) {
        const v =
            this._pickFirst(shift, ['employee_id', 'employeeId', 'employeeID']) ??
            null;
        return v ? String(v).trim() : null;
    }

    static _extractClockInAt(shift) {
        const v =
            this._pickFirst(shift, [
                'clock_in_at',
                'clockInAt',
                'clocked_in_at',
                'clockedInAt',
                'clocked_in',
                'clock_in'
            ]) ??
            null;
        return this._toDate(v);
    }

    static _extractClockOutAt(shift) {
        const v =
            this._pickFirst(shift, [
                'clock_out_at',
                'clockOutAt',
                'clocked_out_at',
                'clockedOutAt',
                'clocked_out',
                'clock_out'
            ]) ??
            null;
        return this._toDate(v);
    }

    static _eventAtFromShift(shift, eventType) {
        if (eventType === 'IN') return this._extractClockInAt(shift);
        return this._extractClockOutAt(shift);
    }

    static _buildEventTypeEventsForShift(shift) {
        const factorialEmployeeId = this._extractEmployeeId(shift);
        const shiftId = this._extractShiftId(shift);
        if (!factorialEmployeeId || !shiftId) return [];

        const events = [];

        const clockInAt = this._extractClockInAt(shift);
        if (clockInAt) {
            events.push({
                FactorialEmployeeId: factorialEmployeeId,
                ShiftId: shiftId,
                EventType: 'IN',
                EventAt: clockInAt,
                RawPayload: JSON.stringify(shift)
            });
        }

        const clockOutAt = this._extractClockOutAt(shift);
        if (clockOutAt) {
            events.push({
                FactorialEmployeeId: factorialEmployeeId,
                ShiftId: shiftId,
                EventType: 'OUT',
                EventAt: clockOutAt,
                RawPayload: JSON.stringify(shift)
            });
        }

        return events;
    }

    static async _getPollStateForEmployees(factorialEmployeeIds) {
        const cleaned = [...new Set((factorialEmployeeIds || []).map(v => String(v).trim()).filter(Boolean))];
        if (cleaned.length === 0) return {};

        const params = {};
        const placeholders = cleaned.map((id, index) => {
            const key = `employeeId${index}`;
            params[key] = id;
            return `@${key}`;
        });

        const rows = await executeQuery(
            `
            SELECT FactorialEmployeeId,
                   LastProcessedClockInAt,
                   LastProcessedClockOutAt,
                   LastProcessedShiftId
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_POLL_STATE]
            WHERE FactorialEmployeeId IN (${placeholders.join(', ')})
            `,
            params
        );

        return rows.reduce((acc, row) => {
            acc[String(row.FactorialEmployeeId).trim()] = row;
            return acc;
        }, {});
    }

    static async _upsertPollStateForEmployees(updates) {
        for (const u of updates) {
            await executeNonQuery(
                `
                MERGE [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_POLL_STATE] AS target
                USING (SELECT
                    @factorialEmployeeId AS FactorialEmployeeId,
                    @lastInAt AS LastProcessedClockInAt,
                    @lastOutAt AS LastProcessedClockOutAt,
                    @lastShiftId AS LastProcessedShiftId
                ) AS source
                ON target.FactorialEmployeeId = source.FactorialEmployeeId
                WHEN MATCHED THEN
                    UPDATE SET
                        LastProcessedClockInAt = COALESCE(source.LastProcessedClockInAt, target.LastProcessedClockInAt),
                        LastProcessedClockOutAt = COALESCE(source.LastProcessedClockOutAt, target.LastProcessedClockOutAt),
                        LastProcessedShiftId = COALESCE(source.LastProcessedShiftId, target.LastProcessedShiftId),
                        UpdatedAt = GETDATE()
                WHEN NOT MATCHED THEN
                    INSERT (FactorialEmployeeId, LastProcessedClockInAt, LastProcessedClockOutAt, LastProcessedShiftId, UpdatedAt)
                    VALUES (source.FactorialEmployeeId, source.LastProcessedClockInAt, source.LastProcessedClockOutAt, source.LastProcessedShiftId, GETDATE());
                `,
                u
            );
        }
    }

    static async sync({ factorialEmployeeIds, lookbackDays = 2, rawRetentionDays = 30 } = {}) {
        const cleaned = [...new Set((factorialEmployeeIds || []).map(v => String(v).trim()).filter(Boolean))];
        if (cleaned.length === 0) {
            return { success: true, checkedEmployees: 0, insertedOutEvents: [], insertedInEvents: 0, skipped: true, reason: 'no_employees' };
        }

        const now = new Date();
        const fromAt = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

        const pollStateByEmployee = await this._getPollStateForEmployees(cleaned);

        const openResp = await FactorialService.getOpenShifts(cleaned);
        const openOk = openResp?.success === true;
        const openShifts = openOk ? openResp.shifts : [];

        const shiftsResp = await FactorialService.getShifts(cleaned, { fromAt, toAt: now });
        const shiftsOk = shiftsResp?.success === true;
        const shifts = shiftsOk ? shiftsResp.shifts : [];

        const openErr = openOk ? null : openResp?.error ?? openResp?.reason ?? 'request_failed';
        const shiftsErr = shiftsOk ? null : shiftsResp?.error ?? shiftsResp?.reason ?? 'request_failed';

        if (!openOk && !shiftsOk) {
            return {
                success: false,
                skipped: false,
                reason: 'factorial_api_failed',
                apiErrors: { openShifts: openErr, shifts: shiftsErr },
                partialApiFailure: false,
                apiPartialDetails: null,
                checkedEmployees: cleaned.length,
                insertedOutEvents: [],
                insertedInEvents: 0
            };
        }

        const partialApiFailure = !openOk || !shiftsOk;
        const apiPartialDetails = partialApiFailure
            ? {
                  openShiftsOk: openOk,
                  shiftsOk,
                  ...(openOk ? {} : { openShiftsError: openErr }),
                  ...(shiftsOk ? {} : { shiftsError: shiftsErr })
              }
            : null;

        const allEvents = [
            ...openShifts.flatMap(s => this._buildEventTypeEventsForShift(s)),
            ...shifts.flatMap(s => this._buildEventTypeEventsForShift(s))
        ];

        const seen = new Set();
        const events = [];
        for (const e of allEvents) {
            if (!e?.FactorialEmployeeId || !e?.ShiftId || !e?.EventType || !e?.EventAt) continue;
            const key = `${e.FactorialEmployeeId}|${e.ShiftId}|${e.EventType}`;
            if (seen.has(key)) continue;
            seen.add(key);
            events.push(e);
        }

        const insertedOutEvents = [];
        let insertedInEvents = 0;

        const existingKeys = await this._loadExistingEventKeysSet(events);

        for (const e of events) {
            const prev = pollStateByEmployee[String(e.FactorialEmployeeId).trim()] || null;
            const prevOut = prev?.LastProcessedClockOutAt ? new Date(prev.LastProcessedClockOutAt) : null;
            const prevIn = prev?.LastProcessedClockInAt ? new Date(prev.LastProcessedClockInAt) : null;

            const isNewByState = (() => {
                if (e.EventType === 'OUT') {
                    return !prevOut || e.EventAt > prevOut;
                }
                return !prevIn || e.EventAt > prevIn;
            })();

            const lookupKey = this._eventLookupKey(e);
            if (existingKeys.has(lookupKey)) continue;

            try {
                await executeNonQuery(
                    `
                INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_CLOCK_EVENTS]
                    (FactorialEmployeeId, ShiftId, EventType, EventAt, RawPayload)
                VALUES
                    (@FactorialEmployeeId, @ShiftId, @EventType, @EventAt, @RawPayload)
                `,
                    {
                        FactorialEmployeeId: e.FactorialEmployeeId,
                        ShiftId: e.ShiftId,
                        EventType: e.EventType,
                        EventAt: e.EventAt,
                        RawPayload: e.RawPayload
                    }
                );
            } catch (err) {
                if (this._isUniqueConstraintViolation(err)) {
                    existingKeys.add(lookupKey);
                    continue;
                }
                throw err;
            }

            existingKeys.add(lookupKey);

            if (e.EventType === 'IN') insertedInEvents += 1;
            if (e.EventType === 'OUT' && isNewByState) {
                insertedOutEvents.push({
                    FactorialEmployeeId: e.FactorialEmployeeId,
                    ShiftId: e.ShiftId,
                    EventAt: e.EventAt
                });
            }
        }

        const updatesByEmployee = new Map();
        for (const outE of insertedOutEvents) {
            const id = outE.FactorialEmployeeId;
            const curr = updatesByEmployee.get(id) || {
                FactorialEmployeeId: id,
                lastIn: null,
                lastOut: null,
                lastShiftId: null
            };
            curr.lastOut = curr.lastOut ? new Date(Math.max(curr.lastOut.getTime(), outE.EventAt.getTime())) : outE.EventAt;
            curr.lastShiftId = outE.ShiftId;
            updatesByEmployee.set(id, curr);
        }

        if (insertedInEvents > 0) {
            const employeesWithMaybeIn = cleaned;
            const inRows = await executeQuery(
                `
                SELECT FactorialEmployeeId, MAX(CASE WHEN EventType='IN' THEN EventAt ELSE NULL END) AS MaxInAt
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_CLOCK_EVENTS]
                WHERE FactorialEmployeeId IN (${employeesWithMaybeIn.map((_, i) => `@empIn${i}`).join(', ')})
                GROUP BY FactorialEmployeeId
                `,
                employeesWithMaybeIn.reduce((acc, id, i) => {
                    acc[`empIn${i}`] = id;
                    return acc;
                }, {})
            );

            for (const row of inRows) {
                const id = String(row.FactorialEmployeeId).trim();
                const maxInAt = row.MaxInAt ? new Date(row.MaxInAt) : null;
                const curr = updatesByEmployee.get(id) || {
                    FactorialEmployeeId: id,
                    lastIn: null,
                    lastOut: null,
                    lastShiftId: null
                };
                curr.lastIn = maxInAt || curr.lastIn;
                updatesByEmployee.set(id, curr);
            }
        }

        const updates = [...updatesByEmployee.values()].map(x => ({
            factorialEmployeeId: x.FactorialEmployeeId,
            lastInAt: x.lastIn || null,
            lastOutAt: x.lastOut || null,
            lastShiftId: x.lastShiftId || null
        }));

        if (updates.length > 0) {
            await this._upsertPollStateForEmployees(updates);
        }

        const retentionDays = Number.parseInt(process.env.FACTORIAL_RAW_PAYLOAD_RETENTION_DAYS || rawRetentionDays || '30', 10) || 30;
        await executeNonQuery(
            `
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_CLOCK_EVENTS]
            WHERE CreatedAt < DATEADD(day, -@retentionDays, GETDATE())
            `,
            { retentionDays }
        );

        return {
            success: true,
            checkedEmployees: cleaned.length,
            insertedOutEvents,
            insertedInEvents,
            skipped: false,
            reason: 'ok',
            partialApiFailure,
            apiPartialDetails
        };
    }
}

module.exports = FactorialShiftSyncService;
