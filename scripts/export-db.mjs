import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import sql from "mssql";

const output = process.argv[2];
if (!output) throw new Error("Ruta de salida requerida");
const config = { server: process.env.DB_SERVER || "127.0.0.1", port: Number(process.env.DB_PORT || 1433), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, options: { encrypt: true, trustServerCertificate: true } };
const pool = await sql.connect(config);
const tables = await pool.request().query("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME");
const dump = { generatedAt: new Date().toISOString(), database: process.env.DB_NAME, tables: {} };
for (const table of tables.recordset) {
  const schema = table.TABLE_SCHEMA.replace(/]/g, "]]" );
  const tableName = table.TABLE_NAME.replace(/]/g, "]]" );
  const rows = await pool.request().query(`SELECT * FROM [${schema}].[${tableName}]`);
  dump.tables[`${table.TABLE_SCHEMA}.${table.TABLE_NAME}`] = rows.recordset;
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, zlib.gzipSync(Buffer.from(JSON.stringify(dump))));
await pool.close();
console.log(`Exportación lógica completada: ${output}`);
