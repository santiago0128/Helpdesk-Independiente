import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { getPool, sql } from "./db.js";
import { requireToken } from "./auth.js";
import { createRole, createUser, listRoles, listUsers, loginUser, logoutUser, requestPasswordReset, resetPassword, requireAdmin, requireAnyPermission, requirePermission, requireUser, updateRole, updateUser } from "./userAuth.js";
import { addAttachments, attachmentStorageStatus, getAttachmentFile, uploadTempDir } from "./attachments.js";
import { addMessage, createTicket, getTicket, listTickets, saveSolution, updateTicket } from "./tickets.js";
import { emailStatus, notifyTicketChanged, notifyTicketClosed, notifyTicketCreated } from "./email.js";
import { deleteRole } from "./roleDeletion.js";
import { recordAudit, listAudit } from "./audit.js";
import { getReportSummary } from "./reports.js";
import { isAllowedUpload, validateUploadedFiles } from "./uploadSecurity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3200);
const host = process.env.HOST || "127.0.0.1";
const allowedOrigins = (process.env.CORS_ORIGINS || "https://stg.revex.com.co,https://helpdesk.revex.com.co").split(",").map((item) => item.trim()).filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.set("trust proxy", 1);
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error("Origen no permitido")) }));
app.use(express.json({ limit: "1mb" }));
const upload = multer({
  dest: uploadTempDir,
  limits: { files: 10, fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => isAllowedUpload(file) ? callback(null, true) : callback(Object.assign(new Error(`Tipo de archivo no permitido: ${file.originalname}`), { status: 415, code: "INVALID_UPLOAD" })),
});
const validateUploadTotal = async (req, _res, next) => {
  const total = (req.files || []).reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  if (total > 100 * 1024 * 1024) return next(Object.assign(new Error("El total de los adjuntos no puede superar 100 MB"), { status: 413 }));
  try { await validateUploadedFiles(req.files || []); return next(); } catch (error) { return next(error); }
};
const requestContext = (req) => ({ ipAddress: req.ip, userAgent: req.get("user-agent") || null });
const auditRequest = (req, action, entityType, entityId, metadata) => recordAudit({ actorUserId: req.helpdeskUser?.id || null, action, entityType, entityId, metadata, ...requestContext(req) });

const handle = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (error) { return next(error); }
};

app.get("/api/v1/health", handle(async (_req, res) => {
  await getPool();
  res.json({ ok: true, service: "helpdesk", attachmentStorage: attachmentStorageStatus() });
}));

app.post("/api/v1/auth/login", handle(async (req, res) => res.json(await loginUser({ ...(req.body || {}), ...requestContext(req) }))));
app.post("/api/v1/auth/forgot-password", handle(async (req, res) => res.json(await requestPasswordReset({ ...(req.body || {}), ...requestContext(req) }))));
app.post("/api/v1/auth/reset-password", handle(async (req, res) => res.json(await resetPassword({ ...(req.body || {}), ...requestContext(req) }))));
app.get("/api/v1/auth/me", requireUser, handle(async (req, res) => res.json({ user: req.helpdeskUser })));
app.post("/api/v1/auth/logout", requireUser, handle(async (req, res) => { await logoutUser(req); await auditRequest(req, "LOGOUT", "USER", req.helpdeskUser.id); res.json({ ok: true }); }));
app.get("/api/v1/users", requireUser, requireAdmin, handle(async (_req, res) => res.json({ data: await listUsers() })));
app.post("/api/v1/users", requireUser, requireAdmin, handle(async (req, res) => { const data = await createUser(req.body || {}); await auditRequest(req, "USER_CREATED", "USER", data.id, { email: data.email, roleId: data.roleId }); return res.status(201).json({ data }); }));
app.patch("/api/v1/users/:id", requireUser, requireAdmin, handle(async (req, res) => { const data = await updateUser(req.params.id, req.body || {}); await auditRequest(req, "USER_UPDATED", "USER", req.params.id, { fields: Object.keys(req.body || {}) }); return res.json({ data }); }));
app.get("/api/v1/roles", requireUser, requireAnyPermission(["MANAGE_USERS", "MANAGE_ROLES"]), handle(async (_req, res) => res.json({ data: await listRoles() })));
app.post("/api/v1/roles", requireUser, requirePermission("MANAGE_ROLES"), handle(async (req, res) => { const data = await createRole(req.body || {}); await auditRequest(req, "ROLE_CREATED", "ROLE", data.id, { name: data.name }); return res.status(201).json({ data }); }));
app.patch("/api/v1/roles/:id", requireUser, requirePermission("MANAGE_ROLES"), handle(async (req, res) => { const data = await updateRole(req.params.id, req.body || {}); await auditRequest(req, "ROLE_UPDATED", "ROLE", req.params.id, { fields: Object.keys(req.body || {}) }); return res.json({ data }); }));
app.delete("/api/v1/roles/:id", requireUser, requirePermission("MANAGE_ROLES"), handle(async (req, res) => { const data = await deleteRole(req.params.id); await auditRequest(req, "ROLE_DELETED", "ROLE", req.params.id); return res.json({ data }); }));
app.get("/api/v1/notifications/status", requireUser, requireAdmin, handle(async (_req, res) => res.json({ data: emailStatus() })));
app.get("/api/v1/reports/summary", requireUser, requirePermission("VIEW_TICKETS"), handle(async (req, res) => res.json({ data: await getReportSummary(req.query) })));
app.get("/api/v1/audit", requireUser, requireAdmin, handle(async (req, res) => res.json({ data: await listAudit(req.query) })));

app.post("/api/v1/integrations/tickets", requireToken(["INTEGRATION", "ADMIN"]), upload.array("attachments", 10), validateUploadTotal, handle(async (req, res) => {
  const result = await createTicket({ payload: req.body, files: req.files || [], source: req.helpdeskToken.source });
  if (!result.duplicate) void notifyTicketCreated(result.ticket);
  res.status(result.duplicate ? 200 : 201).json({ message: result.duplicate ? "Ticket existente" : "Ticket creado", ...result });
}));

app.post("/api/v1/tickets", requireUser, upload.array("attachments", 10), validateUploadTotal, handle(async (req, res) => {
  const result = await createTicket({ payload: req.body, files: req.files || [], source: "helpdesk-ui", uploadedBy: req.helpdeskUser.email, actorUserId: req.helpdeskUser.id });
  if (!result.duplicate) void notifyTicketCreated(result.ticket);
  await auditRequest(req, "TICKET_CREATED", "TICKET", result.ticket.id, { source: "helpdesk-ui", title: result.ticket.title });
  res.status(result.duplicate ? 200 : 201).json(result);
}));
app.get("/api/v1/tickets", requireUser, handle(async (req, res) => res.json(await listTickets(req.query))));
app.get("/api/v1/tickets/:id", requireUser, handle(async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  return res.json({ data: ticket });
}));
app.patch("/api/v1/tickets/:id", requireUser, handle(async (req, res) => {
  const before = await getTicket(req.params.id);
  const ticket = await updateTicket(req.params.id, req.body, req.helpdeskUser.id);
  if (before) {
    void notifyTicketChanged({ before, ticket });
    if (before.status !== "CLOSED" && ticket.status === "CLOSED") void notifyTicketClosed(ticket);
  }
  await auditRequest(req, "TICKET_UPDATED", "TICKET", req.params.id, { fields: Object.keys(req.body || {}) });
  return res.json({ data: ticket });
}));
app.post("/api/v1/tickets/:id/solution", requireUser, upload.array("attachments", 10), validateUploadTotal, handle(async (req, res) => {
  const before = await getTicket(req.params.id);
  const solution = String(req.body?.solution || req.body?.solucion || "").trim();
  if (!solution) throw Object.assign(new Error("Debes escribir la solución que recibirá el solicitante"), { status: 400 });
  await saveSolution(req.params.id, { solution, authorName: req.helpdeskUser.name || "Helpdesk" }, req.helpdeskUser.id);
  await addAttachments({ ticketId: Number(req.params.id), files: req.files || [], uploadedBy: req.helpdeskUser.email });
  const ticket = await getTicket(req.params.id);
  if (before) {
    void notifyTicketChanged({ before, ticket });
    void notifyTicketClosed(ticket);
  }
  await auditRequest(req, "TICKET_SOLUTION_SAVED", "TICKET", req.params.id, { attachmentCount: (req.files || []).length, solutionLength: solution.length });
  return res.json({ data: ticket });
}));
app.post("/api/v1/tickets/:id/attachments", requireUser, upload.array("attachments", 10), validateUploadTotal, handle(async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  if (!(req.files || []).length) throw Object.assign(new Error("Selecciona al menos un archivo"), { status: 400 });
  const attachments = await addAttachments({ ticketId: Number(req.params.id), files: req.files || [], uploadedBy: req.helpdeskUser.email });
  await auditRequest(req, "TICKET_ATTACHMENTS_ADDED", "TICKET", req.params.id, { attachmentCount: attachments.length });
  return res.status(201).json({ data: await getTicket(req.params.id), attachments });
}));
app.post("/api/v1/tickets/:id/messages", requireUser, handle(async (req, res) => { const data = await addMessage(req.params.id, req.body, req.helpdeskUser.id); await auditRequest(req, "TICKET_MESSAGE_ADDED", "TICKET", req.params.id, { visibility: req.body?.visibility || "INTERNAL" }); return res.json({ data }); }));
app.get("/api/v1/tickets/:id/attachments/:attachmentId", requireUser, handle(async (req, res) => {
  const attachment = await getAttachmentFile(req.params.id, req.params.attachmentId);
  if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });
  if (attachment.url) return res.redirect(302, attachment.url);
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
  return res.sendFile(attachment.path);
}));

app.use(express.static(path.resolve(__dirname, "../public")));
app.get("*", (_req, res) => res.sendFile(path.resolve(__dirname, "../public/index.html")));

app.use((error, req, res, _next) => {
  for (const file of req.files || []) {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
  console.error(error);
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.code === "LIMIT_FILE_COUNT" ? 400 : error.status || 500;
  const message = error.code === "LIMIT_FILE_SIZE" ? "Cada archivo debe pesar máximo 50 MB" : error.code === "LIMIT_FILE_COUNT" ? "Puedes adjuntar máximo 10 archivos" : error.status ? error.message : "Error interno de la mesa de ayuda";
  res.status(status).json({ error: message });
});

getPool().then(() => app.listen(port, host, () => console.log(`Helpdesk escuchando en ${host}:${port}`))).catch((error) => {
  console.error("No se pudo conectar a SQL Server", error);
  process.exit(1);
});
