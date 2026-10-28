import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getPool, sql } from "./db.js";

export const uploadTempDir = process.env.HELPDESK_UPLOAD_TEMP_DIR || "/tmp/revex-helpdesk-uploads";
export const uploadDir = process.env.HELPDESK_UPLOAD_DIR || path.resolve(process.cwd(), "storage/uploads");
fs.mkdirSync(uploadTempDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o750 });

const safeName = (value) => path.basename(String(value || "archivo")).replace(/[\u0000-\u001f]/g, "_").slice(0, 255) || "archivo";
const mapAttachment = (row) => ({
  id: row.id,
  name: row.original_name,
  mimeType: row.mime_type || "application/octet-stream",
  sizeBytes: Number(row.size_bytes),
  uploadedBy: row.uploaded_by || "",
  createdAt: row.created_at,
});

export const addAttachments = async ({ ticketId, files = [], uploadedBy = "" }) => {
  if (!files.length) return [];
  const pool = await getPool();
  const saved = [];
  for (const file of files) {
    const storageName = `${crypto.randomUUID()}${path.extname(file.originalname || "").toLowerCase().slice(0, 12)}`;
    const destination = path.join(uploadDir, storageName);
    // Multer writes to /tmp (often tmpfs) while the persistent volume may be
    // another filesystem, so rename() can fail with EXDEV. Copy then remove
    // the temporary upload instead.
    await fsp.copyFile(file.path, destination);
    await fsp.unlink(file.path);
    const result = await pool.request()
      .input("ticketId", sql.Int, ticketId)
      .input("originalName", sql.NVarChar(255), safeName(file.originalname))
      .input("storageName", sql.VarChar(180), storageName)
      .input("mimeType", sql.NVarChar(160), String(file.mimetype || "application/octet-stream").slice(0, 160))
      .input("sizeBytes", sql.BigInt, Number(file.size) || 0)
      .input("uploadedBy", sql.NVarChar(160), String(uploadedBy || "").slice(0, 160) || null)
      .query(`INSERT INTO dbo.hd_attachments
        (ticket_id, original_name, storage_name, mime_type, size_bytes, uploaded_by)
        OUTPUT INSERTED.*
        VALUES (@ticketId, @originalName, @storageName, @mimeType, @sizeBytes, @uploadedBy)`);
    saved.push(mapAttachment(result.recordset[0]));
  }
  return saved;
};

export const listAttachments = async (ticketId) => {
  const pool = await getPool();
  const result = await pool.request().input("ticketId", sql.Int, ticketId)
    .query("SELECT id, original_name, mime_type, size_bytes, uploaded_by, created_at FROM dbo.hd_attachments WHERE ticket_id = @ticketId ORDER BY created_at, id");
  return result.recordset.map(mapAttachment);
};

export const getAttachmentFile = async (ticketId, attachmentId) => {
  const pool = await getPool();
  const result = await pool.request()
    .input("ticketId", sql.Int, Number(ticketId))
    .input("attachmentId", sql.Int, Number(attachmentId))
    .query("SELECT TOP 1 original_name, storage_name, mime_type, size_bytes FROM dbo.hd_attachments WHERE ticket_id = @ticketId AND id = @attachmentId");
  const row = result.recordset[0];
  if (!row) return null;
  const filePath = path.join(uploadDir, path.basename(row.storage_name));
  try { await fsp.access(filePath, fs.constants.R_OK); } catch { return null; }
  return { ...mapAttachment(row), path: filePath };
};
