import crypto from "node:crypto";
import { getPool, sql } from "./db.js";
import { addAttachments, listAttachments } from "./attachments.js";
import { getTicketMetadata, setTicketMetadata } from "./ticketMetadata.js";
import { selectAutomaticAssignee } from "./assignment.js";

export { selectAutomaticAssignee } from "./assignment.js";

const statuses = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"];
const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const requestTypes = ["BUG", "FEATURE", "QUESTION", "ACCESS", "OTHER"];
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const normalize = (value, values, fallback) => {
  const normalized = text(value, 20).toUpperCase();
  return values.includes(normalized) ? normalized : fallback;
};
const objectValue = (value, fallback = {}) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
};
const slaHours = (priority) => ({ URGENT: { first: 1, resolution: 4 }, HIGH: { first: 4, resolution: 16 }, LOW: { first: 16, resolution: 80 }, MEDIUM: { first: 8, resolution: 40 } }[priority] || { first: 8, resolution: 40 });
const mapSla = (row) => {
  const now = Date.now();
  const firstDue = row.sla_first_response_due_at ? new Date(row.sla_first_response_due_at) : null;
  const resolutionDue = row.sla_resolution_due_at ? new Date(row.sla_resolution_due_at) : null;
  const finalStatus = ["RESOLVED", "CLOSED"].includes(row.status);
  const firstBreached = !row.first_response_at && firstDue && firstDue.getTime() < now;
  const resolutionBreached = !finalStatus && resolutionDue && resolutionDue.getTime() < now;
  const firstRisk = !row.first_response_at && firstDue && firstDue.getTime() >= now && firstDue.getTime() - now <= 2 * 60 * 60 * 1000;
  const resolutionRisk = !finalStatus && resolutionDue && resolutionDue.getTime() >= now && resolutionDue.getTime() - now <= 8 * 60 * 60 * 1000;
  return { firstResponseDueAt: row.sla_first_response_due_at, resolutionDueAt: row.sla_resolution_due_at, firstResponseAt: row.first_response_at, resolvedAt: row.resolved_at, firstResponseBreached: Boolean(firstBreached), resolutionBreached: Boolean(resolutionBreached), atRisk: Boolean(firstRisk || resolutionRisk), state: firstBreached || resolutionBreached ? "BREACHED" : firstRisk || resolutionRisk ? "AT_RISK" : "ON_TRACK" };
};

const mapTicket = (row) => ({
  id: row.id,
  number: row.ticket_code,
  externalId: row.external_id,
  source: row.source,
  title: row.title,
  description: row.description,
  requestType: row.request_type || "OTHER",
  priority: row.priority,
  status: row.status,
  requester: { name: row.requester_name || "", email: row.requester_email || "" },
  assignedTo: row.assigned_user_id ? { id: row.assigned_user_id, name: row.assigned_user_name || "", email: row.assigned_user_email || "" } : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sla: mapSla(row),
});
const enrichTicket = async (ticket) => ({ ...ticket, requester: { ...ticket.requester, ...(await getTicketMetadata(ticket.id)) } });

const getAutomaticAssignee = async (pool) => {
  const result = await pool.request().query(`SELECT u.id, u.display_name, u.email,
      SUM(CASE WHEN t.status IN (N'OPEN', N'IN_PROGRESS', N'WAITING') THEN 1 ELSE 0 END) AS active_ticket_count,
      MAX(t.created_at) AS last_assignment_at
    FROM dbo.hd_users u
    JOIN dbo.hd_roles r ON r.id = u.role_id AND r.active = 1
    LEFT JOIN dbo.hd_tickets t ON t.assigned_user_id = u.id
    WHERE u.active = 1
      AND EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(r.permissions) = 1 THEN r.permissions ELSE N'[]' END) WHERE [value] = N'VIEW_TICKETS')
      AND EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(r.permissions) = 1 THEN r.permissions ELSE N'[]' END) WHERE [value] = N'UPDATE_TICKETS')
    GROUP BY u.id, u.display_name, u.email`);
  return selectAutomaticAssignee(result.recordset);
};

const validatePayload = (payload = {}) => {
  const title = text(payload.title ?? payload.titulo, 200);
  const description = text(payload.description ?? payload.descripcion, 100000);
  if (!title || !description) throw Object.assign(new Error("title y description son obligatorios"), { status: 400 });
  return { title, description };
};

export const createTicket = async ({ payload = {}, source = "unknown", files = [], uploadedBy = source, actorUserId = null }) => {
  const { title, description } = validatePayload(payload);
  const externalId = text(payload.externalId ?? payload.external_id, 120) || null;
  const pool = await getPool();

  if (externalId) {
    const existing = await pool.request()
      .input("source", sql.NVarChar(80), text(source, 80))
      .input("externalId", sql.NVarChar(120), externalId)
      .query("SELECT TOP 1 * FROM dbo.hd_tickets WHERE source = @source AND external_id = @externalId");
    if (existing.recordset[0]) return { duplicate: true, ticket: await getTicket(existing.recordset[0].id), attachments: await listAttachments(existing.recordset[0].id) };
  }

  const requester = objectValue(payload.requester ?? payload.solicitante);
  const requestType = normalize(payload.requestType ?? payload.request_type ?? payload.tipo, requestTypes, "OTHER");
  const priority = normalize(payload.priority ?? payload.prioridad, priorities, "MEDIUM");
  const sla = slaHours(priority);
  const automaticAssignee = await getAutomaticAssignee(pool);
  const insert = await pool.request()
    .input("source", sql.NVarChar(80), text(source, 80) || "unknown")
    .input("externalId", sql.NVarChar(120), externalId)
    .input("title", sql.NVarChar(200), title)
    .input("description", sql.NVarChar(sql.MAX), description)
    .input("requestType", sql.NVarChar(30), requestType)
    .input("priority", sql.NVarChar(20), priority)
    .input("requesterName", sql.NVarChar(200), text(requester.name ?? requester.nombre, 200) || null)
    .input("requesterEmail", sql.NVarChar(254), text(requester.email ?? requester.correo, 254) || null)
    .input("assignedUserId", sql.Int, automaticAssignee?.id || null)
    .input("firstDue", sql.DateTime2, new Date(Date.now() + sla.first * 60 * 60 * 1000))
    .input("resolutionDue", sql.DateTime2, new Date(Date.now() + sla.resolution * 60 * 60 * 1000))
    .query(`INSERT INTO dbo.hd_tickets
      (source, external_id, title, description, request_type, priority, requester_name, requester_email, assigned_user_id, sla_first_response_due_at, sla_resolution_due_at)
      OUTPUT INSERTED.*
      VALUES (@source, @externalId, @title, @description, @requestType, @priority, @requesterName, @requesterEmail, @assignedUserId, @firstDue, @resolutionDue)`);
  const row = insert.recordset[0];
  const requesterMetadata = await setTicketMetadata(row.id, requester);
  const attachments = await addAttachments({ ticketId: row.id, files, uploadedBy });
  await pool.request().input("ticketId", sql.Int, row.id).input("actorUserId", sql.Int, actorUserId).input("eventType", sql.NVarChar(40), "CREATED").input("message", sql.NVarChar(1000), `Ticket creado desde ${text(source, 80) || "origen desconocido"}`).query("INSERT INTO dbo.hd_ticket_events (ticket_id, actor_user_id, event_type, message) VALUES (@ticketId, @actorUserId, @eventType, @message)");
  if (automaticAssignee) {
    await pool.request()
      .input("ticketId", sql.Int, row.id)
      .input("actorUserId", sql.Int, actorUserId)
      .input("eventType", sql.NVarChar(40), "ASSIGNED")
      .input("toValue", sql.NVarChar(500), String(automaticAssignee.id))
      .input("message", sql.NVarChar(1000), `Ticket asignado automáticamente a ${automaticAssignee.display_name}`)
      .query("INSERT INTO dbo.hd_ticket_events (ticket_id, actor_user_id, event_type, to_value, message) VALUES (@ticketId, @actorUserId, @eventType, @toValue, @message)");
  }
  const ticket = await getTicket(row.id);
  return { duplicate: false, ticket: ticket || await enrichTicket({ ...mapTicket(row), requester: { ...mapTicket(row).requester, ...requesterMetadata } }), attachments };
};

export const listTickets = async ({ status = "", priority = "", requestType = "", assignedUserId = "", sla = "", search = "", limit = 50 } = {}) => {
  const pool = await getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const request = pool.request()
    .input("status", sql.NVarChar(20), normalize(status, statuses, ""))
    .input("priority", sql.NVarChar(20), normalize(priority, priorities, ""))
    .input("requestType", sql.NVarChar(30), normalize(requestType, requestTypes, ""))
    .input("assignedUserId", sql.Int, positiveInt(assignedUserId))
    .input("sla", sql.NVarChar(20), text(sla, 20).toUpperCase())
    .input("search", sql.NVarChar(120), `%${text(search, 120)}%`)
    .input("limit", sql.Int, safeLimit);
  const result = await request.query(`SELECT TOP (@limit) t.*, u.display_name AS assigned_user_name, u.email AS assigned_user_email
    FROM dbo.hd_tickets t LEFT JOIN dbo.hd_users u ON u.id = t.assigned_user_id
    WHERE (@status = N'' OR t.status = @status)
      AND (@priority = N'' OR t.priority = @priority)
      AND (@requestType = N'' OR t.request_type = @requestType)
      AND (@assignedUserId IS NULL OR t.assigned_user_id = @assignedUserId)
      AND (@sla = N'' OR (@sla = N'UNASSIGNED' AND t.assigned_user_id IS NULL) OR (@sla = N'BREACHED' AND ((t.first_response_at IS NULL AND t.sla_first_response_due_at < SYSUTCDATETIME()) OR (t.status NOT IN (N'RESOLVED', N'CLOSED') AND t.sla_resolution_due_at < SYSUTCDATETIME()))) OR (@sla = N'AT_RISK' AND ((t.first_response_at IS NULL AND t.sla_first_response_due_at BETWEEN SYSUTCDATETIME() AND DATEADD(HOUR, 2, SYSUTCDATETIME())) OR (t.status NOT IN (N'RESOLVED', N'CLOSED') AND t.sla_resolution_due_at BETWEEN SYSUTCDATETIME() AND DATEADD(HOUR, 8, SYSUTCDATETIME())))))
      AND (@search = N'%%' OR t.ticket_code LIKE @search OR t.title LIKE @search OR t.requester_email LIKE @search)
    ORDER BY t.updated_at DESC, t.id DESC`);
  return { data: await Promise.all(result.recordset.map((row) => enrichTicket(mapTicket(row)))), total: result.recordset.length };
};

export const getTicket = async (id) => {
  const ticketId = positiveInt(id);
  if (!ticketId) throw Object.assign(new Error("Ticket inválido"), { status: 400 });
  const pool = await getPool();
  const ticketResult = await pool.request().input("id", sql.Int, ticketId)
    .query("SELECT TOP 1 t.*, u.display_name AS assigned_user_name, u.email AS assigned_user_email FROM dbo.hd_tickets t LEFT JOIN dbo.hd_users u ON u.id = t.assigned_user_id WHERE t.id = @id");
  if (!ticketResult.recordset[0]) return null;
  const messages = await pool.request().input("ticketId", sql.Int, ticketId)
    .query("SELECT id, author_type, author_name, message, created_at FROM dbo.hd_messages WHERE ticket_id = @ticketId ORDER BY created_at, id");
  const events = await pool.request().input("ticketId", sql.Int, ticketId)
    .query("SELECT e.id, e.event_type, e.from_value, e.to_value, e.message, e.created_at, u.display_name AS actor_name FROM dbo.hd_ticket_events e LEFT JOIN dbo.hd_users u ON u.id = e.actor_user_id WHERE e.ticket_id = @ticketId ORDER BY e.created_at, e.id");
  const solution = [...messages.recordset].reverse().find((message) => message.author_type === "SOLUTION");
  return { ...(await enrichTicket(mapTicket(ticketResult.recordset[0]))), solution: solution?.message || "", solutionUpdatedAt: solution?.created_at || null, messages: messages.recordset.filter((message) => message.author_type !== "SOLUTION"), events: events.recordset, attachments: await listAttachments(ticketId) };
};

export const updateTicket = async (id, payload = {}, actorUserId = null) => {
  const ticketId = positiveInt(id);
  if (!ticketId) throw Object.assign(new Error("Ticket inválido"), { status: 400 });
  const status = normalize(payload.status ?? payload.estado, statuses, null);
  const priority = normalize(payload.priority ?? payload.prioridad, priorities, null);
  const assignmentProvided = payload.assignedUserId !== undefined || payload.assigned_user_id !== undefined || payload.assigneeId !== undefined;
  const assignedValue = payload.assignedUserId ?? payload.assigned_user_id ?? payload.assigneeId;
  const assignedUserId = assignmentProvided && String(assignedValue ?? "").trim() ? positiveInt(assignedValue) : null;
  if ((payload.status !== undefined || payload.estado !== undefined) && !status) throw Object.assign(new Error("Estado inválido"), { status: 400 });
  if ((payload.priority !== undefined || payload.prioridad !== undefined) && !priority) throw Object.assign(new Error("Prioridad inválida"), { status: 400 });
  if (assignmentProvided && assignedValue && !assignedUserId) throw Object.assign(new Error("Usuario asignado inválido"), { status: 400 });
  const pool = await getPool();
  const beforeResult = await pool.request().input("id", sql.Int, ticketId).query("SELECT TOP 1 * FROM dbo.hd_tickets WHERE id = @id");
  const before = beforeResult.recordset[0];
  if (!before) throw Object.assign(new Error("Ticket no encontrado"), { status: 404 });
  if (status === "CLOSED") {
    const solutionResult = await pool.request().input("ticketId", sql.Int, ticketId)
      .query("SELECT TOP 1 id FROM dbo.hd_messages WHERE ticket_id = @ticketId AND author_type = N'SOLUTION'");
    if (!solutionResult.recordset[0]) throw Object.assign(new Error("Debes registrar la solución antes de cerrar el caso"), { status: 400 });
  }
  if (assignedUserId) {
    const assigned = await pool.request().input("assignedUserId", sql.Int, assignedUserId)
      .query("SELECT TOP 1 id FROM dbo.hd_users WHERE id = @assignedUserId AND active = 1");
    if (!assigned.recordset[0]) throw Object.assign(new Error("El usuario asignado no existe o está inactivo"), { status: 400 });
  }
  await pool.request().input("id", sql.Int, ticketId)
    .input("status", sql.NVarChar(20), status)
    .input("priority", sql.NVarChar(20), priority)
    .input("assignedUserId", sql.Int, assignedUserId)
    .input("assignmentProvided", sql.Bit, assignmentProvided)
    .query(`UPDATE dbo.hd_tickets SET
      status = COALESCE(@status, status), priority = COALESCE(@priority, priority),
      assigned_user_id = CASE WHEN @assignmentProvided = 1 THEN @assignedUserId ELSE assigned_user_id END,
      resolved_at = CASE WHEN @status IN (N'RESOLVED', N'CLOSED') AND resolved_at IS NULL THEN SYSUTCDATETIME() WHEN @status IN (N'OPEN', N'IN_PROGRESS', N'WAITING') THEN NULL ELSE resolved_at END,
      updated_at = SYSUTCDATETIME()
      WHERE id = @id`);
  const changes = [];
  if (status && status !== before.status) changes.push(["STATUS_CHANGED", before.status, status, `Estado cambiado a ${status}`]);
  if (priority && priority !== before.priority) changes.push(["PRIORITY_CHANGED", before.priority, priority, `Prioridad cambiada a ${priority}`]);
  if (assignmentProvided && String(before.assigned_user_id || "") !== String(assignedUserId || "")) changes.push(["ASSIGNED", before.assigned_user_id ? String(before.assigned_user_id) : "", assignedUserId ? String(assignedUserId) : "", assignedUserId ? "Ticket asignado" : "Asignación retirada"]);
  for (const [eventType, fromValue, toValue, message] of changes) await pool.request().input("ticketId", sql.Int, ticketId).input("actorUserId", sql.Int, actorUserId).input("eventType", sql.NVarChar(40), eventType).input("fromValue", sql.NVarChar(500), fromValue || null).input("toValue", sql.NVarChar(500), toValue || null).input("message", sql.NVarChar(1000), message).query("INSERT INTO dbo.hd_ticket_events (ticket_id, actor_user_id, event_type, from_value, to_value, message) VALUES (@ticketId, @actorUserId, @eventType, @fromValue, @toValue, @message)");
  return getTicket(ticketId);
};

export const saveSolution = async (id, payload = {}, actorUserId = null) => {
  const ticketId = positiveInt(id);
  const solution = text(payload.solution ?? payload.solucion, 100000);
  if (!ticketId || !solution) throw Object.assign(new Error("Debes escribir la solución que recibirá el solicitante"), { status: 400 });
  const pool = await getPool();
  const ticketResult = await pool.request().input("ticketId", sql.Int, ticketId).query("SELECT TOP 1 id FROM dbo.hd_tickets WHERE id = @ticketId");
  if (!ticketResult.recordset[0]) throw Object.assign(new Error("Ticket no encontrado"), { status: 404 });
  const previous = await pool.request().input("ticketId", sql.Int, ticketId).query("SELECT TOP 1 id FROM dbo.hd_messages WHERE ticket_id = @ticketId AND author_type = N'SOLUTION' ORDER BY created_at DESC, id DESC");
  await pool.request()
    .input("ticketId", sql.Int, ticketId)
    .input("authorName", sql.NVarChar(200), text(payload.authorName, 200) || "Helpdesk")
    .input("solution", sql.NVarChar(sql.MAX), solution)
    .query("INSERT INTO dbo.hd_messages (ticket_id, author_type, author_name, message) VALUES (@ticketId, N'SOLUTION', @authorName, @solution)");
  await pool.request()
    .input("ticketId", sql.Int, ticketId)
    .input("actorUserId", sql.Int, actorUserId)
    .input("eventType", sql.NVarChar(40), "SOLUTION_UPDATED")
    .input("message", sql.NVarChar(1000), previous.recordset[0] ? "Solución actualizada" : "Solución registrada")
    .query("INSERT INTO dbo.hd_ticket_events (ticket_id, actor_user_id, event_type, message) VALUES (@ticketId, @actorUserId, @eventType, @message)");
  return updateTicket(ticketId, { status: "CLOSED" }, actorUserId);
};

export const addMessage = async (id, payload = {}, actorUserId = null) => {
  const ticketId = positiveInt(id);
  const message = text(payload.message, 100000);
  if (!ticketId || !message) throw Object.assign(new Error("Ticket y mensaje son obligatorios"), { status: 400 });
  const authorType = ["PUBLIC", "INTERNAL"].includes(String(payload.visibility || payload.authorType || "").toUpperCase()) ? String(payload.visibility || payload.authorType).toUpperCase() : "INTERNAL";
  const pool = await getPool();
  await pool.request().input("ticketId", sql.Int, ticketId)
    .input("authorType", sql.NVarChar(20), authorType)
    .input("authorName", sql.NVarChar(200), text(payload.authorName, 200) || "Helpdesk")
    .input("message", sql.NVarChar(sql.MAX), message)
    .query("INSERT INTO dbo.hd_messages (ticket_id, author_type, author_name, message) VALUES (@ticketId, @authorType, @authorName, @message); UPDATE dbo.hd_tickets SET updated_at = SYSUTCDATETIME(), first_response_at = CASE WHEN @authorType = N'PUBLIC' AND first_response_at IS NULL THEN SYSUTCDATETIME() ELSE first_response_at END WHERE id = @ticketId");
  await pool.request().input("ticketId", sql.Int, ticketId).input("actorUserId", sql.Int, actorUserId).input("eventType", sql.NVarChar(40), "COMMENT_ADDED").input("message", sql.NVarChar(1000), authorType === "PUBLIC" ? "Respuesta pública agregada" : "Nota interna agregada").query("INSERT INTO dbo.hd_ticket_events (ticket_id, actor_user_id, event_type, message) VALUES (@ticketId, @actorUserId, @eventType, @message)");
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
