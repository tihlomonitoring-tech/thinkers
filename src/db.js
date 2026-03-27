import sql from 'mssql';
import 'dotenv/config';

const firstNonEmpty = (...values) => values.find((v) => typeof v === 'string' && v.trim().length > 0);

const getConfig = () => {
  // SQLSERVER_* = preferred on AWS (many hosts forbid env vars prefixed AWS_).
  // Legacy: AWS_SQL_* then AZURE_SQL_*.
  const server = firstNonEmpty(
    process.env.SQLSERVER_HOST,
    process.env.AWS_SQL_SERVER,
    process.env.AZURE_SQL_SERVER
  );
  const database = firstNonEmpty(
    process.env.SQLSERVER_DATABASE,
    process.env.AWS_SQL_DATABASE,
    process.env.AZURE_SQL_DATABASE
  );
  const user = firstNonEmpty(process.env.SQLSERVER_USER, process.env.AWS_SQL_USER, process.env.AZURE_SQL_USER);
  const password = firstNonEmpty(
    process.env.SQLSERVER_PASSWORD,
    process.env.AWS_SQL_PASSWORD,
    process.env.AZURE_SQL_PASSWORD
  );
  const portRaw = firstNonEmpty(process.env.SQLSERVER_PORT, process.env.AWS_SQL_PORT, process.env.AZURE_SQL_PORT, '1433');
  const connectionString = firstNonEmpty(
    process.env.SQLSERVER_CONNECTION_STRING,
    process.env.AWS_SQL_CONNECTION_STRING,
    process.env.AZURE_SQL_CONNECTION_STRING
  );
  const haveAllVars = server && database && user && password;

  const trustCertEnv = firstNonEmpty(
    process.env.SQLSERVER_TRUST_SERVER_CERTIFICATE,
    process.env.AWS_SQL_TRUST_SERVER_CERTIFICATE
  );
  const trustServerCertificate =
    trustCertEnv === 'true' ||
    trustCertEnv === '1' ||
    trustCertEnv === 'yes';

  // Prefer separate vars to avoid connection-string parsing edge-cases.
  if (haveAllVars) {
    return {
      user,
      password,
      server,
      port: parseInt(portRaw, 10),
      database,
      options: {
        encrypt: true,
        trustServerCertificate,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };
  }
  if (connectionString) {
    return connectionString;
  }
  throw new Error(
    'Set SQLSERVER_HOST/SQLSERVER_DATABASE/SQLSERVER_USER/SQLSERVER_PASSWORD (or legacy AWS_SQL_* / AZURE_SQL_*), or SQLSERVER_CONNECTION_STRING.'
  );
};

let pool = null;

export async function getPool() {
  if (pool) return pool;
  const config = getConfig();
  pool = await sql.connect(config);
  return pool;
}

export async function query(text, params = {}) {
  const p = await getPool();
  const request = p.request();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const k = key.startsWith('@') ? key.slice(1) : key;
    request.input(k, value);
  }
  return request.query(text);
}

/** Get a request for chaining .input() with types (e.g. sql.UniqueIdentifier) */
export function request() {
  return getPool().then((p) => p.request());
}

export async function close() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { sql };
