import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getPool, sql } from "../src/db.js";

const uploadDir = process.env.HELPDESK_UPLOAD_DIR || "/home/dev/Helpdesk/storage/uploads";
const retentionDays = Math.min(Math.max(Number(process.env.HELPDESK_ATTACHMENT_RETENTION_DAYS) || 60, 30), 3650);
const dryRun = process.argv.includes("--dry-run");
const r2Configured = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
const r2Client = r2Configured ? new S3Client({
  region: process.env.R2_REGION || "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
}) : null;

const removeObject = async (row) => {
  const storageName = String(row.storage_name || "");
  if (storageName.includes("/")) {
    if (!r2Configured) throw new Error(`R2 no configurado para ${storageName}`);
    await r2Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: storageName }));
    return "r2";
  }
  const filePath = path.join(uploadDir, path.basename(storageName));
  try { await fs.unlink(filePath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return "local";
};

const main = async () => {
  const pool = await getPool();
  const result = await pool.request()
    .input("retentionDays", sql.Int, retentionDays)
    .query(`SELECT a.id, a.storage_name, a.original_name, a.size_bytes, t.ticket_code, t.status,
                   COALESCE(t.resolved_at, t.updated_at) AS closed_at
            FROM dbo.hd_attachments a
            INNER JOIN dbo.hd_tickets t ON t.id = a.ticket_id
            WHERE t.status = N'CLOSED'
              AND COALESCE(t.resolved_at, t.updated_at) < DATEADD(DAY, -@retentionDays, SYSUTCDATETIME())
            ORDER BY a.id`);
  const rows = result.recordset;
  const summary = { dryRun, retentionDays, candidates: rows.length, deleted: 0, failed: 0, bytes: 0, sources: { r2: 0, local: 0 } };
  for (const row of rows) {
    if (dryRun) {
      console.log(`[dry-run] ${row.ticket_code} · ${row.original_name} · ${row.size_bytes} bytes · ${row.closed_at.toISOString()}`);
      continue;
    }
    try {
      const source = await removeObject(row);
      await pool.request().input("id", sql.Int, row.id).query("DELETE FROM dbo.hd_attachments WHERE id = @id");
      summary.deleted += 1;
      summary.bytes += Number(row.size_bytes) || 0;
      summary.sources[source] += 1;
      console.log(`Eliminado ${row.ticket_code} · ${row.original_name} · ${source}`);
    } catch (error) {
      summary.failed += 1;
      console.error(`No se pudo eliminar ${row.ticket_code} · ${row.original_name}: ${error.message}`);
    }
  }
  console.log(`CLEANUP_SUMMARY ${JSON.stringify(summary)}`);
  await pool.close();
};

main().catch((error) => { console.error("Limpieza de adjuntos fallida:", error); process.exitCode = 1; });
