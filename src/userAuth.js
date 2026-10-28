import crypto from "node:crypto";
import { promisify } from "node:util";
import { getPool, sql } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const sessionTtlDays = 7;

const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const passwordHash = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(String(password), salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
};
const passwordMatches = async (password, stored) => {
  const [algorithm, salt, expectedHex] = String(stored || "").split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const derived = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
};
const sessionHash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const rawSessionToken = () => `hs_${crypto.randomBytes(32).toString("hex")}`;

export const createUser = async ({ email, password, name, role = "AGENT" }) => {
  const normalizedEmail = clean(email, 254).toLowerCase();
  const cleanPassword = String(password || "");
  if (!normalizedEmail || !cleanPassword || cleanPassword.length < 10) {
    throw Object.assign(new Error("email y una contraseña de mínimo 10 caracteres son obligatorios"), { status: 400 });
  }
  const pool = await getPool();
  const hash = await passwordHash(cleanPassword);
  const result = await pool.request()
    .input("email", sql.NVarChar(254), normalizedEmail)
    .input("passwordHash", sql.NVarChar(300), hash)
    .input("name", sql.NVarChar(160), clean(name, 160) || normalizedEmail)
    .input("role", sql.NVarChar(30), role === "ADMIN" ? "ADMIN" : "AGENT")
    .query(`INSERT INTO dbo.hd_users (email, password_hash, display_name, role)
            OUTPUT INSERTED.id, INSERTED.email, INSERTED.display_name, INSERTED.role
            VALUES (@email, @passwordHash, @name, @role)`);
  return result.recordset[0];
};

export const listUsers = async () => {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT id, email, display_name, role, active, created_at
    FROM dbo.hd_users ORDER BY active DESC, display_name, id`);
  return result.recordset.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.display_name,
    role: user.role,
    active: Boolean(user.active),
    createdAt: user.created_at,
  }));
};

export const updateUser = async (id, payload = {}) => {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) throw Object.assign(new Error("Usuario inválido"), { status: 400 });
  const name = clean(payload.name ?? payload.displayName, 160);
  const role = payload.role === "ADMIN" ? "ADMIN" : payload.role === "AGENT" ? "AGENT" : null;
  const activeProvided = payload.active !== undefined;
  const active = activeProvided ? Boolean(payload.active) : null;
  const password = String(payload.password || "");
  if (payload.name !== undefined && !name) throw Object.assign(new Error("El nombre es obligatorio"), { status: 400 });
  if (password && password.length < 10) throw Object.assign(new Error("La contraseña debe tener mínimo 10 caracteres"), { status: 400 });
  const pool = await getPool();
  const hash = password ? await passwordHash(password) : null;
  const result = await pool.request()
    .input("id", sql.Int, userId)
    .input("name", sql.NVarChar(160), name || null)
    .input("role", sql.NVarChar(30), role)
    .input("active", sql.Bit, active)
    .input("passwordHash", sql.NVarChar(300), hash)
    .query(`UPDATE dbo.hd_users SET
      display_name = COALESCE(@name, display_name),
      role = COALESCE(@role, role),
      active = COALESCE(@active, active),
      password_hash = COALESCE(@passwordHash, password_hash)
      OUTPUT INSERTED.id, INSERTED.email, INSERTED.display_name, INSERTED.role, INSERTED.active
      WHERE id = @id`);
  if (!result.recordset[0]) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
  const user = result.recordset[0];
  return { id: user.id, email: user.email, name: user.display_name, role: user.role, active: Boolean(user.active) };
};

export const loginUser = async ({ email, password }) => {
  const pool = await getPool();
  const result = await pool.request().input("email", sql.NVarChar(254), clean(email, 254).toLowerCase())
    .query("SELECT TOP 1 * FROM dbo.hd_users WHERE email = @email AND active = 1");
  const user = result.recordset[0];
  if (!user || !(await passwordMatches(password, user.password_hash))) {
    throw Object.assign(new Error("Correo o contraseña incorrectos"), { status: 401 });
  }
  const rawToken = rawSessionToken();
  await pool.request()
    .input("userId", sql.Int, user.id)
    .input("tokenHash", sql.VarChar(64), sessionHash(rawToken))
    .input("expiresAt", sql.DateTime2, new Date(Date.now() + sessionTtlDays * 86400000))
    .query("INSERT INTO dbo.hd_sessions (user_id, token_hash, expires_at) VALUES (@userId, @tokenHash, @expiresAt)");
  return { token: rawToken, user: { id: user.id, email: user.email, name: user.display_name, role: user.role } };
};

const getSessionToken = (req) => {
  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return String(req.headers["x-session-token"] || "").trim();
};

export const requireUser = async (req, res, next) => {
  const rawToken = getSessionToken(req);
  if (!rawToken) return res.status(401).json({ error: "Sesión requerida", logout: true });
  try {
    const pool = await getPool();
    const result = await pool.request().input("tokenHash", sql.VarChar(64), sessionHash(rawToken))
      .query(`SELECT TOP 1 u.id, u.email, u.display_name, u.role
              FROM dbo.hd_sessions s JOIN dbo.hd_users u ON u.id = s.user_id
              WHERE s.token_hash = @tokenHash AND s.expires_at > SYSUTCDATETIME() AND u.active = 1`);
    if (!result.recordset[0]) return res.status(401).json({ error: "Sesión expirada", logout: true });
    req.helpdeskUser = result.recordset[0];
    return next();
  } catch (error) {
    return next(error);
  }
};

export const logoutUser = async (req) => {
  const rawToken = getSessionToken(req);
  if (!rawToken) return;
  const pool = await getPool();
  await pool.request().input("tokenHash", sql.VarChar(64), sessionHash(rawToken))
    .query("DELETE FROM dbo.hd_sessions WHERE token_hash = @tokenHash");
};

export const requireAdmin = (req, res, next) => {
  if (req.helpdeskUser?.role !== "ADMIN") return res.status(403).json({ error: "Solo un administrador puede realizar esta acción" });
  return next();
};
