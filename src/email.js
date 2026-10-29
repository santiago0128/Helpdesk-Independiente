import nodemailer from "nodemailer";

const splitEmails = (value) => String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item));
const masterRecipients = () => splitEmails(process.env.HELPDESK_MASTER_EMAILS || process.env.HELPDESK_MASTER_EMAIL);
const configured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && (process.env.SMTP_FROM || process.env.SMTP_USER));
const transporter = () => configured() ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }) : null;
const appUrl = process.env.HELPDESK_PUBLIC_URL || "https://helpdesk.revex.com.co";
const statusLabels = { OPEN: "Abierto", IN_PROGRESS: "En proceso", WAITING: "En espera", RESOLVED: "Resuelto", CLOSED: "Cerrado" };
const priorityLabels = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", URGENT: "Urgente" };
const safe = (value) => String(value ?? "").replace(/[<>]/g, "");
const ticketUrl = (ticket) => `${appUrl}/?ticket=${encodeURIComponent(ticket.id)}`;
const ticketSummary = (ticket) => `<p><strong>${safe(ticket.number)}</strong> · ${safe(ticket.title)}</p><p>Tipo: ${safe(ticket.requestType)}<br>Prioridad: ${safe(priorityLabels[ticket.priority] || ticket.priority)}<br>Estado: ${safe(statusLabels[ticket.status] || ticket.status)}<br>Responsable: ${safe(ticket.assignedTo?.name || "Sin asignar")}</p><p><a href="${ticketUrl(ticket)}">Abrir ticket en Revex Helpdesk</a></p>`;
const passwordResetUrl = (token) => `${appUrl}/?reset=${encodeURIComponent(token)}`;

const send = async ({ to, subject, html }) => {
  const recipients = splitEmails(to);
  if (!recipients.length) return { sent: false, reason: "no-recipient" };
  const mailer = transporter();
  if (!mailer) { console.warn(`[helpdesk-email] SMTP no configurado; no se envió: ${subject}`); return { sent: false, reason: "smtp-not-configured" }; }
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: recipients.join(","), subject, html });
    return { sent: true };
  } catch (error) {
    console.error(`[helpdesk-email] Error enviando "${subject}":`, error.message);
    return { sent: false, reason: "send-error" };
  }
};

export const notifyTicketCreated = async (ticket) => {
  const recipients = masterRecipients();
  if (!recipients.length) return { sent: false, reason: "master-email-not-configured" };
  return send({ to: recipients, subject: `[Helpdesk] Nuevo caso ${ticket.number}: ${ticket.title}`, html: `<h2>Nuevo caso recibido</h2>${ticketSummary(ticket)}<h3>Descripción</h3><p>${safe(ticket.description).replace(/\n/g, "<br>")}</p>` });
};

export const notifyTicketChanged = async ({ before, ticket }) => {
  const recipients = new Set(masterRecipients());
  const assignmentChanged = (before?.assignedTo?.id || null) !== (ticket?.assignedTo?.id || null);
  const statusChanged = before?.status !== ticket?.status;
  if ((assignmentChanged || statusChanged) && ticket.assignedTo?.email) recipients.add(ticket.assignedTo.email.toLowerCase());
  if (!recipients.size || (!assignmentChanged && !statusChanged)) return { sent: false, reason: "no-notification" };
  const changes = [];
  if (statusChanged) changes.push(`Estado: ${statusLabels[before.status] || before.status} → ${statusLabels[ticket.status] || ticket.status}`);
  if (assignmentChanged) changes.push(`Responsable: ${before.assignedTo?.name || "Sin asignar"} → ${ticket.assignedTo?.name || "Sin asignar"}`);
  return send({ to: [...recipients], subject: `[Helpdesk] Actualización ${ticket.number}: ${changes.join(" · ")}`, html: `<h2>El caso fue actualizado</h2>${ticketSummary(ticket)}<p>${changes.map(safe).join("<br>")}</p>` });
};

export const notifyPasswordReset = async ({ email, name, token }) => send({
  to: [email],
  subject: "[Helpdesk] Recuperación de contraseña",
  html: `<h2>Recupera el acceso a Revex Helpdesk</h2><p>Hola ${safe(name || "")}, recibimos una solicitud para cambiar tu contraseña.</p><p><a href="${passwordResetUrl(token)}">Crear una nueva contraseña</a></p><p>El enlace vence en una hora. Si no solicitaste este cambio, ignora este mensaje.</p>`,
});

export const emailStatus = () => ({ smtpConfigured: configured(), masterRecipients: masterRecipients(), publicUrl: appUrl });
