import type { Sql } from "./db";

export async function audit(sql: Sql, entry: {
  administratorId?: string | null; action: string; targetType: string; targetId?: string | null;
  before?: unknown; after?: unknown; reason?: string | null;
}) {
  await sql`
    INSERT INTO audit_logs (administrator_id, action, target_type, target_id, before, after, reason)
    VALUES (${entry.administratorId ?? null}, ${entry.action}, ${entry.targetType}, ${entry.targetId ?? null},
            ${entry.before === undefined ? null : sql.json(entry.before as never)},
            ${entry.after === undefined ? null : sql.json(entry.after as never)},
            ${entry.reason ?? null})`;
}
