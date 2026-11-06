import type { Sql } from "../db";
import { getDaily } from "./attendance";
import { getMaxShiftHours } from "./settings";
import { kstDate } from "@/lib/format";

export async function getDashboard(sql: Sql) {
  const date = kstDate();
  const daily = await getDaily(sql, date);
  const maxHours = await getMaxShiftHours(sql);
  const missingOut = await sql`
    SELECT r.id AS record_id, r.work_date::text AS work_date, r.clock_in_at, w.worker_number, w.name
    FROM work_records r JOIN workers w ON w.id = r.worker_id
    WHERE r.clock_in_at IS NOT NULL AND r.clock_out_at IS NULL AND r.deleted_at IS NULL
      AND clock_timestamp() - r.clock_in_at > make_interval(hours => ${maxHours})
    ORDER BY r.clock_in_at LIMIT 20`;
  const [pending] = await sql<{ count: number; total: number }[]>`
    SELECT count(*)::int AS count, COALESCE(sum(dw.final_wage), 0)::float8 AS total
    FROM daily_wages dw JOIN work_records r ON r.id = dw.work_record_id
    WHERE dw.status = 'pending' AND r.deleted_at IS NULL`;
  const [workers] = await sql<{ active: number }[]>`SELECT count(*)::int AS active FROM workers WHERE is_active`;
  const recent = await sql`
    SELECT e.id, e.event_type, e.outcome, e.reject_code, e.source, e.occurred_at, e.worker_number, w.name, d.name AS device_name
    FROM attendance_events e LEFT JOIN workers w ON w.id = e.worker_id LEFT JOIN kiosk_devices d ON d.id = e.kiosk_device_id
    ORDER BY e.occurred_at DESC LIMIT 12`;
  return { date, summary: daily.summary, missingOut, pending, activeWorkers: workers.active, recent };
}
