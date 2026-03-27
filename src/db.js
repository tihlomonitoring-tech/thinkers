import sql from 'mssql';
import 'dotenv/config';

const firstNonEmpty = (...values) => values.find((v) => typeof v === 'string' && v.trim().length > 0);

const getConfig = () => {
  // Prefer AWS-specific vars for RDS deployments, fallback to existing Azure vars.
  const server = firstNonEmpty(process.env.AWS_SQL_SERVER, process.env.AZURE_SQL_SERVER);
  const database = firstNonEmpty(process.env.AWS_SQL_DATABASE, process.env.AZURE_SQL_DATABASE);
  const user = firstNonEmpty(process.env.AWS_SQL_USER, process.env.AZURE_SQL_USER);
  const password = firstNonEmpty(process.env.AWS_SQL_PASSWORD, process.env.AZURE_SQL_PASSWORD);
  const portRaw = firstNonEmpty(process.env.AWS_SQL_PORT, process.env.AZURE_SQL_PORT, '1433');
  const connectionString = firstNonEmpty(
    process.env.AWS_SQL_CONNECTION_STRING,
    process.env.AZURE_SQL_CONNECTION_STRING
  );
  const haveAllVars = server && database && user && password;

  // RDS + Node often needs this without NODE_EXTRA_CA_CERTS (TLS chain verification).
  const trustCertEnv = process.env.AWS_SQL_TRUST_SERVER_CERTIFICATE;
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
    'Set AWS_SQL_SERVER/AWS_SQL_DATABASE/AWS_SQL_USER/AWS_SQL_PASSWORD (or AZURE_SQL_* equivalents), or use AWS_SQL_CONNECTION_STRING/AZURE_SQL_CONNECTION_STRING.'
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
