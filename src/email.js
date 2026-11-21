import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { getAttachmentFile } from "./attachments.js";

const splitEmails = (value) => String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item));
const masterRecipients = () => splitEmails(process.env.HELPDESK_MASTER_EMAILS || process.env.HELPDESK_MASTER_EMAIL);
const configured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && (process.env.SMTP_FROM || process.env.SMTP_USER));
const transporter = () => configured() ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_SECURE || "true").toLowerCase() === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }) : null;
const appUrl = process.env.HELPDESK_PUBLIC_URL || "https://helpdesk.revex.com.co";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const emailLogoPath = process.env.HELPDESK_EMAIL_LOGO_PATH || path.resolve(moduleDir, "../public/assets/revex-logo-email.png");
const emailLogoCid = "revex-logo@revex";
const hasEmailLogo = () => fs.existsSync(emailLogoPath);
const emailBrand = () => hasEmailLogo()
  ? `<img src="cid:${emailLogoCid}" width="190" alt="Revex" style="display:block;width:190px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;">`
  : `<span style="color:#6d28d9;font-size:16px;font-weight:900;letter-spacing:.04em;">REVEX</span><span style="color:#3d3350;font-size:16px;font-weight:700;letter-spacing:.04em;"> HELPDESK</span>`;
const statusLabels = { OPEN: "Abierto", IN_PROGRESS: "En proceso", WAITING: "En espera", RESOLVED: "Resuelto", CLOSED: "Cerrado" };
const statusColors = { OPEN: ["#26143f", "#e9ddff"], IN_PROGRESS: ["#2b1a52", "#e9ddff"], WAITING: ["#2c1b43", "#d8b4fe"], RESOLVED: ["#153c32", "#86efac"], CLOSED: ["#201a2c", "#c2b6d4"] };
const priorityLabels = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", URGENT: "Urgente" };
const priorityColors = { LOW: "#86efac", MEDIUM: "#fcd34d", HIGH: "#d8b4fe", URGENT: "#f59e0b" };
const requestTypeLabels = { BUG: "Bug", FEATURE: "Nueva funcionalidad", QUESTION: "Consulta", ACCESS: "Acceso", OTHER: "Otro" };
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const lineBreaks = (value) => safe(value).replace(/\r?\n/g, "<br>");
const textFromHtml = (html) => String(html || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/[ \t]+/g, " ")
  .replace(/\n\s*\n\s*\n+/g, "\n\n")
  .trim();
const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (!bytes) return "Tamaño no disponible";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};
const formatDate = (value) => {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safe(value);
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(date);
};
const ticketUrl = (ticket) => `${appUrl}/?ticket=${encodeURIComponent(ticket.id)}`;
const statusPill = (status) => {
  const [background, color] = statusColors[status] || ["#201a2c", "#c2b6d4"];
  return `<span style="display:inline-block;background:${background};color:${color};font-size:12px;font-weight:700;line-height:20px;padding:2px 10px;border-radius:999px;">${safe(statusLabels[status] || status)}</span>`;
};
const priorityValue = (priority) => `<span style="font-weight:700;color:${priorityColors[priority] || "#c2b6d4"};">${safe(priorityLabels[priority] || priority)}</span>`;
const ticketSummary = (ticket) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#1d1430;border:1px solid #472d69;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:18px 20px 8px;color:#8b5cf6;font-size:13px;font-weight:800;letter-spacing:.08em;">${safe(ticket.number)}</td></tr>
  <tr><td style="padding:0 20px 18px;color:#fbf8ff;font-size:21px;line-height:28px;font-weight:800;">${safe(ticket.title)}</td></tr>
  <tr><td style="padding:0 20px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td width="33%" style="padding-right:10px;color:#b29fc9;font-size:12px;">Estado<br><span style="display:inline-block;margin-top:6px;">${statusPill(ticket.status)}</span></td>
    <td width="33%" style="padding:0 10px;color:#b29fc9;font-size:12px;">Prioridad<br><span style="display:inline-block;margin-top:8px;font-size:13px;">${priorityValue(ticket.priority)}</span></td>
    <td width="34%" style="padding-left:10px;color:#b29fc9;font-size:12px;">Responsable<br><span style="display:inline-block;margin-top:8px;color:#fbf8ff;font-size:13px;font-weight:700;">${safe(ticket.assignedTo?.name || "Sin asignar")}</span></td>
  </tr></table></td></tr>
</table>`;
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td style="border-radius:8px;background:#6d28d9;"><a href="${safe(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;">${safe(label)}</a></td></tr></table>`;
const emailLayout = ({ preheader, eyebrow = "REVEX HELPDESK", title, intro, body, action, actionLabel = "Abrir en Helpdesk" }) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title></head><body style="margin:0;padding:0;background:#08060d;font-family:Arial,Helvetica,sans-serif;color:#fbf8ff;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safe(preheader || title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#08060d;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:640px;background:#151022;border:1px solid #472d69;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.55);"><tr><td style="padding:20px 28px;background:#f3efe6;border-bottom:4px solid #8b5cf6;">${emailBrand()}</td></tr><tr><td style="padding:34px 32px 10px;"><div style="color:#c4a7ff;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">${safe(eyebrow)}</div><h1 style="margin:10px 0 8px;color:#fbf8ff;font-size:26px;line-height:32px;">${safe(title)}</h1><p style="margin:0;color:#c6b8dd;font-size:15px;line-height:24px;">${intro}</p></td></tr><tr><td style="padding:18px 32px 34px;">${body}${action ? `<div style="padding-top:26px;">${button(action, actionLabel)}</div>` : ""}</td></tr><tr><td style="padding:18px 32px;background:#1d1430;border-top:1px solid #472d69;color:#a99bb8;font-size:12px;line-height:18px;">Este mensaje fue enviado automáticamente por Revex Helpdesk.<br>Si necesitas ayuda adicional, responde a este correo.</td></tr></table></td></tr></table></body></html>`;
const requesterTicketSummary = (ticket) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#1d1430;border:1px solid #472d69;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:18px 20px 8px;color:#8b5cf6;font-size:13px;font-weight:800;letter-spacing:.08em;">${safe(ticket.number)}</td></tr>
  <tr><td style="padding:0 20px 18px;color:#fbf8ff;font-size:19px;line-height:26px;font-weight:800;">${safe(ticket.title)}</td></tr>
  <tr><td style="padding:0 20px 18px;color:#b29fc9;font-size:12px;">Estado actual<br><span style="display:inline-block;margin-top:6px;">${statusPill(ticket.status)}</span></td></tr>
</table>`;
const detailRow = (label, value) => `<tr><td width="34%" style="padding:11px 14px;border-bottom:1px solid #472d69;color:#b29fc9;font-size:12px;font-weight:700;vertical-align:top;">${safe(label)}</td><td style="padding:11px 14px;border-bottom:1px solid #472d69;color:#fbf8ff;font-size:13px;line-height:20px;vertical-align:top;">${value || "No disponible"}</td></tr>`;
const requesterTicketBreakdown = (ticket) => {
  const requester = ticket?.requester || {};
  const attachments = Array.isArray(ticket?.attachments) ? ticket.attachments : [];
  const publicMessages = Array.isArray(ticket?.messages) ? ticket.messages.filter((message) => String(message.author_type || "").toUpperCase() === "PUBLIC") : [];
  const company = requester.company || requester.companyName || requester.empresa;
  const contact = requester.contact || requester.contactName || requester.contacto;
  const attachmentMarkup = attachments.length
    ? `<ul style="margin:0;padding-left:18px;">${attachments.map((attachment) => `<li style="margin:0 0 6px;">${safe(attachment.name)} <span style="color:#b29fc9;">(${safe(attachment.mimeType || "archivo")}, ${formatBytes(attachment.sizeBytes)})</span></li>`).join("")}</ul>`
    : "No se adjuntaron archivos.";
  const conversationMarkup = publicMessages.length
    ? publicMessages.map((message) => `<div style="margin:0 0 12px;padding:12px 14px;background:#17121f;border:1px solid #514064;border-radius:8px;"><div style="color:#fbf8ff;font-size:12px;font-weight:800;">${safe(message.author_name || "Solicitante")} <span style="color:#a99bb8;font-weight:400;">· ${formatDate(message.created_at)}</span></div><div style="margin-top:6px;color:#e0d7eb;font-size:13px;line-height:21px;">${lineBreaks(message.message)}</div></div>`).join("")
    : `<div style="color:#b29fc9;font-size:13px;">No hay actualizaciones públicas.</div>`;
  return `<div>
    <div style="margin-bottom:10px;color:#fbf8ff;font-size:15px;font-weight:800;">Desglose del caso</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#1d1430;border:1px solid #472d69;border-radius:10px;overflow:hidden;">
      ${detailRow("Número", safe(ticket.number))}
      ${detailRow("Título", safe(ticket.title))}
      ${detailRow("Tipo", safe(requestTypeLabels[ticket.requestType] || ticket.requestType || "Otro"))}
      ${detailRow("Estado", statusPill(ticket.status))}
      ${detailRow("Prioridad", priorityValue(ticket.priority))}
      ${detailRow("Responsable", safe(ticket.assignedTo?.name || "Sin asignar"))}
      ${detailRow("Empresa", safe(company || "No informada"))}
      ${detailRow("Contacto", safe(contact || "No informado"))}
      ${detailRow("Informador", `${safe(requester.name || "No informado")}<br><span style="color:#b29fc9;">${safe(requester.email || "Sin correo")}</span>`)}
      ${detailRow("Fecha de creación", formatDate(ticket.createdAt))}
    </table>
    <div style="margin-top:20px;color:#fbf8ff;font-size:15px;font-weight:800;">Descripción</div>
    <div style="margin-top:8px;padding:14px 16px;background:#1d1430;border:1px solid #472d69;border-radius:10px;color:#e7def3;font-size:14px;line-height:22px;">${lineBreaks(ticket.description || "Sin descripción.")}</div>
    <div style="margin-top:20px;color:#fbf8ff;font-size:15px;font-weight:800;">Adjuntos (${attachments.length})</div>
    <div style="margin-top:8px;padding:14px 16px;background:#1d1430;border:1px solid #472d69;border-radius:10px;color:#e7def3;font-size:13px;line-height:20px;">${attachmentMarkup}</div>
    <div style="margin-top:20px;color:#fbf8ff;font-size:15px;font-weight:800;">Conversación pública</div>
    <div style="margin-top:8px;">${conversationMarkup}</div>
  </div>`;
};
const passwordResetUrl = (token) => `${appUrl}/?reset=${encodeURIComponent(token)}`;

const ticketEmailAttachments = async (ticket) => {
  const available = (ticket?.attachments || []).filter((attachment) => String(attachment.mimeType || "").startsWith("image/"));
  const selected = [];
  let totalBytes = 0;
  for (const attachment of available) {
    const size = Number(attachment.sizeBytes) || 0;
    if (!size || size > 8 * 1024 * 1024 || totalBytes + size > 12 * 1024 * 1024) continue;
    try {
      const file = await getAttachmentFile(ticket.id, attachment.id);
      const location = file?.url || file?.path;
      if (!location) continue;
      selected.push({ filename: attachment.name, path: location, contentType: attachment.mimeType });
      totalBytes += size;
    } catch (error) {
      console.warn(`[helpdesk-email] No se pudo adjuntar una imagen del caso ${ticket.number}:`, error.message);
    }
  }
  return selected;
};

const send = async ({ to, subject, html, fileAttachments = [] }) => {
  const recipients = splitEmails(to);
  if (!recipients.length) return { sent: false, reason: "no-recipient" };
  const mailer = transporter();
  if (!mailer) { console.warn(`[helpdesk-email] SMTP no configurado; no se envió: ${subject}`); return { sent: false, reason: "smtp-not-configured" }; }
  const attachments = [...(hasEmailLogo() ? [{ filename: "revex-logo.png", path: emailLogoPath, cid: emailLogoCid }] : []), ...fileAttachments];
  let sent = 0;
  for (const recipient of recipients) {
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        envelope: { from: process.env.SMTP_USER, to: recipient },
        replyTo: process.env.SMTP_USER,
        to: recipient,
        subject,
        text: textFromHtml(html),
        html,
        attachments,
        headers: { "X-Auto-Response-Suppress": "All" },
      });
      sent += 1;
    } catch (error) {
      console.error(`[helpdesk-email] Error enviando "${subject}":`, error.message);
    }
  }
  return sent ? { sent: true, count: sent } : { sent: false, reason: "send-error" };
};

export const notifyTicketCreated = async (ticket) => {
  const recipients = new Set(masterRecipients());
  if (ticket.assignedTo?.email) recipients.add(ticket.assignedTo.email.toLowerCase());
  if (!recipients.size) return { sent: false, reason: "no-recipient" };
  return send({
    to: [...recipients],
    subject: `[Helpdesk] Nuevo caso ${ticket.number}: ${ticket.title}`,
    html: emailLayout({
      preheader: `Nuevo caso ${ticket.number}: ${ticket.title}`,
      title: "Nuevo caso recibido",
      intro: "Se registró una nueva solicitud y requiere revisión del equipo.",
      body: requesterTicketBreakdown(ticket),
    }),
  });
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
  return send({
    to: [...recipients],
    subject: `[Helpdesk] Actualización ${ticket.number}: ${changes.join(" · ")}`,
    html: emailLayout({
      preheader: `Actualización del caso ${ticket.number}`,
      title: "Caso actualizado",
      intro: "Hay una nueva actualización en una solicitud que sigues o administras.",
      body: `${requesterTicketBreakdown(ticket)}<div style="margin-top:22px;padding:14px 16px;border-left:4px solid #8b5cf6;background:#1d1430;color:#e7def3;font-size:14px;line-height:22px;"><strong>Actualización:</strong><br>${changes.map(safe).join("<br>")}</div>`,
    }),
  });
};

export const notifyTicketClosed = async (ticket) => {
  const requesterEmail = ticket?.requester?.email;
  if (!requesterEmail) return { sent: false, reason: "requester-email-not-configured" };
  const requesterName = safe(ticket.requester?.name || "");
  const solution = lineBreaks(ticket.solution || "El caso fue atendido y cerrado por el equipo de soporte.");
  const fileAttachments = await ticketEmailAttachments(ticket);
  return send({
    to: [requesterEmail],
    subject: `[Helpdesk] Caso cerrado ${ticket.number}: ${ticket.title}`,
    html: emailLayout({
      preheader: `Tu caso ${ticket.number} fue cerrado`,
      eyebrow: "ACTUALIZACIÓN DE TU SOLICITUD",
      title: "Tu caso fue cerrado",
      intro: `Hola${requesterName ? ` ${requesterName}` : ""}, el equipo de soporte marcó tu solicitud como cerrada.`,
      body: `<div style="margin-bottom:22px;padding:18px 20px;background:#21143a;border:1px solid #7651a8;border-left:5px solid #a78bfa;border-radius:12px;"><div style="margin-bottom:8px;color:#d8b4fe;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Solución</div><div style="color:#fbf8ff;font-size:15px;line-height:24px;">${solution}</div></div>${requesterTicketBreakdown(ticket)}<p style="margin:22px 0 0;color:#e7def3;font-size:14px;line-height:22px;">Si necesitas información adicional o el problema continúa, responde a este correo para que el equipo pueda ayudarte.</p>`,
    }),
    fileAttachments,
  });
};

export const notifyPasswordReset = async ({ email, name, token }) => send({
  to: [email],
  subject: "[Helpdesk] Recuperación de contraseña",
  html: emailLayout({
    preheader: "Recupera tu acceso a Revex Helpdesk",
    eyebrow: "SEGURIDAD DE LA CUENTA",
    title: "Recupera tu contraseña",
    intro: `Hola${name ? ` ${safe(name)}` : ""}, recibimos una solicitud para cambiar tu contraseña.`,
    body: `<div style="padding:18px 20px;background:#1d1430;border:1px solid #472d69;border-radius:12px;color:#e7def3;font-size:14px;line-height:22px;">El enlace es válido durante una hora. Si no solicitaste este cambio, puedes ignorar este mensaje.</div>`,
    action: passwordResetUrl(token),
    actionLabel: "Crear nueva contraseña",
  }),
});

export const emailStatus = () => ({ smtpConfigured: configured(), masterRecipients: masterRecipients(), publicUrl: appUrl });
