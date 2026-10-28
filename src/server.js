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
import { createRole, createUser, listRoles, listUsers, loginUser, logoutUser, requireAdmin, requireAnyPermission, requirePermission, requireUser, updateRole, updateUser } from "./userAuth.js";
import { getAttachmentFile, uploadTempDir } from "./attachments.js";
import { addMessage, createTicket, getTicket, listTickets, updateTicket } from "./tickets.js";
import { emailStatus, notifyTicketChanged, notifyTicketCreated } from "./email.js";
import { deleteRole } from "./roleDeletion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3200);
const allowedOrigins = (process.env.CORS_ORIGINS || "https://stg.revex.com.co,https://helpdesk.revex.com.co").split(",").map((item) => item.trim()).filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error("Origen no permitido")) }));
app.use(express.json({ limit: "1mb" }));
const upload = multer({
  dest: uploadTempDir,
  limits: { files: 10, fileSize: 50 * 1024 * 1024 },
});
const validateUploadTotal = (req, _res, next) => {
  const total = (req.files || []).reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  if (total > 100 * 1024 * 1024) return next(Object.assign(new Error("El total de los adjuntos no puede superar 100 MB"), { status: 413 }));
  return next();
};

const handle = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (error) { return next(error); }
};

app.get("/api/v1/health", handle(async (_req, res) => {
  await getPool();
  res.json({ ok: true, service: "helpdesk" });
}));

app.post("/api/v1/auth/login", handle(async (req, res) => res.json(await loginUser(req.body || {}))));
app.get("/api/v1/auth/me", requireUser, handle(async (req, res) => res.json({ user: req.helpdeskUser })));
app.post("/api/v1/auth/logout", requireUser, handle(async (req, res) => { await logoutUser(req); res.json({ ok: true }); }));
app.get("/api/v1/users", requireUser, requireAdmin, handle(async (_req, res) => res.json({ data: await listUsers() })));
app.post("/api/v1/users", requireUser, requireAdmin, handle(async (req, res) => res.status(201).json({ data: await createUser(req.body || {}) })));
app.patch("/api/v1/users/:id", requireUser, requireAdmin, handle(async (req, res) => res.json({ data: await updateUser(req.params.id, req.body || {}) })));
app.get("/api/v1/roles", requireUser, requireAnyPermission(["MANAGE_USERS", "MANAGE_ROLES"]), handle(async (_req, res) => res.json({ data: await listRoles() })));
app.post("/api/v1/roles", requireUser, requirePermission("MANAGE_ROLES"), handle(async (req, res) => res.status(201).json({ data: await createRole(req.body || {}) })));
app.patch("/api/v1/roles/:id", requireUser, requirePermission("MANAGE_ROLES"), handle(async (req, res) => res.json({ data: await updateRole(req.params.id, req.body || {}) })));
app.delete("/api/v1/roles/:id", requireUser, requirePermission("MANAGE_ROLES"), handle(async (req, res) => res.json({ data: await deleteRole(req.params.id) })));
app.get("/api/v1/notifications/status", requireUser, requireAdmin, handle(async (_req, res) => res.json({ data: emailStatus() })));

app.post("/api/v1/integrations/tickets", requireToken(["INTEGRATION", "ADMIN"]), upload.array("attachments", 10), validateUploadTotal, handle(async (req, res) => {
  const result = await createTicket({ payload: req.body, files: req.files || [], source: req.helpdeskToken.source });
  if (!result.duplicate) void notifyTicketCreated(result.ticket);
  res.status(result.duplicate ? 200 : 201).json({ message: result.duplicate ? "Ticket existente" : "Ticket creado", ...result });
}));

app.post("/api/v1/tickets", requireUser, upload.array("attachments", 10), validateUploadTotal, handle(async (req, res) => {
  const result = await createTicket({ payload: req.body, files: req.files || [], source: "helpdesk-ui", uploadedBy: req.helpdeskUser.email, actorUserId: req.helpdeskUser.id });
  if (!result.duplicate) void notifyTicketCreated(result.ticket);
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
  if (before) void notifyTicketChanged({ before, ticket });
  return res.json({ data: ticket });
}));
app.post("/api/v1/tickets/:id/messages", requireUser, handle(async (req, res) => res.json({ data: await addMessage(req.params.id, req.body, req.helpdeskUser.id) })));
app.get("/api/v1/tickets/:id/attachments/:attachmentId", requireUser, handle(async (req, res) => {
  const attachment = await getAttachmentFile(req.params.id, req.params.attachmentId);
  if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });
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

getPool().then(() => app.listen(port, "127.0.0.1", () => console.log(`Helpdesk escuchando en 127.0.0.1:${port}`))).catch((error) => {
  console.error("No se pudo conectar a SQL Server", error);
  process.exit(1);
});
