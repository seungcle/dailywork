import { beforeEach, describe, expect, it } from "vitest";
import { GET as daily } from "@/app/api/admin/attendance/route";
import { PUT as putDayWage } from "@/app/api/admin/attendance/day-wage/route";
import { addManualRecords, clockIn } from "@/server/services/attendance";
import { adminCookie, kst, noParams, request, resetDb, seedAdmin, seedWorker, sql } from "./helpers";

let admin: { id: string; token: string };
beforeEach(async () => { await resetDb(); admin = await seedAdmin(); });

const DAY = "2026-03-02";
const setWage = (wage: unknown, workDate = DAY) =>
  putDayWage(request("/api/admin/attendance/day-wage", { method: "PUT", body: { workDate, wage }, cookies: adminCookie(admin.token) }), noParams);
const board = async (date = DAY) => (await daily(request(`/api/admin/attendance?date=${date}`, { cookies: adminCookie(admin.token) }), noParams)).json();
const actor = () => ({ kind: "admin" as const, adminId: admin.id });

describe("날짜별 일당", () => {
  it("이미 출근한 사람의 당일 일당을 모두 바꾸고, 다른 날짜와 근무자 기본 일당은 그대로 둔다", async () => {
    const a = await seedWorker(admin.id, { baseDailyWage: 93000 });
    const b = await seedWorker(admin.id, { baseDailyWage: 108000 });
    await clockIn(sql, { workerNumber: a.worker_number, actor: actor(), now: kst(`${DAY}T08:00:00`) });
    await clockIn(sql, { workerNumber: b.worker_number, actor: actor(), now: kst(`${DAY}T08:05:00`) });
    await clockIn(sql, { workerNumber: a.worker_number, actor: actor(), now: kst("2026-03-03T08:00:00") }).catch(() => undefined);

    const res = await setWage(100000);
    expect(await res.json()).toMatchObject({ changed: 2, skippedConfirmed: 0 });

    const d = await board();
    expect(d.dayWage).toBe(100000);
    expect(d.rows.map((r: { actual_wage: number }) => r.actual_wage)).toEqual([100000, 100000]);
    expect((await board("2026-03-03")).rows.map((r: { actual_wage: number }) => r.actual_wage)).toEqual([93000]);
    expect((await sql`SELECT base_daily_wage FROM workers ORDER BY worker_number`).map((w) => w.base_daily_wage)).toEqual([93000, 108000]);
  });

  it("정한 뒤에 출근하거나 수동으로 추가한 사람도 그날 일당을 받는다", async () => {
    const a = await seedWorker(admin.id, { baseDailyWage: 93000 });
    const b = await seedWorker(admin.id, { baseDailyWage: 93000 });
    await setWage(96700);
    await clockIn(sql, { workerNumber: a.worker_number, actor: actor(), now: kst(`${DAY}T08:00:00`) });
    await addManualRecords(sql, { workerIds: [b.id], workDate: DAY, adminId: admin.id });
    expect((await board()).rows.map((r: { actual_wage: number }) => r.actual_wage)).toEqual([96700, 96700]);
  });

  it("정하지 않은 날은 근무자 기본 일당을 쓰고 dayWage는 비어 있다", async () => {
    const a = await seedWorker(admin.id, { baseDailyWage: 93000 });
    await clockIn(sql, { workerNumber: a.worker_number, actor: actor(), now: kst(`${DAY}T08:00:00`) });
    const d = await board();
    expect(d.dayWage).toBeNull();
    expect(d.rows[0].actual_wage).toBe(93000);
  });

  it("정산을 확정한 기록은 바꾸지 않고, 바뀐 기록의 원래 금액을 이력에 남긴다", async () => {
    const a = await seedWorker(admin.id, { baseDailyWage: 93000 });
    const b = await seedWorker(admin.id, { baseDailyWage: 95000 });
    const ra = await clockIn(sql, { workerNumber: a.worker_number, actor: actor(), now: kst(`${DAY}T08:00:00`) });
    await clockIn(sql, { workerNumber: b.worker_number, actor: actor(), now: kst(`${DAY}T08:05:00`) });
    // 정산은 퇴근까지 끝난 기록만 확정한다.
    await sql`UPDATE work_records SET clock_out_at = ${kst(`${DAY}T18:00:00`)} WHERE id = ${ra.recordId}`;
    await sql`UPDATE daily_wages SET status = 'confirmed', confirmed_at = now() WHERE work_record_id = ${ra.recordId}`;

    expect(await (await setWage(100000)).json()).toMatchObject({ changed: 1, skippedConfirmed: 1 });
    expect((await board()).rows.map((r: { actual_wage: number }) => r.actual_wage).sort()).toEqual([100000, 93000]);
    const [log] = await sql<{ before: { records: { previous: number }[] } }[]>`SELECT before FROM audit_logs WHERE action = 'wage.day_rate'`;
    expect(log.before.records.map((r) => r.previous)).toEqual([95000]);
  });

  it("음수·문자 금액과 로그인하지 않은 요청은 거절한다", async () => {
    expect((await setWage(-1)).status).toBe(400);
    expect((await setWage("abc")).status).toBe(400);
    const res = await putDayWage(request("/api/admin/attendance/day-wage", { method: "PUT", body: { workDate: DAY, wage: 1 } }), noParams);
    expect(res.status).toBe(401);
    expect((await board()).dayWage).toBeNull();
  });
});
