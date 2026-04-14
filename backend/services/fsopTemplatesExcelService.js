const path = require('path');

// Use dynamic import so Vitest's ESM mocking can intercept `exceljs` reliably
// even when this service is consumed from a CommonJS codebase.
let _ExcelJS = null;
async function getExcelJS() {
    if (_ExcelJS) return _ExcelJS;
    const mod = await import('exceljs');
    _ExcelJS = mod && mod.default ? mod.default : mod;
    return _ExcelJS;
}

/**
 * Read templates list from Excel file.
 * Expected structure:
 * - First sheet (or sheet named "Liste des formulaires")
 * - Headers in row 3: "N°", "Désignation", "Processus"
 * - Data rows below
 * 
 * @param {string} excelPath - Path to the Excel file
 * @returns {Promise<{source: string, count: number, templates: Array<{code: string, designation: string, processus: string}>}>}
 */
async function readTemplatesFromExcel(excelPath) {
    try {
        // Open workbook
        const ExcelJS = await getExcelJS();
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.readFile(excelPath);
        } catch (error) {
            const errorMsg = `TEMPLATES_SOURCE_UNAVAILABLE: Excel file not found or not accessible: ${excelPath}`;
            console.error(`❌ ${errorMsg}`);
            console.error(`💡 Vérifiez que le fichier existe et que le chemin est correct.`);
            console.error(`💡 Vous pouvez définir FSOP_TEMPLATES_XLSX_PATH dans votre fichier .env`);
            throw new Error(errorMsg);
        }

        // Always use the dedicated master sheet as source of truth.
        // This avoids accidentally reading another sheet with a similar layout.
        const requiredSheetName = String(process.env.FSOP_TEMPLATES_SHEET || 'Liste des formulaires').trim();
        let worksheet = workbook.getWorksheet(requiredSheetName);
        if (!worksheet) {
            const lower = requiredSheetName.toLowerCase();
            worksheet = workbook.worksheets.find(ws => String(ws?.name || '').trim().toLowerCase() === lower);
        }

        if (!worksheet) {
            throw new Error(`TEMPLATES_PARSE_FAILED: Worksheet "${requiredSheetName}" not found in Excel file`);
        }

        // Find header row (look for "N°", "Désignation", "Processus")
        let headerRowIndex = null;
        let codeColIndex = null;
        let designationColIndex = null;
        let processusColIndex = null;

        // Search from row 1 to row 10 for headers
        for (let rowNum = 1; rowNum <= 10; rowNum++) {
            const row = worksheet.getRow(rowNum);
            if (!row || typeof row.eachCell !== 'function') {
                continue;
            }
            const rowValues = [];
            
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const value = cell.value ? String(cell.value).trim() : '';
                rowValues[colNumber] = value;
            });

            // Check if this row contains our headers
            const hasCodeHeader = rowValues.some(v => v && /^N[°\s]*$/i.test(v));
            const hasDesignationHeader = rowValues.some(v => v && /^D[éée]signation$/i.test(v));
            const hasProcessusHeader = rowValues.some(v => v && /^Processus$/i.test(v));

            if (hasCodeHeader && hasDesignationHeader && hasProcessusHeader) {
                headerRowIndex = rowNum;
                
                // Find column indices
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    const value = cell.value ? String(cell.value).trim() : '';
                    if (/^N[°\s]*$/i.test(value)) {
                        codeColIndex = colNumber;
                    } else if (/^D[éée]signation$/i.test(value)) {
                        designationColIndex = colNumber;
                    } else if (/^Processus$/i.test(value)) {
                        processusColIndex = colNumber;
                    }
                });
                break;
            }
        }

        if (!headerRowIndex || !codeColIndex || !designationColIndex || !processusColIndex) {
            throw new Error('TEMPLATES_PARSE_FAILED: Could not find header row with columns "N°", "Désignation", "Processus"');
        }

        // Read data rows
        const templates = [];
        const seenCodes = new Set();
        const totalRows = worksheet.rowCount;

        for (let rowNum = headerRowIndex + 1; rowNum <= totalRows; rowNum++) {
            const row = worksheet.getRow(rowNum);
            
            const codeCell = row.getCell(codeColIndex);
            const designationCell = row.getCell(designationColIndex);
            const processusCell = row.getCell(processusColIndex);

            // Extract values
            const code = codeCell.value ? String(codeCell.value).trim() : '';
            const designation = designationCell.value ? String(designationCell.value).trim() : '';
            const processus = processusCell.value ? String(processusCell.value).trim() : '';

            // Skip empty rows
            if (!code && !designation && !processus) {
                continue;
            }

            // Skip if code is empty (invalid row)
            if (!code) {
                continue;
            }

            // Deduplicate by code (keep first occurrence)
            if (seenCodes.has(code)) {
                continue;
            }
            seenCodes.add(code);

            templates.push({
                code,
                designation,
                processus
            });
        }

        return {
            source: excelPath,
            sheet: worksheet.name || requiredSheetName,
            count: templates.length,
            templates
        };

    } catch (error) {
        if (error.message.includes('TEMPLATES_SOURCE_UNAVAILABLE') || error.message.includes('TEMPLATES_PARSE_FAILED')) {
            throw error;
        }
        throw new Error(`TEMPLATES_PARSE_FAILED: ${error.message}`);
    }
}

module.exports = {
    readTemplatesFromExcel
};

