import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sql from "mssql";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(moduleDir, "../database");

const envBoolean = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

export const validateDatabaseName = (value) => {
  const name = String(value || "GLOBAL_HELPDESK").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name)) {
    throw new Error("DB_NAME solo puede contener letras, números y guion bajo, y debe comenzar por una letra.");
  }
  return name;
};

export const splitSqlBatches = (source) => {
  const batches = [];
  let current = [];
  for (const line of String(source).replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^\s*GO\s*(?:--.*)?$/i.test(line)) {
      const batch = current.join("\n").trim();
      if (batch) batches.push(batch);
      current = [];
    } else {
      current.push(line);
    }
  }
  const finalBatch = current.join("\n").trim();
  if (finalBatch) batches.push(finalBatch);
  return batches;
};

export const migrationFiles = async (directory = defaultMigrationsDir) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{3}_[A-Za-z0-9_-]+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
};

const databaseConfig = (database) => ({
  server: process.env.DB_SERVER || "127.0.0.1",
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database,
  options: {
    encrypt: envBoolean("DB_ENCRYPT", true),
    trustServerCertificate: envBoolean("DB_TRUST_SERVER_CERTIFICATE", true),
    enableArithAbort: true,
  },
  pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 30000),
  requestTimeout: 60000,
});

const ensureDatabase = async (databaseName) => {
  if (!envBoolean("DB_AUTO_CREATE", true)) return;
  const master = await new sql.ConnectionPool(databaseConfig("master")).connect();
  try {
    const result = await master.request()
      .input("databaseName", sql.NVarChar(128), databaseName)
      .query("SELECT DB_ID(@databaseName) AS database_id");
    if (!result.recordset[0]?.database_id) {
      await master.request().batch(`CREATE DATABASE [${databaseName}]`);
      console.log(`[migrate] Base de datos creada: ${databaseName}`);
    }
  } finally {
    await master.close();
  }
};

export const runMigrations = async ({ directory = defaultMigrationsDir } = {}) => {
  if (!process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error("DB_USER y DB_PASSWORD son obligatorios para ejecutar las migraciones.");
  }

  const databaseName = validateDatabaseName(process.env.DB_NAME);
  await ensureDatabase(databaseName);
  const pool = await new sql.ConnectionPool(databaseConfig(databaseName)).connect();

  try {
    await pool.request().batch(`
      IF OBJECT_ID(N'dbo.hd_schema_migrations', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.hd_schema_migrations (
          filename NVARCHAR(255) NOT NULL PRIMARY KEY,
          checksum CHAR(64) NOT NULL,
          applied_at DATETIME2(3) NOT NULL CONSTRAINT DF_hd_schema_migrations_applied DEFAULT SYSUTCDATETIME()
        );
      END;
    `);

    const files = await migrationFiles(directory);
    if (!files.length) throw new Error(`No se encontraron migraciones SQL en ${directory}`);

    for (const filename of files) {
      const source = await fs.readFile(path.join(directory, filename), "utf8");
      const checksum = crypto.createHash("sha256").update(source).digest("hex");
      const applied = await pool.request()
        .input("filename", sql.NVarChar(255), filename)
        .query("SELECT checksum FROM dbo.hd_schema_migrations WHERE filename = @filename");

      if (applied.recordset[0]) {
        if (applied.recordset[0].checksum !== checksum) {
          throw new Error(`La migración ${filename} cambió después de ser aplicada.`);
        }
        console.log(`[migrate] Ya aplicada: ${filename}`);
        continue;
      }

      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const batch of splitSqlBatches(source)) {
          await new sql.Request(transaction).batch(batch);
        }
        await new sql.Request(transaction)
          .input("filename", sql.NVarChar(255), filename)
          .input("checksum", sql.Char(64), checksum)
          .query("INSERT INTO dbo.hd_schema_migrations (filename, checksum) VALUES (@filename, @checksum)");
        await transaction.commit();
        console.log(`[migrate] Aplicada: ${filename}`);
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    }
  } finally {
    await pool.close();
  }
};

const isEntryPoint = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  runMigrations().catch((error) => {
    console.error(`[migrate] ${error.message}`);
    process.exitCode = 1;
  });
}
