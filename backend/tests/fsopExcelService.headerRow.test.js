import { describe, expect, it } from 'vitest';

const svc = require('../services/fsopExcelService');

// Minimal worksheet mock compatible with our functions (getRow / rowCount / cells)
function makeWorksheet(rows) {
    return {
        rowCount: rows.length,
        getRow: (idx) => {
            const arr = rows[idx - 1] || [];
            return {
                cellCount: arr.length,
                getCell: (col) => ({
                    value: arr[col - 1]
                })
            };
        }
    };
}

describe('fsopExcelService header row detection', () => {
    it('detects header on row 3 when rows 1-2 are titles', () => {
        const ws = makeWorksheet([
            ['', '', 'Suivi des S/N', ''],
            ['', '', 'Plan : 23.199', ''],
            ['Lancement', 'Commande', 'N° de S/N', 'IL 940 nm', 'RL 1310 nm'],
            ['LT2400182', 'AR23-00385', '20-24-01', 0.1, -0.2]
        ]);

        const idx = svc.__test.detectHeaderRowIndex(ws, 10);
        expect(idx).toBe(3);

        const rowIdx = svc.__test.findRowBySerialNumber(ws, '20-24-01', idx);
        expect(rowIdx).toBe(4);

        const colIdx = svc.__test.findColumnByName(ws, 'IL_940', idx);
        expect(colIdx).toBe(4);
    });
});

