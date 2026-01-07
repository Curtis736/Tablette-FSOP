const ExcelJS = require('exceljs');
const fs = require('fs/promises');
const path = require('path');

/**
 * Update named ranges in an Excel file with values from a tags object.
 * 
 * @param {string} excelPath - Path to the Excel file
 * @param {Object} tags - Object with tag names as keys and values as values
 * @param {Object} options - Options (retryAttempts, retryDelayMs, lockRetryMs, lockMaxRetries)
 * @returns {Promise<void>}
 */
async function updateExcelNamedRanges(excelPath, tags, options = {}) {
    const {
        retryAttempts = 3,
        retryDelayMs = 2000,
        lockRetryMs = 1000,
        lockMaxRetries = 10
    } = options;

    let attempt = 0;
    let lastError = null;

    while (attempt < retryAttempts) {
        try {
            // Check if file exists
            try {
                await fs.access(excelPath);
            } catch (_) {
                throw new Error(`Excel file not found: ${excelPath}`);
            }

            // Try to open the file (with retry if locked)
            let workbook;
            let lockAttempt = 0;
            
            while (lockAttempt < lockMaxRetries) {
                try {
                    workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.readFile(excelPath);
                    break; // Successfully opened
                } catch (error) {
                    if (error.message && error.message.includes('EBUSY')) {
                        // File is locked, wait and retry
                        lockAttempt++;
                        if (lockAttempt >= lockMaxRetries) {
                            throw new Error(`Excel file is locked after ${lockMaxRetries} attempts: ${excelPath}`);
                        }
                        await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                        continue;
                    }
                    throw error; // Other error, rethrow
                }
            }

            if (!workbook) {
                throw new Error('Failed to open workbook');
            }

            // Update named ranges
            let updatedCount = 0;
            let missingRanges = [];

            for (const [tagName, value] of Object.entries(tags)) {
                try {
                    const namedRange = workbook.definedNames.get(tagName);
                    
                    if (!namedRange) {
                        missingRanges.push(tagName);
                        continue;
                    }

                    // Get the range reference
                    const range = namedRange.ranges[0];
                    if (!range) {
                        console.warn(`Named range "${tagName}" has no range reference`);
                        continue;
                    }

                    // Parse the range (e.g., "Sheet1!$A$1" or "Sheet1!A1:B2")
                    const rangeMatch = range.match(/^([^!]+)!(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?$/);
                    if (!rangeMatch) {
                        console.warn(`Could not parse range for "${tagName}": ${range}`);
                        continue;
                    }

                    const sheetName = rangeMatch[1];
                    const startCell = rangeMatch[2].replace(/\$/g, ''); // Remove $ signs
                    const endCell = rangeMatch[3] ? rangeMatch[3].replace(/\$/g, '') : startCell;

                    const worksheet = workbook.getWorksheet(sheetName);
                    if (!worksheet) {
                        console.warn(`Worksheet "${sheetName}" not found for range "${tagName}"`);
                        continue;
                    }

                    // Update the cell(s)
                    const cell = worksheet.getCell(startCell);
                    cell.value = value;
                    updatedCount++;

                } catch (error) {
                    console.error(`Error updating named range "${tagName}":`, error.message);
                }
            }

            // Save the workbook (with retry if locked)
            lockAttempt = 0;
            while (lockAttempt < lockMaxRetries) {
                try {
                    await workbook.xlsx.writeFile(excelPath);
                    break; // Successfully saved
                } catch (error) {
                    if (error.message && error.message.includes('EBUSY')) {
                        lockAttempt++;
                        if (lockAttempt >= lockMaxRetries) {
                            throw new Error(`Excel file is locked during save after ${lockMaxRetries} attempts`);
                        }
                        await new Promise(resolve => setTimeout(resolve, lockRetryMs));
                        continue;
                    }
                    throw error;
                }
            }

            if (missingRanges.length > 0) {
                console.warn(`Missing named ranges in Excel: ${missingRanges.join(', ')}`);
            }

            console.log(`Updated ${updatedCount} named range(s) in Excel: ${excelPath}`);
            return; // Success

        } catch (error) {
            lastError = error;
            attempt++;
            
            if (attempt < retryAttempts) {
                console.warn(`Attempt ${attempt} failed, retrying in ${retryDelayMs}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
    }

    throw new Error(`Failed to update Excel after ${retryAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Check if an Excel file exists.
 * 
 * @param {string} excelPath - Path to the Excel file
 * @returns {Promise<boolean>}
 */
async function excelFileExists(excelPath) {
    try {
        await fs.access(excelPath);
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    updateExcelNamedRanges,
    excelFileExists
};




