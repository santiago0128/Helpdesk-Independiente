import "dotenv/config";
import fs from "node:fs/promises";
import nodemailer from "nodemailer";

const statePath = process.env.HELPDESK_MONITOR_STATE || "/var/lib/revex-helpdesk/monitor-state.json";
const recipients = String(process.env.HELPDESK_MASTER_EMAILS || "").split(",").map((value) => value.trim()).filter(Boolean);
const configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && recipients.length);
const readState = async () => { try { return JSON.parse(await fs.readFile(statePath, "utf8")); } catch { return { failed: false }; } };
const writeState = async (state) => { await fs.mkdir(new URL(".", `file://${statePath}`).pathname, { recursive: true }).catch(() => {}); await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 }); };
const sendAlert = async (subject, text) => {
  if (!configured) return;
  const mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
  await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipients.join(","), subject, text });
};
const previous = await readState();
let failed = false;
try {
  const response = await fetch("http://127.0.0.1:3200/api/v1/health", { signal: AbortSignal.timeout(5000) });
  failed = !response.ok;
} catch { failed = true; }
if (failed && !previous.failed) await sendAlert("[Helpdesk] Servicio no disponible", "El servicio Revex Helpdesk no responde. Revisa el servidor y el estado de helpdesk.service.");
if (!failed && previous.failed) await sendAlert("[Helpdesk] Servicio recuperado", "Revex Helpdesk vuelve a responder correctamente.");
await writeState({ failed, checkedAt: new Date().toISOString() });
if (failed) process.exitCode = 1;
