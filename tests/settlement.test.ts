import { beforeEach, describe, expect, it } from "vitest";
import { addManualRecords, clockIn, clockOut, getDaily } from "@/server/services/attendance";
import { confirmWages, settlementReport, unconfirmWages, updateWage } from "@/server/services/settlement";
import { kst, resetDb, seedAdmin, seedWorker, sql } from "./helpers";

let adminId: string;
beforeEach(async () => { await resetDb(); adminId = (await seedAdmin()).id; });

async function worked(workerId: string, date: string, wage?: { actualWage?: number; extraPay?: number }) {
  const r = await addManualRecords(sql, { workerIds: [workerId], workDate: date, clockInAt: kst(`${date}T08:00:00`), clockOutAt: kst(`${date}T17:00:00`), adminId });
  expect(r.created).toBe(1);
  const [row] = await sql<{ id: string }[]>`SELECT id FROM work_records WHERE worker_id = ${workerId} AND work_date = ${date} AND deleted_at IS NULL`;
  if (wage) await updateWage(sql, { recordId: row.id, ...wage, adminId });
  return row.id;
}

describe("일당 합산", () => {
  it("기본 일당을 스냅샷으로 복사하고, 나중에 기본 일당이 바뀌어도 과거 기록은 그대로다", async () => {
    const w = await seedWorker(adminId, { baseDailyWage: 150000 });
    await worked(w.id, "2026-03-02");
    await sql`UPDATE workers SET base_daily_wage = 200000 WHERE id = ${w.id}`;
    const { rows } = await getDaily(sql, "2026-03-02");
    expect(rows[0].base_wage).toBe(150000);
    expect(rows[0].final_wage).toBe(150000);
  });

  it("최종 일당은 당일 일당 + 추가 지급액이고 기간 합계가 정확하다", async () => {
    const a = await seedWorker(adminId, { baseDailyWage: 150000 });
    const b = await seedWorker(adminId, { baseDailyWage: 100000 });
    await worked(a.id, "2026-03-02");
    await worked(a.id, "2026-03-03", { actualWage: 180000, extraPay: 20000 });
    await worked(b.id, "2026-03-03", { extraPay: 5000 });
    await worked(a.id, "2026-03-10"); // 기간 밖

    const r = await settlementReport(sql, "2026-03-01", "2026-03-07");
    const ra = r.rows.find((x) => x.worker_id === a.id)!;
    const rb = r.rows.find((x) => x.worker_id === b.id)!;
    expect(ra.work_days).toBe(2);
    expect(ra.total_wage).toBe(350000);
    expect(rb.work_days).toBe(1);
    expect(rb.total_wage).toBe(105000);
    expect(r.summary.totalWage).toBe(455000);
    expect(r.summary.workDays).toBe(3);
  });

  it("삭제한 기록은 합계에서 빠진다", async () => {
    const w = await seedWorker(adminId, { baseDailyWage: 100000 });
    const id = await worked(w.id, "2026-03-02");
    await worked(w.id, "2026-03-03");
    await sql`UPDATE work_records SET deleted_at = now(), delete_reason = 't' WHERE id = ${id}`;
    expect((await settlementReport(sql, "2026-03-01", "2026-03-31")).summary.totalWage).toBe(100000);
  });

  it("자정을 넘긴 근무의 일당은 출근한 날짜에 집계한다", async () => {
    const w = await seedWorker(adminId, { baseDailyWage: 100000 });
    const actor = { kind: "admin" as const, adminId };
    await clockIn(sql, { workerNumber: w.worker_number, actor, now: kst("2026-03-31T22:00:00") });
    await clockOut(sql, { workerNumber: w.worker_number, actor, now: kst("2026-04-01T06:00:00") });
    expect((await settlementReport(sql, "2026-03-01", "2026-03-31")).summary.totalWage).toBe(100000);
    expect((await settlementReport(sql, "2026-04-01", "2026-04-30")).summary.totalWage).toBe(0);
  });

  it("음수·범위를 넘는 금액은 DB가 거절한다", async () => {
    const w = await seedWorker(adminId);
    const id = await worked(w.id, "2026-03-02");
    await expect(updateWage(sql, { recordId: id, actualWage: -1, adminId })).rejects.toThrow("금액");
  });
});

describe("정산 확정", () => {
  it("출근만으로 확정되지 않고, 확정은 관리자 동작으로만 이뤄진다", async () => {
    const w = await seedWorker(adminId);
    await worked(w.id, "2026-03-02");
    const r = await settlementReport(sql, "2026-03-02", "2026-03-02");
    expect(r.summary.confirmedWage).toBe(0);
    expect(r.summary.pendingCount).toBe(1);
  });

  it("퇴근 누락과 0원은 건너뛰고 건수를 알려 준다", async () => {
    const a = await seedWorker(adminId);
    const open = await seedWorker(adminId);
    const zero = await seedWorker(adminId, { baseDailyWage: 0 });
    await worked(a.id, "2026-03-02");
    await worked(zero.id, "2026-03-02");
    await addManualRecords(sql, { workerIds: [open.id], workDate: "2026-03-02", clockInAt: kst("2026-03-02T08:00:00"), adminId });
    expect(await confirmWages(sql, { from: "2026-03-02", to: "2026-03-02", adminId })).toEqual({ confirmed: 1, skippedOpen: 1, skippedZero: 1 });
  });

  it("확정된 일당은 수정할 수 없고, 해제하면 사유가 남으며 다시 수정할 수 있다", async () => {
    const w = await seedWorker(adminId);
    const id = await worked(w.id, "2026-03-02");
    await confirmWages(sql, { from: "2026-03-02", to: "2026-03-02", adminId });
    await expect(updateWage(sql, { recordId: id, actualWage: 1, adminId })).rejects.toMatchObject({ code: "WAGE_CONFIRMED" });
    await expect(sql`UPDATE daily_wages SET actual_wage = 1 WHERE work_record_id = ${id}`).rejects.toMatchObject({ code: "DW001" });
    await expect(unconfirmWages(sql, { recordIds: [id], reason: " ", adminId })).rejects.toThrow("사유");
    await unconfirmWages(sql, { recordIds: [id], reason: "금액 조정", adminId });
    await updateWage(sql, { recordId: id, actualWage: 1000, adminId });
    const [log] = await sql<{ reason: string }[]>`SELECT reason FROM audit_logs WHERE action = 'wage.unconfirm'`;
    expect(log.reason).toBe("금액 조정");
  });
});
