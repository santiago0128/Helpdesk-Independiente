/* Enhanced Jira-style ticket detail: solution, attachments, conversation and audit timeline. */
let enhancedTicketId = null;
let renderingEnhancedDetail = false;
let enhancedPreviewUrls = [];

const enhancedMessage = (message) => `<article class="message ${String(message.author_type || "INTERNAL").toLowerCase()}"><div class="message-top"><strong>${escapeHtml(message.author_name || "Helpdesk")}</strong><span class="message-visibility">${message.author_type === "PUBLIC" ? "Respuesta pública" : "Nota interna"}</span></div><div>${escapeHtml(message.message)}</div><small>${new Date(message.created_at).toLocaleString()}</small></article>`;
const enhancedEvent = (event) => `<li><span class="activity-dot"></span><div><strong>${escapeHtml({ CREATED: "Ticket creado", STATUS_CHANGED: "Estado actualizado", PRIORITY_CHANGED: "Prioridad actualizada", ASSIGNED: "Responsable actualizado", COMMENT_ADDED: "Comentario agregado", SOLUTION_UPDATED: "Solución actualizada" }[event.event_type] || event.event_type || "Actividad")}</strong><p>${escapeHtml(event.message || "")}</p><small>${escapeHtml(event.actor_name || "Sistema")} · ${new Date(event.created_at).toLocaleString()}</small></div></li>`;
const detailDate = (value) => value ? new Date(value).toLocaleString() : "—";
const detailReporter = (ticket) => ticket.requester || {};
const acceptedCaseFiles = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt";

const clearEnhancedPreviews = () => {
  enhancedPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  enhancedPreviewUrls = [];
};

const attachmentMarkup = (attachment) => `<article class="case-attachment ${String(attachment.mimeType || "").startsWith("image/") ? "is-image" : ""}">${String(attachment.mimeType || "").startsWith("image/") ? `<img class="case-image-preview" data-attachment-id="${attachment.id}" alt="Vista previa de ${escapeHtml(attachment.name)}" />` : ""}<button type="button" class="attachment-link" data-attachment-id="${attachment.id}" data-attachment-name="${escapeHtml(attachment.name)}">${attachmentIcon(attachment.mimeType)} <span>${escapeHtml(attachment.name)}</span><small>${formatBytes(attachment.sizeBytes)}</small></button></article>`;

const hydrateImagePreviews = async (ticketId) => {
  await Promise.all(Array.from(document.querySelectorAll(".case-image-preview")).map(async (image) => {
    try {
      const response = await fetch(`/api/v1/tickets/${ticketId}/attachments/${image.dataset.attachmentId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const url = URL.createObjectURL(await response.blob());
      enhancedPreviewUrls.push(url);
      image.src = url;
    } catch (_) {}
  }));
};

const showSelectedFiles = (input, target) => {
  const files = Array.from(input.files || []);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 100 * 1024 * 1024) {
    input.value = "";
    target.innerHTML = "";
    showNotice("El total de los adjuntos no puede superar 100 MB", true);
    return false;
  }
  target.innerHTML = files.map((file) => `<div>${attachmentIcon(file.type)} ${escapeHtml(file.name)} <small>${formatBytes(file.size)}</small></div>`).join("");
  return true;
};

const renderEnhancedDetail = async (id) => {
  if (renderingEnhancedDetail || !id) return;
  renderingEnhancedDetail = true;
  try {
    const result = await api(`/api/v1/tickets/${id}`);
    const ticket = result.data;
    const attachments = ticket.attachments || [];
    const reporter = detailReporter(ticket);
    const reporterCompany = reporter.company || "Sin empresa";
    const reporterContact = reporter.contact || reporter.name || "Sin contacto";
    const assigneeOptions = `<option value="">Sin asignar</option>${users.filter((user) => user.active).map((user) => `<option value="${user.id}" ${ticket.assignedTo?.id === user.id ? "selected" : ""}>${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join("")}`;
    const attachmentsHtml = attachments.length ? `<div class="attachments case-attachments"><div class="section-heading"><h3>Adjuntos</h3><span>${attachments.length} archivo${attachments.length === 1 ? "" : "s"}</span></div><div class="attachment-gallery">${attachments.map(attachmentMarkup).join("")}</div></div>` : `<div class="attachments case-attachments empty-attachments"><h3>Adjuntos</h3><p class="empty-state">Aún no hay archivos en este caso.</p></div>`;
    const solutionButton = ticket.status === "CLOSED" ? "Actualizar solución y reenviar correo" : "Guardar solución y cerrar caso";
    const solutionSummary = ticket.solution ? `<div class="solution-display"><span>Solución enviada</span><p>${escapeHtml(ticket.solution)}</p><small>Actualizada ${detailDate(ticket.solutionUpdatedAt)}</small></div>` : "";

    clearEnhancedPreviews();
    $("detail").dataset.enhancedTicketId = String(id);
    $("detail").innerHTML = `
      <div class="jira-detail-topbar"><div class="jira-breadcrumb"><span>Soporte</span><span>/</span><strong>${escapeHtml(ticket.number)}</strong></div><button id="enhanced-close-detail" class="secondary">Cerrar</button></div>
      <div class="jira-detail-grid">
        <main class="jira-main-column">
          <header class="jira-ticket-heading"><div class="detail-title"><span class="eyebrow">${escapeHtml(ticket.number)}</span><span class="badge ${typeClass(ticket.requestType)}">${escapeHtml(typeLabels[ticket.requestType] || "Otro")}</span><span class="badge ${statusClass(ticket.status)}">${escapeHtml(statusLabels[ticket.status] || ticket.status)}</span>${ticket.sla ? `<span class="badge ${slaClass(ticket.sla)}">${escapeHtml(slaLabel(ticket.sla))}</span>` : ""}</div><h2>${escapeHtml(ticket.title)}</h2><p class="jira-meta-line">Creado ${detailDate(ticket.createdAt)} · Actualizado ${detailDate(ticket.updatedAt)}</p></header>
          <section class="jira-section"><div class="section-heading"><h3>Descripción</h3></div><div class="jira-description">${escapeHtml(ticket.description || "Sin descripción")}</div></section>
          <section class="jira-section evidence-section">${attachmentsHtml}<form id="enhanced-attachment-form" class="compact-upload-form"><label>Agregar imágenes o archivos<input id="enhanced-attachments" type="file" multiple accept="${acceptedCaseFiles}" /></label><div id="enhanced-attachment-preview" class="attachment-preview"></div><button class="secondary" type="submit">Adjuntar al caso</button></form></section>
          <section class="jira-section solution-section"><div class="section-heading"><h3>Solución</h3><span>Este texto se enviará al solicitante</span></div>${solutionSummary}<form id="enhanced-solution-form" class="solution-form"><label>Respuesta de solución<textarea id="enhanced-solution" rows="5" maxlength="100000" placeholder="Explica qué se hizo, el resultado y cualquier recomendación para el solicitante." required>${escapeHtml(ticket.solution || "")}</textarea></label><label>Imágenes o archivos de soporte <span class="label-help">Las imágenes se adjuntarán también al correo, hasta 12 MB en total</span><input id="enhanced-solution-attachments" type="file" multiple accept="${acceptedCaseFiles}" /></label><div id="enhanced-solution-preview" class="attachment-preview"></div><button class="primary-button" type="submit">${solutionButton}</button></form></section>
          <section class="jira-section conversation-section"><div class="section-heading"><h3>Conversación</h3><span>${(ticket.messages || []).length} mensajes</span></div><div class="messages">${(ticket.messages || []).map(enhancedMessage).join("") || "<p class=\"empty-state\">Aún no hay mensajes.</p>"}</div><form id="enhanced-message-form" class="message-form"><label>Agregar actualización<select id="enhanced-message-visibility"><option value="INTERNAL">Nota interna — solo el equipo</option><option value="PUBLIC">Respuesta pública — visible para el solicitante</option></select><textarea id="enhanced-message" rows="3" placeholder="Escribe una actualización para este ticket..." required></textarea></label><button class="primary-button">Guardar actualización</button></form></section>
        </main>
        <aside class="jira-side-column"><section class="jira-property-card jira-actions-card"><label class="detail-control">Estado<select id="enhanced-status"><option value="OPEN" ${ticket.status === "OPEN" ? "selected" : ""}>Abierto</option><option value="IN_PROGRESS" ${ticket.status === "IN_PROGRESS" ? "selected" : ""}>En proceso</option><option value="WAITING" ${ticket.status === "WAITING" ? "selected" : ""}>En espera</option><option value="RESOLVED" ${ticket.status === "RESOLVED" ? "selected" : ""}>Resuelto</option><option value="CLOSED" ${ticket.status === "CLOSED" ? "selected" : ""}>Cerrado</option></select></label><label class="detail-control">Responsable<select id="enhanced-assignee" title="Asignar responsable">${assigneeOptions}</select></label></section><section class="jira-property-card"><h3>Detalles</h3><div class="jira-field"><span>Informador</span><strong>${escapeHtml(reporterCompany)}</strong><small>${escapeHtml(reporterContact)}</small>${reporter.email ? `<small>${escapeHtml(reporter.email)}</small>` : ""}</div><div class="jira-field"><span>Prioridad</span><strong class="priority-${String(ticket.priority || "").toLowerCase()}">${escapeHtml(priorityLabels[ticket.priority] || ticket.priority || "—")}</strong></div><div class="jira-field"><span>Tipo de solicitud</span><strong>${escapeHtml(typeLabels[ticket.requestType] || "Otro")}</strong></div><div class="jira-field"><span>SLA primera respuesta</span><strong>${detailDate(ticket.sla?.firstResponseDueAt)}</strong></div><div class="jira-field"><span>SLA resolución</span><strong>${detailDate(ticket.sla?.resolutionDueAt)}</strong></div></section><section class="jira-property-card activity-side-card"><div class="section-heading"><h3>Actividad</h3><span>Historial</span></div><ol class="activity-list">${(ticket.events || []).map(enhancedEvent).join("") || "<li class=\"empty-state\">Sin actividad registrada.</li>"}</ol></section></aside>
      </div>`;

    $("enhanced-close-detail").addEventListener("click", () => { clearEnhancedPreviews(); $("detail").hidden = true; $("detail").dataset.enhancedTicketId = ""; });
    $("enhanced-status").addEventListener("change", async (event) => {
      if (event.target.value === "CLOSED") {
        event.target.value = ticket.status;
        $("enhanced-solution").focus();
        showNotice("Escribe la solución y usa el botón para cerrar y enviar el correo");
        return;
      }
      try { await api(`/api/v1/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status: event.target.value }) }); showNotice("Estado actualizado"); await loadTickets(); await renderEnhancedDetail(id); } catch (error) { event.target.value = ticket.status; showNotice(error.message, true); }
    });
    $("enhanced-assignee").addEventListener("change", async (event) => { try { await api(`/api/v1/tickets/${id}`, { method: "PATCH", body: JSON.stringify({ assignedUserId: event.target.value || null }) }); showNotice(event.target.value ? "Ticket asignado" : "Asignación retirada"); await loadTickets(); await renderEnhancedDetail(id); } catch (error) { showNotice(error.message, true); } });
    document.querySelectorAll(".attachment-link").forEach((button) => button.addEventListener("click", () => downloadAttachment(id, button.dataset.attachmentId, button.dataset.attachmentName).catch((error) => showNotice(error.message, true))));
    $("enhanced-attachments").addEventListener("change", () => showSelectedFiles($("enhanced-attachments"), $("enhanced-attachment-preview")));
    $("enhanced-solution-attachments").addEventListener("change", () => showSelectedFiles($("enhanced-solution-attachments"), $("enhanced-solution-preview")));
    $("enhanced-attachment-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const files = Array.from($("enhanced-attachments").files || []); if (!files.length) throw new Error("Selecciona al menos un archivo"); const body = new FormData(); files.forEach((file) => body.append("attachments", file, file.name)); await api(`/api/v1/tickets/${id}/attachments`, { method: "POST", body }); showNotice("Archivos adjuntados al caso"); await renderEnhancedDetail(id); } catch (error) { showNotice(error.message, true); } });
    $("enhanced-solution-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const solution = $("enhanced-solution").value.trim(); if (!solution) throw new Error("Escribe la solución que recibirá el solicitante"); const body = new FormData(); body.append("solution", solution); Array.from($("enhanced-solution-attachments").files || []).forEach((file) => body.append("attachments", file, file.name)); await api(`/api/v1/tickets/${id}/solution`, { method: "POST", body }); showNotice(ticket.status === "CLOSED" ? "Solución actualizada y correo reenviado" : "Caso cerrado y solución enviada por correo"); await loadTickets(); await renderEnhancedDetail(id); } catch (error) { showNotice(error.message, true); } });
    $("enhanced-message-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await api(`/api/v1/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ message: $("enhanced-message").value, visibility: $("enhanced-message-visibility").value, authorName: helpdeskUser?.name || "Helpdesk" }) }); showNotice("Actualización guardada"); await renderEnhancedDetail(id); } catch (error) { showNotice(error.message, true); } });
    await hydrateImagePreviews(id);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    renderingEnhancedDetail = false;
  }
};

document.addEventListener("click", (event) => { const card = event.target.closest(".kanban-card"); if (card) enhancedTicketId = card.dataset.id; }, true);
document.addEventListener("click", (event) => { if (event.target.closest("#close-detail")) enhancedTicketId = null; });
const detailObserver = new MutationObserver(() => { const detail = $("detail"); if (!detail || detail.hidden || !enhancedTicketId || detail.dataset.enhancedTicketId === String(enhancedTicketId)) return; window.setTimeout(() => renderEnhancedDetail(enhancedTicketId), 0); });
detailObserver.observe($("detail"), { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

const deepLinkedTicket = new URLSearchParams(window.location.search).get("ticket");
if (deepLinkedTicket) {
  const deepLinkTimer = window.setInterval(() => {
    if (!helpdeskUser || $("app")?.hidden) return;
    enhancedTicketId = deepLinkedTicket;
    loadDetail(deepLinkedTicket);
    window.clearInterval(deepLinkTimer);
  }, 400);
  window.setTimeout(() => window.clearInterval(deepLinkTimer), 30000);
}

const addOpenTicketButtons = () => {
  document.querySelectorAll(".kanban-card").forEach((card) => {
    if (card.querySelector(".ticket-open-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ticket-open-button";
    button.textContent = "Abrir caso";
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); enhancedTicketId = card.dataset.id; loadDetail(card.dataset.id); });
    const footer = card.querySelector(".ticket-card-footer");
    if (footer) footer.appendChild(button); else card.appendChild(button);
  });
};
const boardObserver = new MutationObserver(addOpenTicketButtons);
boardObserver.observe($("tickets"), { childList: true, subtree: true });
addOpenTicketButtons();
