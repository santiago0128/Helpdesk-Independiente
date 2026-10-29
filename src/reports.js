import { getPool, sql } from "./db.js";

const dateRange = ({ from = "", to = "" } = {}) => {
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 30 * 86400000);
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw Object.assign(new Error("Rango de fechas inválido"), { status: 400 });
  }
  return { fromDate, toDate };
};

export const getReportSummary = async (range = {}) => {
  const { fromDate, toDate } = dateRange(range);
  const pool = await getPool();
  const request = () => pool.request().input("from", sql.DateTime2, fromDate).input("to", sql.DateTime2, toDate);
  const [summary, byStatus, byPriority, byAssignee] = await Promise.all([
    request().query(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = N'OPEN' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status = N'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
      SUM(CASE WHEN status = N'WAITING' THEN 1 ELSE 0 END) AS waiting_count,
      SUM(CASE WHEN status IN (N'RESOLVED', N'CLOSED') THEN 1 ELSE 0 END) AS resolved_count,
      AVG(CASE WHEN first_response_at IS NOT NULL THEN CAST(DATEDIFF(SECOND, created_at, first_response_at) AS FLOAT) END) AS avg_first_response_seconds,
      AVG(CASE WHEN resolved_at IS NOT NULL THEN CAST(DATEDIFF(SECOND, created_at, resolved_at) AS FLOAT) END) AS avg_resolution_seconds,
      SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at <= sla_first_response_due_at THEN 1 ELSE 0 END) AS first_response_on_time,
      SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at > sla_first_response_due_at THEN 1 ELSE 0 END) AS first_response_late,
      SUM(CASE WHEN resolved_at IS NOT NULL AND resolved_at <= sla_resolution_due_at THEN 1 ELSE 0 END) AS resolution_on_time,
      SUM(CASE WHEN resolved_at IS NOT NULL AND resolved_at > sla_resolution_due_at THEN 1 ELSE 0 END) AS resolution_late
      FROM dbo.hd_tickets WHERE created_at >= @from AND created_at <= @to`),
    request().query(`SELECT status AS value, COUNT(*) AS total FROM dbo.hd_tickets WHERE created_at >= @from AND created_at <= @to GROUP BY status ORDER BY total DESC`),
    request().query(`SELECT priority AS value, COUNT(*) AS total FROM dbo.hd_tickets WHERE created_at >= @from AND created_at <= @to GROUP BY priority ORDER BY total DESC`),
    request().query(`SELECT COALESCE(u.display_name, N'Sin asignar') AS value, COUNT(*) AS total FROM dbo.hd_tickets t LEFT JOIN dbo.hd_users u ON u.id = t.assigned_user_id WHERE t.created_at >= @from AND t.created_at <= @to GROUP BY COALESCE(u.display_name, N'Sin asignar') ORDER BY total DESC`),
  ]);
  const row = summary.recordset[0] || {};
  const firstTotal = Number(row.first_response_on_time || 0) + Number(row.first_response_late || 0);
  const resolutionTotal = Number(row.resolution_on_time || 0) + Number(row.resolution_late || 0);
  return {
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    summary: {
      total: Number(row.total || 0), open: Number(row.open_count || 0), inProgress: Number(row.in_progress_count || 0),
      waiting: Number(row.waiting_count || 0), resolved: Number(row.resolved_count || 0),
      averageFirstResponseSeconds: Math.round(Number(row.avg_first_response_seconds || 0)),
      averageResolutionSeconds: Math.round(Number(row.avg_resolution_seconds || 0)),
      firstResponseSlaPercent: firstTotal ? Math.round(Number(row.first_response_on_time || 0) * 10000 / firstTotal) / 100 : null,
      resolutionSlaPercent: resolutionTotal ? Math.round(Number(row.resolution_on_time || 0) * 10000 / resolutionTotal) / 100 : null,
    },
    byStatus: byStatus.recordset,
    byPriority: byPriority.recordset,
    byAssignee: byAssignee.recordset,
  };
};
