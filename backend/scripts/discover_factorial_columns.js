const { executeQuery } = require('../config/database');

async function main() {
    const query = `
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
        FROM [SEDI_APP_INDEPENDANTE].INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME LIKE '%Factorial%'
           OR COLUMN_NAME LIKE '%EmployeeId%'
           OR COLUMN_NAME LIKE '%Operateur%'
           OR COLUMN_NAME LIKE '%Operator%'
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
    `;

    const rows = await executeQuery(query);
    console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
