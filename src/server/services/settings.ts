import type { Sql } from "../db";
import { tx } from "../db";
import { audit } from "../audit";

export async function getMaxShiftHours(sql: Sql) {
  const [row] = await sql<{ value: number }[]>`SELECT value FROM app_settings WHERE key = 'max_shift_hours'`;
  return row ? Number(row.value) : 24;
}

/** 신규 근무자 등록 때 미리 채워 두는 기본 일당. 정한 적 없으면 0원. */
export async function getDefaultDailyWage(sql: Sql) {
  const [row] = await sql<{ value: number }[]>`SELECT value FROM app_settings WHERE key = 'default_daily_wage'`;
  return row ? Number(row.value) : 0;
}

/** 기본 일당을 바꾸고, applyToAll이면 등록된 모든 근무자의 기본 일당도 같은 값으로 맞춘다. 이미 기록된 일당은 그대로 둔다. */
export async function setDefaultDailyWage(sql: Sql, wage: number, adminId: string, opts: { applyToAll: boolean }) {
  return tx(sql, async (t) => {
    const before = await getDefaultDailyWage(t);
    await t`INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('default_daily_wage', ${t.json(wage)}, ${adminId}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    // 되돌릴 수 있도록 바뀐 근무자의 원래 일당을 감사 로그에 남긴다.
    const changed = opts.applyToAll
      ? await t<{ id: string; previous: number }[]>`
          UPDATE workers w SET base_daily_wage = ${wage} FROM workers old
          WHERE w.id = old.id AND w.base_daily_wage <> ${wage} RETURNING w.id, old.base_daily_wage AS previous`
      : [];
    await audit(t, {
      administratorId: adminId, action: "settings.default_daily_wage", targetType: "app_settings", targetId: "default_daily_wage",
      before: { default_daily_wage: before, workers: changed },
      after: { default_daily_wage: wage, applied_to_all: opts.applyToAll, workers_changed: changed.length },
    });
    return { defaultDailyWage: wage, workersChanged: changed.length };
  });
}
