const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("helpdesk_session_token") || "";

const login = async (email, password) => {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Correo o contraseña incorrectos");
  token = data.token;
  localStorage.setItem("helpdesk_session_token", token);
  return data;
};

const api = async (url, options = {}) => {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(url, { ...options, headers: { ...(isFormData ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No fue posible completar la operación");
  return data;
};
const showNotice = (message, error = false) => { $("notice").hidden = !message; $("notice").textContent = message; $("notice").style.background = error ? "#fff1ee" : "#edf9f1"; $("notice").style.color = error ? "#bd4b36" : "#267341"; };
const formatBytes = (bytes) => { const value = Number(bytes) || 0; if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`; };
const attachmentIcon = (mimeType) => String(mimeType || "").startsWith("image/") ? "🖼️" : String(mimeType || "").startsWith("video/") ? "🎥" : String(mimeType || "").startsWith("audio/") ? "🎧" : "📎";

const loadTickets = async () => {
  const params = new URLSearchParams({ search: $("search").value, status: $("status").value });
  const result = await api(`/api/v1/tickets?${params}`);
  $("tickets").innerHTML = result.data.length ? result.data.map((ticket) => `<article class="ticket" data-id="${ticket.id}"><div class="ticket-head"><span class="ticket-title">${escapeHtml(ticket.number)} · ${escapeHtml(ticket.title)}</span><span class="badge">${escapeHtml(ticket.status)}</span></div><div class="ticket-meta">${escapeHtml(ticket.priority)} · ${escapeHtml(ticket.source)} · ${new Date(ticket.updatedAt).toLocaleString()}</div></article>`).join("") : "<p>No hay tickets.</p>";
  document.querySelectorAll(".ticket").forEach((item) => item.addEventListener("click", () => loadDetail(item.dataset.id)));
};
const downloadAttachment = async (ticketId, attachmentId, filename) => { const response = await fetch(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error("No fue posible descargar el adjunto"); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename || "adjunto"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const loadDetail = async (id) => { const result = await api(`/api/v1/tickets/${id}`); const ticket = result.data; const attachments = ticket.attachments || []; const attachmentHtml = attachments.length ? `<div class="attachments"><h3>Adjuntos (${attachments.length})</h3>${attachments.map((attachment) => `<button type="button" class="attachment-link" data-attachment-id="${attachment.id}" data-attachment-name="${escapeHtml(attachment.name)}">${attachmentIcon(attachment.mimeType)} ${escapeHtml(attachment.name)} <small>${formatBytes(attachment.sizeBytes)}</small></button>`).join("")}</div>` : ""; $("detail").hidden = false; $("detail").innerHTML = `<div class="section-heading"><div><h2>${escapeHtml(ticket.number)} · ${escapeHtml(ticket.title)}</h2><p>${escapeHtml(ticket.description)}</p></div><select id="detail-status"><option ${ticket.status === "OPEN" ? "selected" : ""}>OPEN</option><option ${ticket.status === "IN_PROGRESS" ? "selected" : ""}>IN_PROGRESS</option><option ${ticket.status === "WAITING" ? "selected" : ""}>WAITING</option><option ${ticket.status === "RESOLVED" ? "selected" : ""}>RESOLVED</option><option ${ticket.status === "CLOSED" ? "selected" : ""}>CLOSED</option></select></div>${attachmentHtml}<div>${(ticket.messages || []).map((message) => `<div class="message">${escapeHtml(message.message)}<br><small>${escapeHtml(message.author_name || "Helpdesk")} · ${new Date(message.created_at).toLocaleString()}</small></div>`).join("")}</div><form id="message-form"><label>Agregar respuesta<textarea id="message" rows="3" required></textarea></label><button>Guardar respuesta</button></form>`; $("detail-status").addEventListener("change", async (event) => { await api(`/api/v1/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: event.target.value }) }); showNotice("Estado actualizado"); loadTickets(); }); document.querySelectorAll(".attachment-link").forEach((button) => button.addEventListener("click", () => downloadAttachment(id, button.dataset.attachmentId, button.dataset.attachmentName).catch((error) => showNotice(error.message, true)))); $("message-form").addEventListener("submit", async (event) => { event.preventDefault(); await api(`/api/v1/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ message: $("message").value }) }); showNotice("Respuesta guardada"); loadDetail(id); }); };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const openApp = async () => { try { await api("/api/v1/tickets"); $("login").hidden = true; $("app").hidden = false; await loadTickets(); } catch (error) { $("login-error").textContent = error.message; localStorage.removeItem("helpdesk_session_token"); token = ""; } };

$("login-form").addEventListener("submit", async (event) => { event.preventDefault(); $("login-error").textContent = ""; try { await login($("login-email").value.trim(), $("login-password").value); await openApp(); } catch (error) { $("login-error").textContent = error.message; } });
$("logout").addEventListener("click", async () => { try { await api("/api/v1/auth/logout", { method: "POST" }); } catch (_) {} localStorage.removeItem("helpdesk_session_token"); location.reload(); });
$("refresh").addEventListener("click", () => loadTickets().catch((error) => showNotice(error.message, true)));
$("search").addEventListener("change", () => loadTickets().catch((error) => showNotice(error.message, true)));
$("status").addEventListener("change", () => loadTickets().catch((error) => showNotice(error.message, true)));
$("attachments").addEventListener("change", () => { const files = Array.from($("attachments").files || []); const total = files.reduce((sum, file) => sum + file.size, 0); if (total > 100 * 1024 * 1024) { $("attachments").value = ""; $("attachment-preview").innerHTML = ""; showNotice("El total de los adjuntos no puede superar 100 MB", true); return; } $("attachment-preview").innerHTML = files.map((file) => `<div>${attachmentIcon(file.type)} ${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></div>`).join(""); });
$("ticket-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const body = new FormData(); body.append("title", $("title").value); body.append("description", $("description").value); body.append("priority", $("priority").value); body.append("requester", JSON.stringify({ name: $("requester-name").value, email: $("requester-email").value })); Array.from($("attachments").files || []).forEach((file) => body.append("attachments", file, file.name)); const result = await api("/api/v1/tickets", { method: "POST", body }); event.target.reset(); $("attachment-preview").innerHTML = ""; showNotice(`${result.ticket.number} creado correctamente`); await loadTickets(); } catch (error) { showNotice(error.message, true); } });
if (token) openApp();
