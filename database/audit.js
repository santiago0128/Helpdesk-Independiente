import { getPool, sql } from "./db.js";

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export const recordAudit = async ({ actorUserId = null, action, entityType = null, entityId = null, metadata = null, ipAddress = null, userAgent = null } = {}) => {
  if (!action) return;
  try {
    const pool = await getPool();
    await pool.request()
      .input("actorUserId", sql.Int, actorUserId ? Number(actorUserId) : null)
      .input("action", sql.NVarChar(80), clean(action, 80))
      .input("entityType", sql.NVarChar(60), clean(entityType, 60) || null)
      .input("entityId", sql.NVarChar(120), clean(entityId, 120) || null)
      .input("metadata", sql.NVarChar(sql.MAX), metadata ? JSON.stringify(metadata).slice(0, 10000) : null)
      .input("ipAddress", sql.NVarChar(64), clean(ipAddress, 64) || null)
      .input("userAgent", sql.NVarChar(500), clean(userAgent, 500) || null)
      .query(`INSERT INTO dbo.hd_audit_log
        (actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
        VALUES (@actorUserId, @action, @entityType, @entityId, @metadata, @ipAddress, @userAgent)`);
  } catch (error) {
    console.error("[helpdesk-audit] No fue posible registrar la auditoría:", error.message);
  }
};

export const listAudit = async ({ limit = 100, from = "", to = "" } = {}) => {
  const pool = await getPool();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : new Date(Date.now() - 30 * 86400000);
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
  const result = await pool.request()
    .input("from", sql.DateTime2, fromDate)
    .input("to", sql.DateTime2, toDate)
    .input("limit", sql.Int, safeLimit)
    .query(`SELECT TOP (@limit) a.id, a.action, a.entity_type, a.entity_id, a.metadata,
      a.ip_address, a.created_at, u.display_name AS actor_name, u.email AS actor_email
      FROM dbo.hd_audit_log a LEFT JOIN dbo.hd_users u ON u.id = a.actor_user_id
      WHERE a.created_at >= @from AND a.created_at <= @to
      ORDER BY a.created_at DESC, a.id DESC`);
  return result.recordset;
};
