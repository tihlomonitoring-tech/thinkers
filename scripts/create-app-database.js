#!/usr/bin/env node
/**
 * Create application database on SQL Server (e.g. RDS). Connects to `master`, then CREATE DATABASE.
 * Usage: APP_DB_NAME=thinkers node scripts/create-app-database.js
 * Requires same env as src/db.js (AWS_SQL_* or AZURE_SQL_*).
 */
import 'dotenv/config';
import sql from 'mssql';

const firstNonEmpty = (...values) => values.find((v) => typeof v === 'string' && v.trim().length > 0);

const dbName = (process.env.APP_DB_NAME || 'thinkers').trim();
if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
  console.error('APP_DB_NAME must be alphanumeric/underscore only.');
  process.exit(1);
}

const server = firstNonEmpty(process.env.AWS_SQL_SERVER, process.env.AZURE_SQL_SERVER);
const user = firstNonEmpty(process.env.AWS_SQL_USER, process.env.AZURE_SQL_USER);
const password = firstNonEmpty(process.env.AWS_SQL_PASSWORD, process.env.AZURE_SQL_PASSWORD);
const port = parseInt(firstNonEmpty(process.env.AWS_SQL_PORT, process.env.AZURE_SQL_PORT, '1433'), 10);
const trustCert =
  process.env.AWS_SQL_TRUST_SERVER_CERTIFICATE === 'true' ||
  process.env.AWS_SQL_TRUST_SERVER_CERTIFICATE === '1';

if (!server || !user || !password) {
  console.error('Set AWS_SQL_SERVER, AWS_SQL_USER, AWS_SQL_PASSWORD (or AZURE_* equivalents).');
  process.exit(1);
}

const config = {
  user,
  password,
  server,
  port,
  database: 'master',
  options: {
    encrypt: true,
    trustServerCertificate: trustCert,
  },
};

const pool = await sql.connect(config);
try {
  const check = await pool
    .request()
    .input('name', dbName)
    .query(`SELECT name FROM sys.databases WHERE name = @name`);
  if (check.recordset.length > 0) {
    console.log(`Database "${dbName}" already exists.`);
  } else {
    await pool.request().query(`CREATE DATABASE [${dbName}]`);
    console.log(`Created database "${dbName}".`);
  }
} finally {
  await pool.close();
}

console.log(`Set AWS_SQL_DATABASE=${dbName} in .env and run migrations.`);
