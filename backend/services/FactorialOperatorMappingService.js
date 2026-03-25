const { executeQuery } = require('../config/database');

class FactorialOperatorMappingService {
    static _normalize(value) {
        return String(value || '').trim();
    }

    static async getAllMappings({ activeOnly = false } = {}) {
        const whereClause = activeOnly ? 'WHERE m.IsActive = 1' : '';
        const query = `
            SELECT
                m.OperatorCode,
                m.FactorialEmployeeId,
                m.IsActive,
                m.CreatedAt,
                m.UpdatedAt
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_OPERATOR_MAPPING] m
            ${whereClause}
            ORDER BY m.OperatorCode ASC
        `;
        return executeQuery(query);
    }

    static async getMappingByOperatorCode(operatorCode) {
        const normalized = this._normalize(operatorCode);
        if (!normalized) return null;

        const rows = await executeQuery(
            `
            SELECT TOP 1
                OperatorCode,
                FactorialEmployeeId,
                IsActive,
                CreatedAt,
                UpdatedAt
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
            WHERE OperatorCode = @operatorCode
            `,
            { operatorCode: normalized }
        );

        return rows?.[0] || null;
    }

    static async getMappingsByOperatorCodes(operatorCodes = []) {
        const cleaned = [...new Set((operatorCodes || []).map(v => this._normalize(v)).filter(Boolean))];
        if (cleaned.length === 0) return {};

        const params = {};
        const placeholders = cleaned.map((code, index) => {
            const key = `operatorCode${index}`;
            params[key] = code;
            return `@${key}`;
        });

        const rows = await executeQuery(
            `
            SELECT
                OperatorCode,
                FactorialEmployeeId,
                IsActive
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
            WHERE OperatorCode IN (${placeholders.join(', ')})
              AND IsActive = 1
            `,
            params
        );

        return rows.reduce((acc, row) => {
            acc[String(row.OperatorCode).trim()] = row;
            return acc;
        }, {});
    }

    static async getOperatorCodesByFactorialEmployeeIds(factorialEmployeeIds = []) {
        const cleaned = [...new Set((factorialEmployeeIds || []).map(v => this._normalize(v)).filter(Boolean))];
        if (cleaned.length === 0) return {};

        const params = {};
        const placeholders = cleaned.map((id, index) => {
            const key = `factorialEmployeeId${index}`;
            params[key] = id;
            return `@${key}`;
        });

        const rows = await executeQuery(
            `
            SELECT FactorialEmployeeId, OperatorCode
            FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
            WHERE FactorialEmployeeId IN (${placeholders.join(', ')})
              AND IsActive = 1
            `,
            params
        );

        return rows.reduce((acc, row) => {
            const fid = String(row.FactorialEmployeeId).trim();
            const op = String(row.OperatorCode).trim();
            if (!acc[fid]) acc[fid] = [];
            acc[fid].push(op);
            return acc;
        }, {});
    }

    static async upsertMapping({ operatorCode, factorialEmployeeId, isActive = true }) {
        const normalizedOperatorCode = this._normalize(operatorCode);
        const normalizedFactorialId = this._normalize(factorialEmployeeId);

        if (!normalizedOperatorCode) {
            throw new Error('OPERATOR_CODE_REQUIRED');
        }
        if (!normalizedFactorialId) {
            throw new Error('FACTORIAL_EMPLOYEE_ID_REQUIRED');
        }

        await executeQuery(
            `
            MERGE [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_OPERATOR_MAPPING] AS target
            USING (
                SELECT
                    @operatorCode AS OperatorCode,
                    @factorialEmployeeId AS FactorialEmployeeId,
                    @isActive AS IsActive
            ) AS source
            ON target.OperatorCode = source.OperatorCode
            WHEN MATCHED THEN
                UPDATE SET
                    target.FactorialEmployeeId = source.FactorialEmployeeId,
                    target.IsActive = source.IsActive,
                    target.UpdatedAt = GETDATE()
            WHEN NOT MATCHED THEN
                INSERT (OperatorCode, FactorialEmployeeId, IsActive, CreatedAt, UpdatedAt)
                VALUES (source.OperatorCode, source.FactorialEmployeeId, source.IsActive, GETDATE(), GETDATE());
            `,
            {
                operatorCode: normalizedOperatorCode,
                factorialEmployeeId: normalizedFactorialId,
                isActive: isActive ? 1 : 0
            }
        );

        return this.getMappingByOperatorCode(normalizedOperatorCode);
    }

    static async deleteMapping(operatorCode) {
        const normalized = this._normalize(operatorCode);
        if (!normalized) {
            throw new Error('OPERATOR_CODE_REQUIRED');
        }

        await executeQuery(
            `
            DELETE FROM [SEDI_APP_INDEPENDANTE].[dbo].[AB_FACTORIAL_OPERATOR_MAPPING]
            WHERE OperatorCode = @operatorCode
            `,
            { operatorCode: normalized }
        );
    }
}

module.exports = FactorialOperatorMappingService;
