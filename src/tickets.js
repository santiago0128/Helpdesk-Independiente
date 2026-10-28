import crypto from "node:crypto";
import { getPool, sql } from "./db.js";

const statuses = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"];
const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const normalize = (value, values, fallback) => {
  const normalized = text(value, 20).toUpperCase();
  return values.includes(normalized) ? normalized : fallback;
};

const mapTicket = (row) => ({
  id: row.id,
  number: row.ticket_code,
  externalId: row.external_id,
  source: row.source,
  title: row.title,
  description: row.description,
  priority: row.priority,
  status: row.status,
  requester: { name: row.requester_name || "", email: row.requester_email || "" },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const validatePayload = (payload = {}) => {
  const title = text(payload.title ?? payload.titulo, 200);
  const description = text(payload.description ?? payload.descripcion, 100000);
  if (!title || !description) throw Object.assign(new Error("title y description son obligatorios"), { status: 400 });
  return { title, description };
};

export const createTicket = async ({ payload = {}, source = "unknown" }) => {
  const { title, description } = validatePayload(payload);
  const externalId = text(payload.externalId ?? payload.external_id, 120) || null;
  const requester = payload.requester || payload.solicitante || {};
  const pool = await getPool();

  if (externalId) {
    const existing = await pool.request()
      .input("source", sql.NVarChar(80), text(source, 80))
      .input("externalId", sql.NVarChar(120), externalId)
      .query("SELECT TOP 1 * FROM dbo.hd_tickets WHERE source = @source AND external_id = @externalId");
    if (existing.recordset[0]) return { duplicate: true, ticket: mapTicket(existing.recordset[0]) };
  }

  const insert = await pool.request()
    .input("source", sql.NVarChar(80), text(source, 80) || "unknown")
    .input("externalId", sql.NVarChar(120), externalId)
    .input("title", sql.NVarChar(200), title)
    .input("description", sql.NVarChar(sql.MAX), description)
    .input("priority", sql.NVarChar(20), normalize(payload.priority ?? payload.prioridad, priorities, "MEDIUM"))
    .input("requesterName", sql.NVarChar(200), text(requester.name ?? requester.nombre, 200) || null)
    .input("requesterEmail", sql.NVarChar(254), text(requester.email ?? requester.correo, 254) || null)
    .query(`INSERT INTO dbo.hd_tickets
      (source, external_id, title, description, priority, requester_name, requester_email)
      OUTPUT INSERTED.*
      VALUES (@source, @externalId, @title, @description, @priority, @requesterName, @requesterEmail)`);
  const row = insert.recordset[0];
  return { duplicate: false, ticket: mapTicket(row) };
};

export const listTickets = async ({ status = "", priority = "", search = "", limit = 50 } = {}) => {
  const pool = await getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const request = pool.request()
    .input("status", sql.NVarChar(20), normalize(status, statuses, ""))
    .input("priority", sql.NVarChar(20), normalize(priority, priorities, ""))
    .input("search", sql.NVarChar(120), `%${text(search, 120)}%`)
    .input("limit", sql.Int, safeLimit);
  const result = await request.query(`SELECT TOP (@limit) * FROM dbo.hd_tickets
    WHERE (@status = N'' OR status = @status)
      AND (@priority = N'' OR priority = @priority)
      AND (@search = N'%%' OR ticket_code LIKE @search OR title LIKE @search OR requester_email LIKE @search)
    ORDER BY updated_at DESC, id DESC`);
  return { data: result.recordset.map(mapTicket), total: result.recordset.length };
};

export const getTicket = async (id) => {
  const ticketId = positiveInt(id);
  if (!ticketId) throw Object.assign(new Error("Ticket inválido"), { status: 400 });
  const pool = await getPool();
  const ticketResult = await pool.request().input("id", sql.Int, ticketId)
    .query("SELECT TOP 1 * FROM dbo.hd_tickets WHERE id = @id");
  if (!ticketResult.recordset[0]) return null;
  const messages = await pool.request().input("ticketId", sql.Int, ticketId)
    .query("SELECT id, author_type, author_name, message, created_at FROM dbo.hd_messages WHERE ticket_id = @ticketId ORDER BY created_at, id");
  return { ...mapTicket(ticketResult.recordset[0]), messages: messages.recordset };
};

export const updateTicket = async (id, payload = {}) => {
  const ticketId = positiveInt(id);
  if (!ticketId) throw Object.assign(new Error("Ticket inválido"), { status: 400 });
  const status = normalize(payload.status ?? payload.estado, statuses, null);
  const priority = normalize(payload.priority ?? payload.prioridad, priorities, null);
  if ((payload.status !== undefined || payload.estado !== undefined) && !status) throw Object.assign(new Error("Estado inválido"), { status: 400 });
  if ((payload.priority !== undefined || payload.prioridad !== undefined) && !priority) throw Object.assign(new Error("Prioridad inválida"), { status: 400 });
  const pool = await getPool();
  await pool.request().input("id", sql.Int, ticketId)
    .input("status", sql.NVarChar(20), status)
    .input("priority", sql.NVarChar(20), priority)
    .query(`UPDATE dbo.hd_tickets SET
      status = COALESCE(@status, status), priority = COALESCE(@priority, priority), updated_at = SYSUTCDATETIME()
      WHERE id = @id`);
  return getTicket(ticketId);
};

export const addMessage = async (id, payload = {}) => {
  const ticketId = positiveInt(id);
  const message = text(payload.message, 100000);
  if (!ticketId || !message) throw Object.assign(new Error("Ticket y mensaje son obligatorios"), { status: 400 });
  const pool = await getPool();
  await pool.request().input("ticketId", sql.Int, ticketId)
    .input("authorType", sql.NVarChar(20), "INTERNAL")
    .input("authorName", sql.NVarChar(200), text(payload.authorName, 200) || "Helpdesk")
    .input("message", sql.NVarChar(sql.MAX), message)
    .query("INSERT INTO dbo.hd_messages (ticket_id, author_type, author_name, message) VALUES (@ticketId, @authorType, @authorName, @message); UPDATE dbo.hd_tickets SET updated_at = SYSUTCDATETIME() WHERE id = @ticketId");
  return getTicket(ticketId);
};

export const createStoredToken = async ({ name, source, type = "INTEGRATION" }) => {
  const raw = `hd_${crypto.randomBytes(32).toString("hex")}`;
  const pool = await getPool();
  const result = await pool.request()
    .input("name", sql.NVarChar(120), text(name, 120) || "Token")
    .input("source", sql.NVarChar(80), text(source, 80) || "unknown")
    .input("type", sql.NVarChar(20), type === "ADMIN" ? "ADMIN" : "INTEGRATION")
    .input("hash", sql.VarChar(64), crypto.createHash("sha256").update(raw).digest("hex"))
    .input("prefix", sql.VarChar(20), raw.slice(0, 16))
    .query(`INSERT INTO dbo.hd_tokens (name, source, token_type, token_hash, token_prefix)
            OUTPUT INSERTED.id, INSERTED.name, INSERTED.source, INSERTED.token_type, INSERTED.created_at
            VALUES (@name, @source, @type, @hash, @prefix)`);
  return { ...result.recordset[0], token: raw };
};
