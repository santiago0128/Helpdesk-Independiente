import "dotenv/config";
import { getPool } from "../src/db.js";
import { selectAutomaticAssignee } from "../src/assignment.js";
import { updateTicket } from "../src/tickets.js";

const shouldApply = process.argv.includes("--apply");
const candidateSql = `SELECT u.id, u.display_name, u.email,
    SUM(CASE WHEN t.status IN (N'OPEN', N'IN_PROGRESS', N'WAITING') THEN 1 ELSE 0 END) AS active_ticket_count,
    MAX(t.created_at) AS last_assignment_at
  FROM dbo.hd_users u
  JOIN dbo.hd_roles r ON r.id = u.role_id AND r.active = 1
  LEFT JOIN dbo.hd_tickets t ON t.assigned_user_id = u.id
  WHERE u.active = 1
    AND EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(r.permissions) = 1 THEN r.permissions ELSE N'[]' END) WHERE [value] = N'VIEW_TICKETS')
    AND EXISTS (SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(r.permissions) = 1 THEN r.permissions ELSE N'[]' END) WHERE [value] = N'UPDATE_TICKETS')
  GROUP BY u.id, u.display_name, u.email`;

const pool = await getPool();
const pending = await pool.request().query(`SELECT id FROM dbo.hd_tickets
  WHERE assigned_user_id IS NULL AND status IN (N'OPEN', N'IN_PROGRESS', N'WAITING')
  ORDER BY created_at, id`);

let assigned = 0;
for (const ticket of pending.recordset) {
  const candidates = await pool.request().query(candidateSql);
  const assignee = selectAutomaticAssignee(candidates.recordset);
  if (!assignee) break;
  if (shouldApply) await updateTicket(ticket.id, { assignedUserId: assignee.id });
  assigned += 1;
}

console.log(JSON.stringify({ mode: shouldApply ? "apply" : "preview", pending: pending.recordset.length, assigned }));
await pool.close();
