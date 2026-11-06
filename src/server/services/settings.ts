import type { Sql } from "../db";

export async function getMaxShiftHours(sql: Sql) {
  const [row] = await sql<{ value: number }[]>`SELECT value FROM app_settings WHERE key = 'max_shift_hours'`;
  return row ? Number(row.value) : 24;
}
