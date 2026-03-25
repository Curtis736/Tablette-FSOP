const axios = require('axios');

class FactorialService {
    static _baseApiUrl() {
        return (process.env.FACTORIAL_API_BASE_URL || '').replace(/\/+$/, '');
    }

    static isEnabled() {
        return String(process.env.ENABLE_FACTORIAL_AUTOCLOSE || 'true').toLowerCase() === 'true';
    }

    static hasRequiredConfig() {
        return Boolean(process.env.FACTORIAL_API_BASE_URL && process.env.FACTORIAL_API_TOKEN);
    }

    static _buildStatusUrl(operatorId, dateKey) {
        const baseUrl = this._baseApiUrl();
        const template = process.env.FACTORIAL_STATUS_ENDPOINT_TEMPLATE || '/employees/{operatorId}/attendance?date={date}';

        const path = template
            .replace(/\{operatorId\}/g, encodeURIComponent(String(operatorId)))
            .replace(/\{date\}/g, encodeURIComponent(String(dateKey)));

        return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    }

    static _parseDepointed(payload) {
        const candidates = [
            payload?.clocked_out,
            payload?.clockedOut,
            payload?.is_clocked_out,
            payload?.isClockedOut,
            payload?.checked_out,
            payload?.checkedOut,
            payload?.depointed,
            payload?.isDepointed
        ];

        for (const value of candidates) {
            if (typeof value === 'boolean') return value;
        }

        const status = String(payload?.status || payload?.attendance_status || payload?.attendanceStatus || '').toUpperCase();
        if (status) {
            if (['CLOCKED_OUT', 'CHECKED_OUT', 'OFF', 'OUT', 'DEPOINTE', 'DEPOINTE'].includes(status)) return true;
            if (['CLOCKED_IN', 'CHECKED_IN', 'IN', 'WORKING', 'POINTE', 'POINTEE'].includes(status)) return false;
        }

        return null;
    }

    static _extractAttendancePayload(rawData) {
        if (!rawData) return {};
        if (Array.isArray(rawData)) return rawData[0] || {};
        if (Array.isArray(rawData?.data)) return rawData.data[0] || {};
        if (rawData?.data && typeof rawData.data === 'object') return rawData.data;
        return rawData;
    }

    static async getOperatorDepointedStatus(operatorId, dateKey) {
        if (!this.hasRequiredConfig()) {
            return {
                success: false,
                skipped: true,
                reason: 'missing_config',
                depointed: null
            };
        }

        const url = this._buildStatusUrl(operatorId, dateKey);
        const token = process.env.FACTORIAL_API_TOKEN;
        const timeoutMs = Number.parseInt(process.env.FACTORIAL_API_TIMEOUT_MS || '10000', 10) || 10000;

        try {
            const response = await axios.get(url, {
                timeout: timeoutMs,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json'
                }
            });

            const payload = this._extractAttendancePayload(response?.data || {});
            const depointed = this._parseDepointed(payload);

            return {
                success: true,
                skipped: depointed === null,
                reason: depointed === null ? 'unrecognized_payload' : 'ok',
                depointed,
                raw: payload
            };
        } catch (error) {
            return {
                success: false,
                skipped: true,
                reason: 'request_failed',
                depointed: null,
                error: error?.response?.data || error?.message || 'unknown_error'
            };
        }
    }

    static _extractShiftsArray(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw?.data)) return raw.data;
        if (Array.isArray(raw?.shifts)) return raw.shifts;
        if (Array.isArray(raw?.items)) return raw.items;
        return [];
    }

    static _formatEmployeeIdsForQuery(employeeIds) {
        const ids = [...new Set((employeeIds || []).map(v => String(v).trim()).filter(Boolean))];
        return ids.join(',');
    }

    static async getOpenShifts(employeeIds) {
        if (!this.hasRequiredConfig()) {
            return { success: false, skipped: true, reason: 'missing_config', shifts: [] };
        }

        const openShiftsPath = process.env.FACTORIAL_OPEN_SHIFTS_PATH || '/resources/attendance/open_shifts';
        const url = `${this._baseApiUrl()}${openShiftsPath.startsWith('/') ? openShiftsPath : `/${openShiftsPath}`}`;

        const employeeIdsParam = process.env.FACTORIAL_OPEN_SHIFTS_EMPLOYEE_IDS_PARAM || 'employee_ids';
        const timeoutMs = Number.parseInt(process.env.FACTORIAL_API_TIMEOUT_MS || '10000', 10) || 10000;
        const token = process.env.FACTORIAL_API_TOKEN;

        try {
            const response = await axios.get(url, {
                timeout: timeoutMs,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json'
                },
                params: {
                    [employeeIdsParam]: this._formatEmployeeIdsForQuery(employeeIds)
                }
            });

            return {
                success: true,
                shifts: this._extractShiftsArray(response?.data || {})
            };
        } catch (error) {
            return {
                success: false,
                skipped: true,
                reason: 'request_failed',
                shifts: [],
                error: error?.response?.data || error?.message || 'unknown_error'
            };
        }
    }

    static async getShifts(employeeIds, { fromAt, toAt } = {}) {
        if (!this.hasRequiredConfig()) {
            return { success: false, skipped: true, reason: 'missing_config', shifts: [] };
        }

        const shiftsPath = process.env.FACTORIAL_SHIFTS_PATH || '/resources/attendance/shifts';
        const url = `${this._baseApiUrl()}${shiftsPath.startsWith('/') ? shiftsPath : `/${shiftsPath}`}`;

        const employeeIdsParam = process.env.FACTORIAL_SHIFTS_EMPLOYEE_IDS_PARAM || 'employee_ids';
        const fromParam = process.env.FACTORIAL_SHIFTS_FROM_PARAM || 'start_at';
        const toParam = process.env.FACTORIAL_SHIFTS_TO_PARAM || 'end_at';
        const timeoutMs = Number.parseInt(process.env.FACTORIAL_API_TIMEOUT_MS || '10000', 10) || 10000;
        const token = process.env.FACTORIAL_API_TOKEN;

        const params = {
            [employeeIdsParam]: this._formatEmployeeIdsForQuery(employeeIds)
        };

        if (fromAt) params[fromParam] = new Date(fromAt).toISOString();
        if (toAt) params[toParam] = new Date(toAt).toISOString();

        try {
            const response = await axios.get(url, {
                timeout: timeoutMs,
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/json'
                },
                params
            });

            return {
                success: true,
                shifts: this._extractShiftsArray(response?.data || {})
            };
        } catch (error) {
            return {
                success: false,
                skipped: true,
                reason: 'request_failed',
                shifts: [],
                error: error?.response?.data || error?.message || 'unknown_error'
            };
        }
    }
}

module.exports = FactorialService;
