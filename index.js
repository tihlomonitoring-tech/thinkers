import { getPool, query, close } from './src/db.js';

async function main() {
  try {
    await getPool();
    const result = await query('SELECT 1 AS value');
    console.log('Database connected. Sample query result:', result.recordset);
  } catch (err) {
    console.error('Database error:', err.message);
    if (err.code) console.error('Error code:', err.code);
    if (err.precedingErrors?.length) err.precedingErrors.forEach((e) => console.error('  ', e.message));
    process.exitCode = 1;
  } finally {
    await close();
  }
}

main();
