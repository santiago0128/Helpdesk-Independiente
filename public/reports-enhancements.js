const reportStatusLabels = { OPEN: "Abiertos", IN_PROGRESS: "En proceso", WAITING: "En espera", RESOLVED: "Resueltos", CLOSED: "Cerrados" };
const reportPriorityLabels = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", URGENT: "Urgente" };
const reportDate = (date) => date.toISOString().slice(0, 10);
const reportDuration = (seconds) => { const value = Number(seconds) || 0; if (!value) return "—"; const hours = Math.floor(value / 3600); const minutes = Math.round((value % 3600) / 60); return hours ? `${hours} h ${minutes} min` : `${minutes} min`; };
const reportTable = (items, labels = {}) => items?.length ? `<table><thead><tr><th>Elemento</th><th>Total</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(labels[item.value] || item.value || "Sin asignar")}</td><td><strong>${Number(item.total || 0)}</strong></td></tr>`).join("")}</tbody></table>` : `<p class="report-empty">Sin datos en el periodo seleccionado.</p>`;
const auditActionLabels = { LOGIN_SUCCESS: "Inicio de sesión", LOGIN_FAILED: "Inicio fallido", LOGIN_LOCKED: "Cuenta bloqueada", LOGIN_BLOCKED: "Intento bloqueado", PASSWORD_RESET_REQUESTED: "Recuperación solicitada", PASSWORD_RESET_COMPLETED: "Contraseña actualizada", TICKET_CREATED: "Ticket creado", TICKET_UPDATED: "Ticket actualizado", TICKET_MESSAGE_ADDED: "Mensaje agregado", USER_CREATED: "Usuario creado", USER_UPDATED: "Usuario actualizado", ROLE_CREATED: "Rol creado", ROLE_UPDATED: "Rol actualizado", ROLE_DELETED: "Rol eliminado", LOGOUT: "Cierre de sesión" };
const loadReports = async () => {
  const from = $("report-from").value;
  const to = $("report-to").value;
  const query = new URLSearchParams({ from, to });
  const result = await api(`/api/v1/reports/summary?${query}`);
  const data = result.data;
  const summary = data.summary || {};
  $("report-summary").innerHTML = [
    ["Tickets", summary.total], ["Primera respuesta", reportDuration(summary.averageFirstResponseSeconds)], ["Resolución promedio", reportDuration(summary.averageResolutionSeconds)], ["SLA primera respuesta", summary.firstResponseSlaPercent === null ? "—" : `${summary.firstResponseSlaPercent}%`], ["SLA resolución", summary.resolutionSlaPercent === null ? "—" : `${summary.resolutionSlaPercent}%`],
  ].map(([label, value]) => `<div class="report-stat"><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`).join("");
  $("report-status").innerHTML = reportTable(data.byStatus, reportStatusLabels);
  $("report-priority").innerHTML = reportTable(data.byPriority, reportPriorityLabels);
  $("report-assignee").innerHTML = reportTable(data.byAssignee);
  try {
    const audit = await api(`/api/v1/audit?${query}&limit=80`);
    $("report-audit").innerHTML = audit.data?.length ? `<table><thead><tr><th>Acción</th><th>Usuario</th><th>Fecha</th></tr></thead><tbody>${audit.data.map((item) => `<tr><td><strong>${escapeHtml(auditActionLabels[item.action] || item.action)}</strong><small>${escapeHtml(item.entity_type || "")} ${escapeHtml(item.entity_id || "")}</small></td><td>${escapeHtml(item.actor_name || item.actor_email || "Sistema")}</td><td>${escapeHtml(new Date(item.created_at).toLocaleString())}</td></tr>`).join("")}</tbody></table>` : `<p class="report-empty">Sin actividad en el periodo seleccionado.</p>`;
  } catch (error) { $("report-audit").innerHTML = `<p class="report-empty">La auditoría está disponible para administradores.</p>`; }
};

(() => {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86400000);
  $("report-from").value = reportDate(from);
  $("report-to").value = reportDate(now);
  $("refresh-reports").addEventListener("click", () => loadReports().catch((error) => showNotice(error.message, true)));
})();
