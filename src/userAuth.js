import crypto from "node:crypto";
import { promisify } from "node:util";
import { getPool, sql } from "./db.js";
import { recordAudit } from "./audit.js";
import { notifyPasswordReset } from "./email.js";
import { getSecurityState, withSecurityState } from "./securityState.js";

const scrypt = promisify(crypto.scrypt);
const sessionTtlHours = Math.max(Number(process.env.HELPDESK_SESSION_TTL_HOURS || 12), 1);
const maxLoginFailures = Math.max(Number(process.env.HELPDESK_MAX_LOGIN_FAILURES || 5), 3);
const lockMinutes = Math.max(Number(process.env.HELPDESK_LOCK_MINUTES || 15), 5);

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

const parsePermissions = (value) => {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []; } catch { return []; }
};
const mapRole = (row) => row?.role_id ? { id: row.role_id, key: row.role_key || row.role, name: row.role_name || row.role_key || row.role, description: row.role_description || "", permissions: parsePermissions(row.permissions), active: row.role_active !== false } : null;
const mapUser = (row) => ({ id: row.id, email: row.email, name: row.display_name, role: row.role_key || row.role, roleId: row.role_id || null, roleName: row.role_name || row.role_key || row.role, permissions: parsePermissions(row.permissions), active: Boolean(row.active), createdAt: row.created_at });
const userSelect = `SELECT u.id, u.email, u.display_name, u.role, u.role_id, u.active, u.created_at,
  r.role_key, r.display_name AS role_name, r.description AS role_description, r.permissions, r.active AS role_active
  FROM dbo.hd_users u LEFT JOIN dbo.hd_roles r ON r.id = u.role_id`;
const normalizePermissions = (permissions = []) => [...new Set((Array.isArray(permissions) ? permissions : []).map((item) => String(item).trim().toUpperCase()).filter((item) => ["VIEW_TICKETS", "CREATE_TICKETS", "UPDATE_TICKETS", "ASSIGN_TICKETS", "MANAGE_USERS", "MANAGE_ROLES"].includes(item)))];
const normalizeRoleKey = (value) => {
  const key = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return key || `ROLE_${crypto.randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 30);
};
const getRole = async (pool, { roleId, role } = {}) => {
  const request = pool.request();
  if (roleId !== undefined && roleId !== null && roleId !== "") {
    const id = Number(roleId);
    if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Rol inválido"), { status: 400 });
    const result = await request.input("roleId", sql.Int, id).query("SELECT TOP 1 * FROM dbo.hd_roles WHERE id = @roleId AND active = 1");
    if (!result.recordset[0]) throw Object.assign(new Error("El rol no existe o está inactivo"), { status: 400 });
    return result.recordset[0];
  }
  const key = String(role || "AGENT").trim().toUpperCase();
  const result = await request.input("roleKey", sql.NVarChar(30), key).query("SELECT TOP 1 * FROM dbo.hd_roles WHERE role_key = @roleKey AND active = 1");
  if (!result.recordset[0]) throw Object.assign(new Error("El rol no existe o está inactivo"), { status: 400 });
  return result.recordset[0];
};

export const createUser = async ({ email, password, name, role = "AGENT", roleId }) => {
  const normalizedEmail = clean(email, 254).toLowerCase();
  const cleanPassword = String(password || "");
  if (!normalizedEmail || !cleanPassword || cleanPassword.length < 10) {
    throw Object.assign(new Error("email y una contraseña de mínimo 10 caracteres son obligatorios"), { status: 400 });
  }
  const pool = await getPool();
  const selectedRole = await getRole(pool, { roleId, role });
  const hash = await passwordHash(cleanPassword);
  const result = await pool.request()
    .input("email", sql.NVarChar(254), normalizedEmail)
    .input("passwordHash", sql.NVarChar(300), hash)
    .input("name", sql.NVarChar(160), clean(name, 160) || normalizedEmail)
    .input("role", sql.NVarChar(30), selectedRole.role_key)
    .input("roleId", sql.Int, selectedRole.id)
    .query(`INSERT INTO dbo.hd_users (email, password_hash, display_name, role, role_id)
            OUTPUT INSERTED.id, INSERTED.email, INSERTED.display_name, INSERTED.role, INSERTED.role_id
            VALUES (@email, @passwordHash, @name, @role, @roleId)`);
  return { ...result.recordset[0], roleId: result.recordset[0].role_id, roleName: selectedRole.display_name, permissions: parsePermissions(selectedRole.permissions) };
};

export const listUsers = async () => {
  const pool = await getPool();
  const result = await pool.request().query(`${userSelect} ORDER BY u.active DESC, u.display_name, u.id`);
  return result.recordset.map(mapUser);
};

export const updateUser = async (id, payload = {}) => {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) throw Object.assign(new Error("Usuario inválido"), { status: 400 });
  const name = clean(payload.name ?? payload.displayName, 160);
  const email = payload.email !== undefined ? clean(payload.email, 254).toLowerCase() : null;
  const activeProvided = payload.active !== undefined;
  const active = activeProvided ? Boolean(payload.active) : null;
  const password = String(payload.password || "");
  if (payload.name !== undefined && !name) throw Object.assign(new Error("El nombre es obligatorio"), { status: 400 });
  if (payload.email !== undefined && !email) throw Object.assign(new Error("El correo es obligatorio"), { status: 400 });
  if (password && password.length < 10) throw Object.assign(new Error("La contraseña debe tener mínimo 10 caracteres"), { status: 400 });
  const pool = await getPool();
  const roleChanged = payload.roleId !== undefined || payload.role !== undefined;
  const selectedRole = roleChanged ? await getRole(pool, { roleId: payload.roleId, role: payload.role }) : null;
  const hash = password ? await passwordHash(password) : null;
  const result = await pool.request()
    .input("id", sql.Int, userId)
    .input("email", sql.NVarChar(254), email)
    .input("name", sql.NVarChar(160), name || null)
    .input("role", sql.NVarChar(30), selectedRole?.role_key || null)
    .input("roleId", sql.Int, selectedRole?.id || null)
    .input("active", sql.Bit, active)
    .input("passwordHash", sql.NVarChar(300), hash)
    .query(`UPDATE dbo.hd_users SET
      email = COALESCE(@email, email),
      display_name = COALESCE(@name, display_name),
      role = COALESCE(@role, role),
      role_id = COALESCE(@roleId, role_id),
      active = COALESCE(@active, active),
      password_hash = COALESCE(@passwordHash, password_hash)
      OUTPUT INSERTED.id, INSERTED.email, INSERTED.display_name, INSERTED.role, INSERTED.active
      WHERE id = @id`);
  if (!result.recordset[0]) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
  const user = result.recordset[0];
  return mapUser(user);
};

export const listRoles = async () => {
  const pool = await getPool();
  const result = await pool.request().query("SELECT id, role_key, display_name, description, permissions, active, built_in, created_at FROM dbo.hd_roles ORDER BY built_in DESC, active DESC, display_name, id");
  return result.recordset.map((role) => ({ id: role.id, key: role.role_key, name: role.display_name, description: role.description || "", permissions: parsePermissions(role.permissions), active: Boolean(role.active), builtIn: Boolean(role.built_in), createdAt: role.created_at }));
};

export const createRole = async ({ key, name, description, permissions }) => {
  const roleName = clean(name, 120);
  if (!roleName) throw Object.assign(new Error("El nombre del rol es obligatorio"), { status: 400 });
  const roleKey = normalizeRoleKey(key || roleName);
  const selectedPermissions = normalizePermissions(permissions);
  const pool = await getPool();
  const result = await pool.request()
    .input("key", sql.NVarChar(30), roleKey)
    .input("name", sql.NVarChar(120), roleName)
    .input("description", sql.NVarChar(300), clean(description, 300) || null)
    .input("permissions", sql.NVarChar(sql.MAX), JSON.stringify(selectedPermissions))
    .query(`INSERT INTO dbo.hd_roles (role_key, display_name, description, permissions)
      OUTPUT INSERTED.id, INSERTED.role_key, INSERTED.display_name, INSERTED.description, INSERTED.permissions, INSERTED.active, INSERTED.built_in, INSERTED.created_at
      VALUES (@key, @name, @description, @permissions)`);
  const role = result.recordset[0];
  return { id: role.id, key: role.role_key, name: role.display_name, description: role.description || "", permissions: parsePermissions(role.permissions), active: Boolean(role.active), builtIn: Boolean(role.built_in), createdAt: role.created_at };
};

export const updateRole = async (id, payload = {}) => {
  const roleId = Number(id);
  if (!Number.isInteger(roleId) || roleId <= 0) throw Object.assign(new Error("Rol inválido"), { status: 400 });
  const name = payload.name !== undefined ? clean(payload.name, 120) : null;
  const description = payload.description !== undefined ? clean(payload.description, 300) : null;
  const active = payload.active !== undefined ? Boolean(payload.active) : null;
  const permissions = payload.permissions !== undefined ? JSON.stringify(normalizePermissions(payload.permissions)) : null;
  if (payload.name !== undefined && !name) throw Object.assign(new Error("El nombre del rol es obligatorio"), { status: 400 });
  const pool = await getPool();
  const result = await pool.request().input("id", sql.Int, roleId).input("name", sql.NVarChar(120), name).input("description", sql.NVarChar(300), description).input("active", sql.Bit, active).input("permissions", sql.NVarChar(sql.MAX), permissions)
    .query(`UPDATE dbo.hd_roles SET display_name = COALESCE(@name, display_name), description = COALESCE(@description, description), active = COALESCE(@active, active), permissions = COALESCE(@permissions, permissions)
      OUTPUT INSERTED.id, INSERTED.role_key, INSERTED.display_name, INSERTED.description, INSERTED.permissions, INSERTED.active, INSERTED.built_in, INSERTED.created_at WHERE id = @id`);
  if (!result.recordset[0]) throw Object.assign(new Error("Rol no encontrado"), { status: 404 });
  const role = result.recordset[0];
  return { id: role.id, key: role.role_key, name: role.display_name, description: role.description || "", permissions: parsePermissions(role.permissions), active: Boolean(role.active), builtIn: Boolean(role.built_in), createdAt: role.created_at };
};

export const loginUser = async ({ email, password, ipAddress = null, userAgent = null }) => {
  const pool = await getPool();
  const normalizedEmail = clean(email, 254).toLowerCase();
  const result = await pool.request().input("email", sql.NVarChar(254), normalizedEmail)
    .query(`${userSelect.replace("u.created_at,", "u.created_at, u.password_hash,")} WHERE u.email = @email AND u.active = 1`);
  const user = result.recordset[0];
  const state = await getSecurityState();
  const loginState = state.login?.[normalizedEmail] || { failures: 0, lockedUntil: null };
  if (loginState.lockedUntil && new Date(loginState.lockedUntil).getTime() > Date.now()) {
    await recordAudit({ action: "LOGIN_BLOCKED", entityType: "USER", entityId: user.id, ipAddress, userAgent });
    throw Object.assign(new Error("Cuenta temporalmente bloqueada por demasiados intentos. Intenta más tarde."), { status: 429 });
  }
  if (!user || !(await passwordMatches(password, user.password_hash))) {
    if (user) {
      const failures = Number(loginState.failures || 0) + 1;
      const lockedUntil = failures >= maxLoginFailures ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString() : null;
      await withSecurityState((current) => { current.login = current.login || {}; current.login[normalizedEmail] = { failures, lockedUntil }; });
      await recordAudit({ action: failures >= maxLoginFailures ? "LOGIN_LOCKED" : "LOGIN_FAILED", entityType: "USER", entityId: user.id, metadata: { failures }, ipAddress, userAgent });
      if (lockedUntil) throw Object.assign(new Error("Cuenta temporalmente bloqueada por demasiados intentos. Intenta más tarde."), { status: 429 });
    } else {
      await recordAudit({ action: "LOGIN_FAILED", entityType: "USER", metadata: { email: normalizedEmail }, ipAddress, userAgent });
    }
    throw Object.assign(new Error("Correo o contraseña incorrectos"), { status: 401 });
  }
  await withSecurityState((current) => { current.login = current.login || {}; delete current.login[normalizedEmail]; });
  const rawToken = rawSessionToken();
  await pool.request()
    .input("userId", sql.Int, user.id)
    .input("tokenHash", sql.VarChar(64), sessionHash(rawToken))
    .input("expiresAt", sql.DateTime2, new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000))
    .query("INSERT INTO dbo.hd_sessions (user_id, token_hash, expires_at) VALUES (@userId, @tokenHash, @expiresAt)");
  await recordAudit({ actorUserId: user.id, action: "LOGIN_SUCCESS", entityType: "USER", entityId: user.id, ipAddress, userAgent });
  return { token: rawToken, user: mapUser(user) };
};

export const requestPasswordReset = async ({ email, ipAddress = null, userAgent = null }) => {
  const normalizedEmail = clean(email, 254).toLowerCase();
  const pool = await getPool();
  const result = await pool.request().input("email", sql.NVarChar(254), normalizedEmail)
    .query("SELECT TOP 1 id, email, display_name, active FROM dbo.hd_users WHERE email = @email");
  const user = result.recordset[0];
  if (user?.active) {
    const rawToken = `pr_${crypto.randomBytes(32).toString("hex")}`;
    await withSecurityState((state) => { state.resets = state.resets || {}; state.resets[sessionHash(rawToken)] = { userId: user.id, email: user.email, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), used: false }; });
    void notifyPasswordReset({ email: user.email, name: user.display_name, token: rawToken });
    await recordAudit({ action: "PASSWORD_RESET_REQUESTED", entityType: "USER", entityId: user.id, ipAddress, userAgent });
  } else {
    await recordAudit({ action: "PASSWORD_RESET_REQUESTED", entityType: "USER", metadata: { email: normalizedEmail }, ipAddress, userAgent });
  }
  return { accepted: true };
};

export const resetPassword = async ({ token, password, ipAddress = null, userAgent = null }) => {
  const cleanToken = String(token || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanToken || cleanPassword.length < 10) throw Object.assign(new Error("El enlace y una contraseña de mínimo 10 caracteres son obligatorios"), { status: 400 });
  const pool = await getPool();
  const state = await getSecurityState();
  const reset = state.resets?.[sessionHash(cleanToken)];
  if (!reset || reset.used || new Date(reset.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error("El enlace de recuperación no es válido o ya expiró"), { status: 400 });
  const hash = await passwordHash(cleanPassword);
  const userId = Number(reset.userId);
  await pool.request().input("userId", sql.Int, userId).input("passwordHash", sql.NVarChar(300), hash)
    .query("UPDATE dbo.hd_users SET password_hash = @passwordHash WHERE id = @userId; DELETE FROM dbo.hd_sessions WHERE user_id = @userId");
  await withSecurityState((current) => { current.resets = current.resets || {}; if (current.resets[sessionHash(cleanToken)]) current.resets[sessionHash(cleanToken)].used = true; });
  await recordAudit({ actorUserId: userId, action: "PASSWORD_RESET_COMPLETED", entityType: "USER", entityId: userId, ipAddress, userAgent });
  return { changed: true };
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
      .query(`SELECT TOP 1 u.id, u.email, u.display_name, u.role, u.role_id, u.active,
                r.role_key, r.display_name AS role_name, r.description AS role_description, r.permissions, r.active AS role_active
              FROM dbo.hd_sessions s JOIN dbo.hd_users u ON u.id = s.user_id
              LEFT JOIN dbo.hd_roles r ON r.id = u.role_id
              WHERE s.token_hash = @tokenHash AND s.expires_at > SYSUTCDATETIME() AND u.active = 1`);
    if (!result.recordset[0]) return res.status(401).json({ error: "Sesión expirada", logout: true });
    req.helpdeskUser = mapUser(result.recordset[0]);
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

export const requirePermission = (permission) => (req, res, next) => {
  if (!req.helpdeskUser?.permissions?.includes(permission)) return res.status(403).json({ error: "No tienes permisos para realizar esta acción" });
  return next();
};
export const requireAnyPermission = (permissions) => (req, res, next) => {
  if (!permissions.some((permission) => req.helpdeskUser?.permissions?.includes(permission))) return res.status(403).json({ error: "No tienes permisos para realizar esta acción" });
  return next();
};
export const requireAdmin = requirePermission("MANAGE_USERS");
