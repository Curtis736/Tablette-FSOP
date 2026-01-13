import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readTemplatesFromExcel } from '../services/fsopTemplatesExcelService.js';
import ExcelJS from 'exceljs';

// Mock ExcelJS
vi.mock('exceljs', () => {
    return {
        default: {
            Workbook: vi.fn()
        }
    };
});

describe('FSOP Templates Excel Service', () => {
    let mockWorkbook;
    let mockWorksheet;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Setup mock worksheet
        mockWorksheet = {
            getRow: vi.fn(),
            rowCount: 10
        };

        // Setup mock workbook
        mockWorkbook = {
            getWorksheet: vi.fn(() => mockWorksheet),
            worksheets: [mockWorksheet],
            xlsx: {
                readFile: vi.fn().mockResolvedValue(undefined)
            }
        };

        // Mock Workbook constructor
        ExcelJS.Workbook.mockImplementation(function() {
            return mockWorkbook;
        });
    });

    it('should throw error when Excel file is not accessible', async () => {
        mockWorkbook.xlsx.readFile.mockRejectedValue(new Error('File not found'));

        await expect(
            readTemplatesFromExcel('nonexistent.xlsx')
        ).rejects.toThrow('TEMPLATES_SOURCE_UNAVAILABLE');
    });

    it('should throw error when no worksheet found', async () => {
        mockWorkbook.getWorksheet.mockReturnValue(null);
        mockWorkbook.worksheets = [];

        await expect(
            readTemplatesFromExcel('test.xlsx')
        ).rejects.toThrow('TEMPLATES_PARSE_FAILED');
    });

    it('should throw error when header row is not found', async () => {
        // Mock rows that don't contain headers
        const mockRow = {
            eachCell: vi.fn((callback) => {
                // Return empty cells
            })
        };
        mockWorksheet.getRow.mockReturnValue(mockRow);
        mockWorksheet.rowCount = 5;

        await expect(
            readTemplatesFromExcel('test.xlsx')
        ).rejects.toThrow('TEMPLATES_PARSE_FAILED');
    });

    it('should successfully parse templates from Excel', async () => {
        // Mock header row (row 3)
        const headerRow = {
            eachCell: vi.fn((opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                callback({ value: 'N°' }, 1); // Column B (index 1)
                callback({ value: 'Désignation' }, 2); // Column C (index 2)
                callback({ value: 'Processus' }, 3); // Column D (index 3)
            })
        };

        // Mock data rows
        const dataRow1 = {
            getCell: vi.fn((colIndex) => {
                if (colIndex === 1) return { value: 'F00' };
                if (colIndex === 2) return { value: 'Fiche processus' };
                if (colIndex === 3) return { value: 'M2 - Qualité et Gestion des risques' };
                return { value: '' };
            })
        };

        const dataRow2 = {
            getCell: vi.fn((colIndex) => {
                if (colIndex === 1) return { value: 'F01' };
                if (colIndex === 2) return { value: 'Rapport d\'audit interne' };
                if (colIndex === 3) return { value: 'M2 - Qualité et Gestion des risques' };
                return { value: '' };
            })
        };

        mockWorksheet.getRow.mockImplementation((rowNum) => {
            if (rowNum === 3) return headerRow;
            if (rowNum === 4) return dataRow1;
            if (rowNum === 5) return dataRow2;
            return { getCell: () => ({ value: '' }) };
        });
        mockWorksheet.rowCount = 5;

        const result = await readTemplatesFromExcel('test.xlsx');

        expect(result).toHaveProperty('source', 'test.xlsx');
        expect(result).toHaveProperty('count', 2);
        expect(result.templates).toHaveLength(2);
        expect(result.templates[0]).toEqual({
            code: 'F00',
            designation: 'Fiche processus',
            processus: 'M2 - Qualité et Gestion des risques'
        });
        expect(result.templates[1]).toEqual({
            code: 'F01',
            designation: 'Rapport d\'audit interne',
            processus: 'M2 - Qualité et Gestion des risques'
        });
    });

    it('should skip empty rows', async () => {
        const headerRow = {
            eachCell: vi.fn((opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                callback({ value: 'N°' }, 1);
                callback({ value: 'Désignation' }, 2);
                callback({ value: 'Processus' }, 3);
            })
        };

        const dataRow1 = {
            getCell: vi.fn((colIndex) => {
                if (colIndex === 1) return { value: 'F00' };
                if (colIndex === 2) return { value: 'Test' };
                if (colIndex === 3) return { value: 'Process' };
                return { value: '' };
            })
        };

        const emptyRow = {
            getCell: vi.fn(() => ({ value: '' }))
        };

        mockWorksheet.getRow.mockImplementation((rowNum) => {
            if (rowNum === 3) return headerRow;
            if (rowNum === 4) return dataRow1;
            if (rowNum === 5) return emptyRow;
            return { getCell: () => ({ value: '' }) };
        });
        mockWorksheet.rowCount = 5;

        const result = await readTemplatesFromExcel('test.xlsx');

        expect(result.count).toBe(1);
        expect(result.templates).toHaveLength(1);
    });

    it('should deduplicate templates by code', async () => {
        const headerRow = {
            eachCell: vi.fn((opts, cb) => {
                const callback = typeof opts === 'function' ? opts : cb;
                callback({ value: 'N°' }, 1);
                callback({ value: 'Désignation' }, 2);
                callback({ value: 'Processus' }, 3);
            })
        };

        const dataRow1 = {
            getCell: vi.fn((colIndex) => {
                if (colIndex === 1) return { value: 'F00' };
                if (colIndex === 2) return { value: 'First' };
                if (colIndex === 3) return { value: 'Process' };
                return { value: '' };
            })
        };

        const dataRow2 = {
            getCell: vi.fn((colIndex) => {
                if (colIndex === 1) return { value: 'F00' }; // Duplicate code
                if (colIndex === 2) return { value: 'Second' };
                if (colIndex === 3) return { value: 'Process' };
                return { value: '' };
            })
        };

        mockWorksheet.getRow.mockImplementation((rowNum) => {
            if (rowNum === 3) return headerRow;
            if (rowNum === 4) return dataRow1;
            if (rowNum === 5) return dataRow2;
            return { getCell: () => ({ value: '' }) };
        });
        mockWorksheet.rowCount = 5;

        const result = await readTemplatesFromExcel('test.xlsx');

        expect(result.count).toBe(1);
        expect(result.templates).toHaveLength(1);
        expect(result.templates[0].designation).toBe('First'); // First occurrence kept
    });
});

