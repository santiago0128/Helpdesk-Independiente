import crypto from "node:crypto";
import { getPool, sql } from "./db.js";

const getRawToken = (req) => {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return String(req.headers["x-helpdesk-token"] || req.headers["x-api-key"] || "").trim();
};

const hashToken = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

export const requireToken = (types = []) => async (req, res, next) => {
  const raw = getRawToken(req);
  if (!raw) return res.status(401).json({ error: "Token de mesa de ayuda requerido" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("hash", sql.VarChar(64), hashToken(raw))
      .query(`SELECT TOP 1 id, name, source, token_type, active
              FROM dbo.hd_tokens WHERE token_hash = @hash AND active = 1`);
    const token = result.recordset[0];
    if (!token || (types.length && !types.includes(token.token_type))) {
      return res.status(401).json({ error: "Token inválido o sin permisos" });
    }
    req.helpdeskToken = token;
    await pool.request().input("id", sql.Int, token.id)
      .query("UPDATE dbo.hd_tokens SET last_used_at = SYSUTCDATETIME() WHERE id = @id");
    return next();
  } catch (error) {
    return next(error);
  }
};

export const generateToken = () => `hd_${crypto.randomBytes(32).toString("hex")}`;
export const tokenHash = hashToken;
