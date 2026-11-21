import sql from "mssql";

const envBoolean = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

export const databaseConfig = {
  server: process.env.DB_SERVER || "127.0.0.1",
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "GLOBAL_HELPDESK",
  options: {
    encrypt: envBoolean("DB_ENCRYPT", true),
    trustServerCertificate: envBoolean("DB_TRUST_SERVER_CERTIFICATE", true),
    enableArithAbort: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 30000),
  requestTimeout: 30000,
};

let poolPromise;

export const getPool = async () => {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(databaseConfig).connect().catch((error) => {
      poolPromise = null;
      throw error;
    });
  }
  return poolPromise;
};

export { sql };
