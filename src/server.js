import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, sql } from "./db.js";
import { requireToken } from "./auth.js";
import { loginUser, logoutUser, requireUser } from "./userAuth.js";
import { addMessage, createTicket, getTicket, listTickets, updateTicket } from "./tickets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3200);
const allowedOrigins = (process.env.CORS_ORIGINS || "https://stg.revex.com.co,https://helpdesk.revex.com.co").split(",").map((item) => item.trim()).filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (origin, callback) => !origin || allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error("Origen no permitido")) }));
app.use(express.json({ limit: "1mb" }));

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

app.post("/api/v1/integrations/tickets", requireToken(["INTEGRATION", "ADMIN"]), handle(async (req, res) => {
  const result = await createTicket({ payload: req.body, source: req.helpdeskToken.source });
  res.status(result.duplicate ? 200 : 201).json({ message: result.duplicate ? "Ticket existente" : "Ticket creado", ...result });
}));

app.post("/api/v1/tickets", requireUser, handle(async (req, res) => {
  const result = await createTicket({ payload: req.body, source: "helpdesk-ui" });
  res.status(result.duplicate ? 200 : 201).json(result);
}));
app.get("/api/v1/tickets", requireUser, handle(async (req, res) => res.json(await listTickets(req.query))));
app.get("/api/v1/tickets/:id", requireUser, handle(async (req, res) => {
  const ticket = await getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  return res.json({ data: ticket });
}));
app.patch("/api/v1/tickets/:id", requireUser, handle(async (req, res) => res.json({ data: await updateTicket(req.params.id, req.body) })));
app.post("/api/v1/tickets/:id/messages", requireUser, handle(async (req, res) => res.json({ data: await addMessage(req.params.id, req.body) })));

app.use(express.static(path.resolve(__dirname, "../public")));
app.get("*", (_req, res) => res.sendFile(path.resolve(__dirname, "../public/index.html")));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : "Error interno de la mesa de ayuda" });
});

getPool().then(() => app.listen(port, "127.0.0.1", () => console.log(`Helpdesk escuchando en 127.0.0.1:${port}`))).catch((error) => {
  console.error("No se pudo conectar a SQL Server", error);
  process.exit(1);
});
