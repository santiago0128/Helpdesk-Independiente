import { getPool, sql } from "./db.js";

export const deleteRole = async (id) => {
  const roleId = Number(id);
  if (!Number.isInteger(roleId) || roleId <= 0) throw Object.assign(new Error("Rol inválido"), { status: 400 });
  const pool = await getPool();
  const roleResult = await pool.request().input("id", sql.Int, roleId).query("SELECT TOP 1 id, display_name, built_in FROM dbo.hd_roles WHERE id = @id");
  const role = roleResult.recordset[0];
  if (!role) throw Object.assign(new Error("Rol no encontrado"), { status: 404 });
  if (role.built_in) throw Object.assign(new Error("Los roles predeterminados no se pueden eliminar"), { status: 400 });
  const usersResult = await pool.request().input("roleId", sql.Int, roleId).query("SELECT COUNT(*) AS total FROM dbo.hd_users WHERE role_id = @roleId");
  const assignedUsers = Number(usersResult.recordset[0]?.total || 0);
  if (assignedUsers > 0) throw Object.assign(new Error(`No se puede eliminar: ${assignedUsers} usuario(s) todavía tienen este rol`), { status: 409 });
  await pool.request().input("id", sql.Int, roleId).query("DELETE FROM dbo.hd_roles WHERE id = @id");
  return { id: role.id, name: role.display_name };
};
