import type { Sql } from "../db";
import { tx } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, notFound, pgCode } from "../errors";

/** 날짜별 일당 수정. 확정된 일당은 해제 전까지 바꿀 수 없다. */
export async function updateWage(sql: Sql, input: {
  recordId: string; actualWage?: number; extraPay?: number; note?: string; adminId: string;
}) {
  return tx(sql, async (t) => {
    const [w] = await t<{ actual_wage: number; extra_pay: number; note: string; status: string; final_wage: number }[]>`
      SELECT dw.actual_wage, dw.extra_pay, dw.note, dw.status, dw.final_wage
      FROM daily_wages dw JOIN work_records r ON r.id = dw.work_record_id
      WHERE dw.work_record_id = ${input.recordId} AND r.deleted_at IS NULL FOR UPDATE OF dw`;
    if (!w) throw notFound("근무 기록을 찾을 수 없습니다.");
    if (w.status === "confirmed") throw conflict("WAGE_CONFIRMED", "정산이 확정된 일당입니다. 확정을 해제한 뒤 수정해 주세요.");
    const next = { actual_wage: input.actualWage ?? w.actual_wage, extra_pay: input.extraPay ?? w.extra_pay, note: input.note ?? w.note };
    const [row] = await t<{ actual_wage: number; extra_pay: number; final_wage: number; note: string }[]>`
      UPDATE daily_wages SET actual_wage = ${next.actual_wage}, extra_pay = ${next.extra_pay}, note = ${next.note}
      WHERE work_record_id = ${input.recordId} RETURNING actual_wage, extra_pay, final_wage, note`;
    await audit(t, {
      administratorId: input.adminId, action: "wage.update", targetType: "daily_wage", targetId: input.recordId,
      before: { actual_wage: w.actual_wage, extra_pay: w.extra_pay, note: w.note }, after: next,
    });
    return row;
  }).catch((e) => {
    if (pgCode(e) === "23514") throw badRequest("금액은 0원 이상 1억 원 이하로 입력해 주세요.");
    if (pgCode(e) === "DW001") throw conflict("WAGE_CONFIRMED", "정산이 확정된 일당입니다.");
    throw e;
  });
}

export type SettlementRow = {
  worker_id: string; phone: string; name: string; work_days: number; total_wage: number;
  confirmed_wage: number; pending_wage: number; pending_count: number; confirmed_count: number; open_count: number;
};

/** 기간별 근무자 집계. 근무일은 출근한 날(work_date) 기준이다. */
export async function settlementReport(sql: Sql, from: string, to: string) {
  if (from > to) throw badRequest("시작일이 종료일보다 늦습니다.");
  const rows = await sql<SettlementRow[]>`
    SELECT w.id AS worker_id, w.phone, w.name,
      count(*)::int AS work_days,
      sum(dw.final_wage)::float8 AS total_wage,
      (COALESCE(sum(dw.final_wage) FILTER (WHERE dw.status = 'confirmed'), 0))::float8 AS confirmed_wage,
      (COALESCE(sum(dw.final_wage) FILTER (WHERE dw.status = 'pending'), 0))::float8 AS pending_wage,
      (count(*) FILTER (WHERE dw.status = 'pending'))::int AS pending_count,
      (count(*) FILTER (WHERE dw.status = 'confirmed'))::int AS confirmed_count,
      (count(*) FILTER (WHERE r.clock_in_at IS NOT NULL AND r.clock_out_at IS NULL))::int AS open_count
    FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id
    WHERE r.work_date BETWEEN ${from} AND ${to} AND r.deleted_at IS NULL
    GROUP BY w.id, w.phone, w.name, w.worker_number ORDER BY w.worker_number`;
  const sum = (k: keyof SettlementRow) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return {
    from, to, rows,
    summary: {
      workers: rows.length, workDays: sum("work_days"), totalWage: sum("total_wage"),
      confirmedWage: sum("confirmed_wage"), pendingWage: sum("pending_wage"), pendingCount: sum("pending_count"),
    },
  };
}

export async function settlementDetails(sql: Sql, from: string, to: string, workerId: string) {
  return sql`
    SELECT r.id AS record_id, r.work_date::text AS work_date, r.clock_in_at, r.clock_out_at, r.source,
      dw.base_wage, dw.actual_wage, dw.extra_pay, dw.final_wage, dw.note AS wage_note, dw.status, dw.confirmed_at
    FROM work_records r JOIN daily_wages dw ON dw.work_record_id = r.id
    WHERE r.worker_id = ${workerId} AND r.work_date BETWEEN ${from} AND ${to} AND r.deleted_at IS NULL
    ORDER BY r.work_date`;
}

/**
 * 기간 내 미확정 일당을 확정한다. 퇴근 누락이나 0원은 잘못 지급될 수 있어 건너뛰고 건수를 알려 준다.
 */
export async function confirmWages(sql: Sql, input: { from: string; to: string; workerIds?: string[]; recordIds?: string[]; adminId: string }) {
  return tx(sql, async (t) => {
    const candidates = await t<{ record_id: string; open: boolean; final_wage: number }[]>`
      SELECT r.id AS record_id, (r.clock_in_at IS NOT NULL AND r.clock_out_at IS NULL) AS open, dw.final_wage
      FROM work_records r JOIN daily_wages dw ON dw.work_record_id = r.id
      WHERE r.work_date BETWEEN ${input.from} AND ${input.to} AND r.deleted_at IS NULL AND dw.status = 'pending'
        AND (${input.workerIds == null} OR r.worker_id = ANY(${input.workerIds ?? []}::uuid[]))
        AND (${input.recordIds == null} OR r.id = ANY(${input.recordIds ?? []}::uuid[]))
      FOR UPDATE OF dw`;
    const ok = candidates.filter((c) => !c.open && c.final_wage > 0).map((c) => c.record_id);
    if (ok.length) {
      await t`UPDATE daily_wages SET status = 'confirmed', confirmed_at = clock_timestamp(), confirmed_by = ${input.adminId} WHERE work_record_id = ANY(${ok}::uuid[])`;
      for (const id of ok) {
        await audit(t, { administratorId: input.adminId, action: "wage.confirm", targetType: "daily_wage", targetId: id });
      }
    }
    return {
      confirmed: ok.length,
      skippedOpen: candidates.filter((c) => c.open).length,
      skippedZero: candidates.filter((c) => !c.open && c.final_wage <= 0).length,
    };
  });
}

export async function unconfirmWages(sql: Sql, input: { recordIds: string[]; reason: string; adminId: string }) {
  if (!input.reason.trim()) throw badRequest("확정 해제 사유를 입력해 주세요.");
  return tx(sql, async (t) => {
    const rows = await t<{ work_record_id: string }[]>`
      UPDATE daily_wages SET status = 'pending', confirmed_at = NULL, confirmed_by = NULL
      WHERE work_record_id = ANY(${input.recordIds}::uuid[]) AND status = 'confirmed' RETURNING work_record_id`;
    for (const r of rows) {
      await audit(t, { administratorId: input.adminId, action: "wage.unconfirm", targetType: "daily_wage", targetId: r.work_record_id, reason: input.reason.trim() });
    }
    return { unconfirmed: rows.length };
  });
}
