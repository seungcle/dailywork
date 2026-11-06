import type { Sql } from "../db";
import { tx } from "../db";
import { AppError, badRequest, conflict, notFound, pgCode } from "../errors";
import { audit } from "../audit";
import { maskName } from "@/lib/format";
import { getMaxShiftHours } from "./settings";

export type Actor = { kind: "kiosk"; deviceId: string } | { kind: "admin"; adminId: string };

const MESSAGES = {
  WORKER_NOT_FOUND: "등록되지 않은 번호입니다.",
  WORKER_INACTIVE: "사용이 중지된 번호입니다. 관리자에게 문의해 주세요.",
  ALREADY_CLOCKED_IN: "이미 출근 처리되었습니다. 퇴근을 먼저 해 주세요.",
  OPEN_SHIFT_EXISTS: "이전 근무의 퇴근 기록이 없습니다. 관리자에게 문의해 주세요.",
  ALREADY_WORKED_TODAY: "오늘은 이미 출퇴근을 완료했습니다.",
  NOT_CLOCKED_IN: "출근 기록이 없어 퇴근할 수 없습니다.",
  SHIFT_TOO_LONG: "출근한 지 너무 오래되어 퇴근 처리할 수 없습니다. 관리자에게 문의해 주세요.",
  RECORD_CONFIRMED: "정산이 확정된 날짜입니다. 관리자에게 문의해 주세요.",
} as const;
export type AttendanceErrorCode = keyof typeof MESSAGES;

export class AttendanceError extends AppError {
  constructor(public attendanceCode: AttendanceErrorCode) {
    super(attendanceCode === "WORKER_NOT_FOUND" ? 404 : 409, attendanceCode, MESSAGES[attendanceCode]);
  }
}

type WorkerRow = { id: string; worker_number: number; name: string; is_active: boolean; base_daily_wage: number };
type OpenRow = { id: string; work_date: string; clock_in_at: Date; over_limit: boolean };

async function lockWorker(t: Sql, workerNumber: number) {
  // 같은 근무자의 동시 요청은 여기서 한 줄로 세운다.
  const [w] = await t<WorkerRow[]>`
    SELECT id, worker_number, name, is_active, base_daily_wage FROM workers WHERE worker_number = ${workerNumber} FOR UPDATE`;
  if (!w) throw new AttendanceError("WORKER_NOT_FOUND");
  if (!w.is_active) throw new AttendanceError("WORKER_INACTIVE");
  return w;
}

async function findOpen(t: Sql, workerId: string, now: Date, maxHours: number) {
  const [row] = await t<OpenRow[]>`
    SELECT id, work_date::text AS work_date, clock_in_at,
           ${now}::timestamptz - clock_in_at > make_interval(hours => ${maxHours}) AS over_limit
    FROM work_records
    WHERE worker_id = ${workerId} AND clock_in_at IS NOT NULL AND clock_out_at IS NULL AND deleted_at IS NULL`;
  return row;
}

const kst = (t: Sql, now: Date) => t<{ d: string }[]>`SELECT (${now}::timestamptz AT TIME ZONE 'Asia/Seoul')::date::text AS d`.then((r) => r[0].d);

async function logEvent(sql: Sql, e: {
  workerId?: string | null; workerNumber?: number | null; recordId?: string | null;
  type: "clock_in" | "clock_out" | "manual_create" | "correction" | "delete";
  outcome: "success" | "rejected"; rejectCode?: string | null; actor: Actor; at?: Date;
}) {
  await sql`
    INSERT INTO attendance_events (worker_id, worker_number, work_record_id, event_type, outcome, reject_code, source, kiosk_device_id, administrator_id, occurred_at)
    VALUES (${e.workerId ?? null}, ${e.workerNumber ?? null}, ${e.recordId ?? null}, ${e.type}, ${e.outcome}, ${e.rejectCode ?? null},
            ${e.actor.kind}, ${e.actor.kind === "kiosk" ? e.actor.deviceId : null}, ${e.actor.kind === "admin" ? e.actor.adminId : null},
            ${e.at ?? new Date()})`;
}

/** 거절된 시도도 이력에 남긴다. 트랜잭션이 롤백된 뒤에 별도로 기록해야 사라지지 않는다. */
async function withRejectionLog<T>(sql: Sql, type: "clock_in" | "clock_out", workerNumber: number, actor: Actor, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    let err = e;
    if (pgCode(e) === "DW001") err = new AttendanceError("RECORD_CONFIRMED");
    // 고유 인덱스가 막아 낸 경합: 잠금을 거쳤으므로 드물지만 안전망으로 처리한다.
    else if (pgCode(e) === "23505") err = new AttendanceError(type === "clock_in" ? "ALREADY_CLOCKED_IN" : "NOT_CLOCKED_IN");
    if (err instanceof AttendanceError) {
      const [w] = await sql<{ id: string }[]>`SELECT id FROM workers WHERE worker_number = ${workerNumber}`;
      await logEvent(sql, { workerId: w?.id, workerNumber, type, outcome: "rejected", rejectCode: err.attendanceCode, actor });
    }
    throw err;
  }
}

export type ClockResult = { recordId: string; workDate: string; at: Date; workerName: string; workerNumber: number };

/** 시각은 항상 서버가 정한다. now 인자는 테스트 전용이며 API에서 전달하지 않는다. */
export async function clockIn(sql: Sql, input: { workerNumber: number; actor: Actor; now?: Date }): Promise<ClockResult> {
  return withRejectionLog(sql, "clock_in", input.workerNumber, input.actor, () => tx(sql, async (t) => {
    const w = await lockWorker(t, input.workerNumber);
    const now = input.now ?? new Date();
    const workDate = await kst(t, now);
    const maxHours = await getMaxShiftHours(t);
    const open = await findOpen(t, w.id, now, maxHours);
    if (open) throw new AttendanceError(open.over_limit ? "OPEN_SHIFT_EXISTS" : "ALREADY_CLOCKED_IN");

    const [today] = await t<{ id: string; clock_in_at: Date | null; confirmed: boolean }[]>`
      SELECT r.id, r.clock_in_at, COALESCE(dw.status = 'confirmed', false) AS confirmed
      FROM work_records r LEFT JOIN daily_wages dw ON dw.work_record_id = r.id
      WHERE r.worker_id = ${w.id} AND r.work_date = ${workDate} AND r.deleted_at IS NULL`;
    if (today?.clock_in_at) throw new AttendanceError("ALREADY_WORKED_TODAY");
    if (today?.confirmed) throw new AttendanceError("RECORD_CONFIRMED");

    const deviceId = input.actor.kind === "kiosk" ? input.actor.deviceId : null;
    let recordId: string;
    if (today) {
      // 관리자가 미리 등록해 둔 출석에 시각을 채운다.
      await t`UPDATE work_records SET clock_in_at = ${now}, clock_in_device_id = ${deviceId} WHERE id = ${today.id}`;
      recordId = today.id;
    } else {
      const [r] = await t<{ id: string }[]>`
        INSERT INTO work_records (worker_id, work_date, clock_in_at, source, clock_in_device_id)
        VALUES (${w.id}, ${workDate}, ${now}, 'kiosk', ${deviceId}) RETURNING id`;
      recordId = r.id;
      await t`INSERT INTO daily_wages (work_record_id, base_wage, actual_wage)
              VALUES (${recordId}, ${w.base_daily_wage}, ${w.base_daily_wage})`;
    }
    await logEvent(t, { workerId: w.id, workerNumber: w.worker_number, recordId, type: "clock_in", outcome: "success", actor: input.actor, at: now });
    return { recordId, workDate, at: now, workerName: w.name, workerNumber: w.worker_number };
  }));
}

export async function clockOut(sql: Sql, input: { workerNumber: number; actor: Actor; now?: Date }): Promise<ClockResult> {
  return withRejectionLog(sql, "clock_out", input.workerNumber, input.actor, () => tx(sql, async (t) => {
    const w = await lockWorker(t, input.workerNumber);
    const now = input.now ?? new Date();
    const open = await findOpen(t, w.id, now, await getMaxShiftHours(t));
    if (!open) throw new AttendanceError("NOT_CLOCKED_IN");
    if (open.over_limit) throw new AttendanceError("SHIFT_TOO_LONG");
    const deviceId = input.actor.kind === "kiosk" ? input.actor.deviceId : null;
    await t`UPDATE work_records SET clock_out_at = ${now}, clock_out_device_id = ${deviceId} WHERE id = ${open.id}`;
    await logEvent(t, { workerId: w.id, workerNumber: w.worker_number, recordId: open.id, type: "clock_out", outcome: "success", actor: input.actor, at: now });
    return { recordId: open.id, workDate: open.work_date, at: now, workerName: w.name, workerNumber: w.worker_number };
  }));
}

export type KioskState = "can_clock_in" | "can_clock_out" | "completed_today" | "needs_admin";

/** 번호 확인 화면용. 이름은 가려서 내려 주고 민감정보는 포함하지 않는다. */
export async function lookupForKiosk(sql: Sql, workerNumber: number, now = new Date()) {
  const [w] = await sql<WorkerRow[]>`SELECT id, worker_number, name, is_active, base_daily_wage FROM workers WHERE worker_number = ${workerNumber}`;
  if (!w) throw new AttendanceError("WORKER_NOT_FOUND");
  if (!w.is_active) throw new AttendanceError("WORKER_INACTIVE");
  const open = await findOpen(sql, w.id, now, await getMaxShiftHours(sql));
  let state: KioskState = "can_clock_in";
  if (open) state = open.over_limit ? "needs_admin" : "can_clock_out";
  else {
    const workDate = await kst(sql, now);
    const [today] = await sql`SELECT 1 FROM work_records WHERE worker_id = ${w.id} AND work_date = ${workDate} AND clock_in_at IS NOT NULL AND deleted_at IS NULL`;
    if (today) state = "completed_today";
  }
  return { workerNumber: w.worker_number, maskedName: maskName(w.name), state };
}

// ── 일일 출석부 (관리자) ───────────────────────────────
export type DailyRow = {
  record_id: string; worker_id: string; worker_number: number; name: string; phone: string | null;
  work_date: string; clock_in_at: Date | null; clock_out_at: Date | null; source: string; note: string;
  base_wage: number; actual_wage: number; extra_pay: number; final_wage: number; wage_note: string; wage_status: "pending" | "confirmed";
  attendance_status: "scheduled" | "working" | "done" | "missing_out";
};

export async function getDaily(sql: Sql, date: string) {
  const maxHours = await getMaxShiftHours(sql);
  const rows = await sql<DailyRow[]>`
    SELECT r.id AS record_id, w.id AS worker_id, w.worker_number, w.name, w.phone, r.work_date::text AS work_date,
      r.clock_in_at, r.clock_out_at, r.source, r.note,
      dw.base_wage, dw.actual_wage, dw.extra_pay, dw.final_wage, dw.note AS wage_note, dw.status AS wage_status,
      CASE WHEN r.clock_in_at IS NULL THEN 'scheduled'
           WHEN r.clock_out_at IS NOT NULL THEN 'done'
           WHEN clock_timestamp() - r.clock_in_at > make_interval(hours => ${maxHours}) THEN 'missing_out'
           ELSE 'working' END AS attendance_status
    FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id
    WHERE r.work_date = ${date} AND r.deleted_at IS NULL
    ORDER BY r.clock_in_at NULLS LAST, w.worker_number`;
  return {
    date, rows,
    summary: {
      total: rows.length,
      working: rows.filter((r) => r.attendance_status === "working").length,
      done: rows.filter((r) => r.attendance_status === "done").length,
      scheduled: rows.filter((r) => r.attendance_status === "scheduled").length,
      missingOut: rows.filter((r) => r.attendance_status === "missing_out").length,
      totalWage: rows.reduce((s, r) => s + r.final_wage, 0),
    },
  };
}

function assertTimes(workDate: string, clockInAt: Date | null, clockOutAt: Date | null) {
  if (clockOutAt && !clockInAt) throw badRequest("출근 시각 없이 퇴근 시각만 입력할 수 없습니다.");
  if (clockInAt && clockOutAt && clockOutAt <= clockInAt) throw badRequest("퇴근 시각은 출근 시각보다 늦어야 합니다.");
  if (clockInAt && clockInAt.getTime() > Date.now() + 60_000) throw badRequest("미래 시각으로 출근을 입력할 수 없습니다.");
  if (clockOutAt && clockOutAt.getTime() > Date.now() + 60_000) throw badRequest("미래 시각으로 퇴근을 입력할 수 없습니다.");
  if (clockInAt) {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(clockInAt);
    if (d !== workDate) throw badRequest("출근 시각은 근무일 날짜여야 합니다. 자정을 넘긴 시각은 퇴근 시각에만 입력할 수 있습니다.");
  }
}

function mapRecordError(e: unknown): never {
  if (pgCode(e) === "DW001") throw conflict("RECORD_CONFIRMED", "정산이 확정된 기록입니다. 확정을 해제한 뒤 수정해 주세요.");
  if (pgCode(e) === "23505") throw conflict("RECORD_CONFLICT", "같은 날짜의 기록이 있거나 퇴근하지 않은 다른 근무가 있습니다.");
  throw e;
}

/** 수동 출석 등록(여러 명 가능). 이미 기록이 있는 근무자는 건너뛴다. */
export async function addManualRecords(sql: Sql, input: {
  workerIds: string[]; workDate: string; clockInAt?: Date | null; clockOutAt?: Date | null; adminId: string;
}) {
  assertTimes(input.workDate, input.clockInAt ?? null, input.clockOutAt ?? null);
  const actor: Actor = { kind: "admin", adminId: input.adminId };
  return tx(sql, async (t) => {
    const created: string[] = [];
    const skipped: { workerId: string; reason: string }[] = [];
    for (const workerId of [...new Set(input.workerIds)]) {
      const [w] = await t<WorkerRow[]>`SELECT id, worker_number, name, is_active, base_daily_wage FROM workers WHERE id = ${workerId} FOR UPDATE`;
      if (!w) { skipped.push({ workerId, reason: "없는 근무자" }); continue; }
      if (!w.is_active) { skipped.push({ workerId, reason: `${w.name}: 비활성 근무자` }); continue; }
      const [exists] = await t`SELECT 1 FROM work_records WHERE worker_id = ${w.id} AND work_date = ${input.workDate} AND deleted_at IS NULL`;
      if (exists) { skipped.push({ workerId, reason: `${w.name}: 이미 출석부에 있음` }); continue; }
      if (input.clockInAt && !input.clockOutAt) {
        const [open] = await t`SELECT 1 FROM work_records WHERE worker_id = ${w.id} AND clock_in_at IS NOT NULL AND clock_out_at IS NULL AND deleted_at IS NULL`;
        if (open) { skipped.push({ workerId, reason: `${w.name}: 퇴근하지 않은 다른 근무가 있음` }); continue; }
      }
      const [r] = await t<{ id: string }[]>`
        INSERT INTO work_records (worker_id, work_date, clock_in_at, clock_out_at, source, created_by)
        VALUES (${w.id}, ${input.workDate}, ${input.clockInAt ?? null}, ${input.clockOutAt ?? null}, 'manual', ${input.adminId}) RETURNING id`;
      await t`INSERT INTO daily_wages (work_record_id, base_wage, actual_wage) VALUES (${r.id}, ${w.base_daily_wage}, ${w.base_daily_wage})`;
      await logEvent(t, { workerId: w.id, workerNumber: w.worker_number, recordId: r.id, type: "manual_create", outcome: "success", actor });
      await audit(t, {
        administratorId: input.adminId, action: "attendance.manual_create", targetType: "work_record", targetId: r.id,
        after: { work_date: input.workDate, worker_number: w.worker_number, clock_in_at: input.clockInAt ?? null, clock_out_at: input.clockOutAt ?? null },
      });
      created.push(r.id);
    }
    return { created: created.length, skipped };
  }).catch(mapRecordError);
}

/** 전날 출석 인원을 해당 날짜 출석부로 불러온다. 시각은 비워 둔다. */
export async function copyPreviousDay(sql: Sql, workDate: string, adminId: string) {
  const rows = await sql<{ worker_id: string }[]>`
    SELECT r.worker_id FROM work_records r JOIN workers w ON w.id = r.worker_id
    WHERE r.work_date = ${workDate}::date - 1 AND r.deleted_at IS NULL AND w.is_active`;
  if (rows.length === 0) return { created: 0, skipped: [], previousCount: 0 };
  const result = await addManualRecords(sql, { workerIds: rows.map((r) => r.worker_id), workDate, adminId });
  return { ...result, previousCount: rows.length };
}

/** 출퇴근 시각 보정. 사유는 필수이며 변경 전후를 이력에 남긴다. */
export async function correctRecord(sql: Sql, input: {
  recordId: string; clockInAt: Date | null; clockOutAt: Date | null; reason: string; adminId: string;
}) {
  if (!input.reason.trim()) throw badRequest("수정 사유를 입력해 주세요.");
  return tx(sql, async (t) => {
    const [r] = await t<{ id: string; worker_id: string; worker_number: number; work_date: string; clock_in_at: Date | null; clock_out_at: Date | null; status: string }[]>`
      SELECT r.id, r.worker_id, w.worker_number, r.work_date::text AS work_date, r.clock_in_at, r.clock_out_at, dw.status
      FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id
      WHERE r.id = ${input.recordId} AND r.deleted_at IS NULL FOR UPDATE OF r`;
    if (!r) throw notFound("근무 기록을 찾을 수 없습니다.");
    if (r.status === "confirmed") throw conflict("RECORD_CONFIRMED", "정산이 확정된 기록입니다. 확정을 해제한 뒤 수정해 주세요.");
    assertTimes(r.work_date, input.clockInAt, input.clockOutAt);
    await t`UPDATE work_records SET clock_in_at = ${input.clockInAt}, clock_out_at = ${input.clockOutAt} WHERE id = ${r.id}`;
    await logEvent(t, { workerId: r.worker_id, workerNumber: r.worker_number, recordId: r.id, type: "correction", outcome: "success", actor: { kind: "admin", adminId: input.adminId } });
    await audit(t, {
      administratorId: input.adminId, action: "attendance.correct", targetType: "work_record", targetId: r.id, reason: input.reason.trim(),
      before: { clock_in_at: r.clock_in_at, clock_out_at: r.clock_out_at }, after: { clock_in_at: input.clockInAt, clock_out_at: input.clockOutAt },
    });
  }).catch(mapRecordError);
}

export async function deleteRecord(sql: Sql, input: { recordId: string; reason: string; adminId: string }) {
  if (!input.reason.trim()) throw badRequest("삭제 사유를 입력해 주세요.");
  return tx(sql, async (t) => {
    const [r] = await t<{ id: string; worker_id: string; worker_number: number; work_date: string; clock_in_at: Date | null; clock_out_at: Date | null; status: string }[]>`
      SELECT r.id, r.worker_id, w.worker_number, r.work_date::text AS work_date, r.clock_in_at, r.clock_out_at, dw.status
      FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id
      WHERE r.id = ${input.recordId} AND r.deleted_at IS NULL FOR UPDATE OF r`;
    if (!r) throw notFound("근무 기록을 찾을 수 없습니다.");
    if (r.status === "confirmed") throw conflict("RECORD_CONFIRMED", "정산이 확정된 기록은 삭제할 수 없습니다. 확정을 해제해 주세요.");
    await t`UPDATE work_records SET deleted_at = clock_timestamp(), deleted_by = ${input.adminId}, delete_reason = ${input.reason.trim()} WHERE id = ${r.id}`;
    await logEvent(t, { workerId: r.worker_id, workerNumber: r.worker_number, recordId: r.id, type: "delete", outcome: "success", actor: { kind: "admin", adminId: input.adminId } });
    await audit(t, {
      administratorId: input.adminId, action: "attendance.delete", targetType: "work_record", targetId: r.id, reason: input.reason.trim(),
      before: { work_date: r.work_date, clock_in_at: r.clock_in_at, clock_out_at: r.clock_out_at },
    });
  }).catch(mapRecordError);
}

export async function recordHistory(sql: Sql, recordId: string) {
  return sql`
    SELECT l.id, l.action, l.before, l.after, l.reason, l.created_at, a.display_name AS admin_name
    FROM audit_logs l LEFT JOIN administrators a ON a.id = l.administrator_id
    WHERE l.target_type IN ('work_record', 'daily_wage') AND l.target_id = ${recordId}
    ORDER BY l.created_at DESC`;
}
