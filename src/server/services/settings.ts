import type { Sql } from "../db";
import { audit } from "../audit";
import { badRequest } from "../errors";

export async function getMaxShiftHours(sql: Sql) {
  const [row] = await sql<{ value: number }[]>`SELECT value FROM app_settings WHERE key = 'max_shift_hours'`;
  return row ? Number(row.value) : 24;
}
export async function setMaxShiftHours(sql: Sql, hours: number, adminId: string) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw badRequest("최대 근무 시간은 1~72시간으로 입력해 주세요.");
  const before = await getMaxShiftHours(sql);
  await sql`UPDATE app_settings SET value = ${sql.json(hours)}, updated_by = ${adminId}, updated_at = clock_timestamp() WHERE key = 'max_shift_hours'`;
  await audit(sql, { administratorId: adminId, action: "settings.update", targetType: "app_settings", targetId: "max_shift_hours", before, after: hours });
}
