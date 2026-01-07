/**
 * Simple test script to verify tag extraction and Excel update.
 * Usage: node test.js <path-to-fsop.docx> <path-to-excel.xlsx>
 */

const { extractTagsFromDocx } = require('./lib/docxTags');
const { updateExcelNamedRanges } = require('./lib/excelNamedRanges');

async function test() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.error('Usage: node test.js <path-to-fsop.docx> [path-to-excel.xlsx]');
        process.exit(1);
    }
    
    const docxPath = args[0];
    const excelPath = args[1];
    
    console.log(`Extracting tags from: ${docxPath}`);
    
    try {
        const tags = await extractTagsFromDocx(docxPath);
        console.log('Extracted tags:', tags);
        
        if (excelPath) {
            console.log(`\nUpdating Excel: ${excelPath}`);
            await updateExcelNamedRanges(excelPath, tags);
            console.log('Excel updated successfully!');
        } else {
            console.log('\nNo Excel path provided, skipping Excel update.');
        }
    } catch (error) {
        console.error('Error:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
        process.exit(1);
    }
}

test();




