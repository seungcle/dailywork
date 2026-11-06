import { beforeEach, describe, expect, it } from "vitest";
import { addManualRecords, AttendanceError, clockIn, clockOut, copyPreviousDay, correctRecord, deleteRecord, getDaily, lookupForKiosk, type Actor } from "@/server/services/attendance";
import { setWorkerActive } from "@/server/services/workers";
import { confirmWages } from "@/server/services/settlement";
import { kst, resetDb, seedAdmin, seedKiosk, seedWorker, sql } from "./helpers";

let adminId: string, actor: Actor, num: number, workerId: string;

const PHONE = "01055550000";
beforeEach(async () => {
  await resetDb();
  adminId = (await seedAdmin()).id;
  actor = { kind: "kiosk", deviceId: (await seedKiosk(adminId)).id };
  const w = await seedWorker(adminId, { phone: PHONE });
  num = w.worker_number;
  workerId = w.id;
});

const code = (e: unknown) => (e as AttendanceError).attendanceCode;
const rejected = () => sql`SELECT reject_code FROM attendance_events WHERE outcome = 'rejected' ORDER BY id`;

describe("중복 출근", () => {
  it("근무 중 다시 출근하면 거절하고 기록은 하나만 남는다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await expect(clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:05:00") })).rejects.toSatisfy((e) => code(e) === "ALREADY_CLOCKED_IN");
    const rows = await sql`SELECT id FROM work_records`;
    expect(rows).toHaveLength(1);
  });

  it("퇴근 후 같은 날 다시 출근하면 거절한다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:00:00") });
    await expect(clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T18:00:00") })).rejects.toSatisfy((e) => code(e) === "ALREADY_WORKED_TODAY");
  });

  it("거절된 시도도 이력에 남는다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:05:00") }).catch(() => {});
    expect((await rejected()).map((r) => r.reject_code)).toEqual(["ALREADY_CLOCKED_IN"]);
  });
});

describe("누락 퇴근", () => {
  it("출근 기록 없이 퇴근하면 거절한다", async () => {
    await expect(clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:00:00") })).rejects.toSatisfy((e) => code(e) === "NOT_CLOCKED_IN");
    expect(await sql`SELECT id FROM work_records`).toHaveLength(0);
  });

  it("퇴근을 두 번 하면 두 번째는 거절하고 첫 퇴근 시각을 유지한다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    const first = kst("2026-03-02T17:00:00");
    await clockOut(sql, { workerNumber: num, actor, now: first });
    await expect(clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:01:00") })).rejects.toSatisfy((e) => code(e) === "NOT_CLOCKED_IN");
    const [r] = await sql<{ clock_out_at: Date }[]>`SELECT clock_out_at FROM work_records`;
    expect(r.clock_out_at.getTime()).toBe(first.getTime());
  });

  it("전날 퇴근을 빠뜨리면 다음 날 재출근을 막고 관리자 보정 뒤 출근할 수 있다", async () => {
    const { recordId } = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    const nextDay = kst("2026-03-03T09:00:00");
    await expect(clockIn(sql, { workerNumber: num, actor, now: nextDay })).rejects.toSatisfy((e) => code(e) === "OPEN_SHIFT_EXISTS");
    await expect(clockOut(sql, { workerNumber: num, actor, now: nextDay })).rejects.toSatisfy((e) => code(e) === "SHIFT_TOO_LONG");
    await correctRecord(sql, { recordId, clockInAt: kst("2026-03-02T08:00:00"), clockOutAt: kst("2026-03-02T17:00:00"), reason: "퇴근 누락", adminId });
    const r = await clockIn(sql, { workerNumber: num, actor, now: nextDay });
    expect(r.workDate).toBe("2026-03-03");
  });
});

describe("자정을 넘기는 근무", () => {
  it("다음 날 퇴근해도 출근한 날의 근무로 남고, 그날 저녁 새 근무를 시작할 수 있다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T22:00:00") });
    const out = await clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-03T06:00:00") });
    expect(out.workDate).toBe("2026-03-02");
    const again = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-03T22:00:00") });
    expect(again.workDate).toBe("2026-03-03");
    expect((await getDaily(sql, "2026-03-02")).rows).toHaveLength(1);
    expect((await getDaily(sql, "2026-03-03")).rows).toHaveLength(1);
  });

  it("한국 날짜 기준으로 근무일을 정한다(UTC로는 전날인 새벽)", async () => {
    const r = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T01:00:00") });
    expect(r.workDate).toBe("2026-03-02");
  });
});

describe("동시 요청", () => {
  it("같은 근무자의 출근 요청 20건이 동시에 와도 1건만 성공한다", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    results.filter((r) => r.status === "rejected").forEach((r) => expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AttendanceError));
    expect(await sql`SELECT id FROM work_records`).toHaveLength(1);
    expect(await sql`SELECT id FROM daily_wages`).toHaveLength(1);
    const [e] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM attendance_events WHERE outcome = 'success'`;
    expect(e.n).toBe(1);
  });

  it("같은 근무자의 퇴근 요청 20건이 동시에 와도 1건만 성공한다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:00:00") })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("서로 다른 근무자의 동시 출근은 모두 성공한다", async () => {
    const workers = await Promise.all(Array.from({ length: 15 }, () => seedWorker(adminId)));
    const results = await Promise.allSettled(workers.map((w) => clockIn(sql, { workerNumber: w.worker_number, actor, now: kst("2026-03-02T08:00:00") })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(15);
  });

  it("DB 제약만으로도 같은 날 중복 기록을 막는다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await expect(sql`INSERT INTO work_records (worker_id, work_date, source) VALUES (${workerId}, '2026-03-02', 'manual')`).rejects.toMatchObject({ code: "23505" });
  });
});

describe("근무자 상태", () => {
  it("없는 번호는 거절한다", async () => {
    await expect(clockIn(sql, { workerNumber: 999999, actor })).rejects.toSatisfy((e) => code(e) === "WORKER_NOT_FOUND");
    await expect(lookupForKiosk(sql, "01000000000")).rejects.toSatisfy((e) => code(e) === "WORKER_NOT_FOUND");
  });

  it("비활성 근무자는 출근과 퇴근 모두 막는다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await setWorkerActive(sql, workerId, false, adminId);
    await expect(clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:00:00") })).rejects.toSatisfy((e) => code(e) === "WORKER_INACTIVE");
    await expect(lookupForKiosk(sql, PHONE)).rejects.toSatisfy((e) => code(e) === "WORKER_INACTIVE");
  });

  it("키오스크 조회는 이름을 가리고 상태를 알려 준다", async () => {
    await sql`UPDATE workers SET name = '홍길동' WHERE id = ${workerId}`;
    const now = kst("2026-03-02T08:00:00");
    const a = await lookupForKiosk(sql, PHONE, now);
    expect(a).toEqual({ maskedName: "홍*동", state: "can_clock_in" });
    await clockIn(sql, { workerNumber: num, actor, now });
    expect((await lookupForKiosk(sql, PHONE, kst("2026-03-02T09:00:00"))).state).toBe("can_clock_out");
    await clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:00:00") });
    expect((await lookupForKiosk(sql, PHONE, kst("2026-03-02T18:00:00"))).state).toBe("completed_today");
  });
});

describe("출석 수정", () => {
  it("보정은 사유와 변경 전후를 이력에 남긴다", async () => {
    const { recordId } = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await correctRecord(sql, { recordId, clockInAt: kst("2026-03-02T07:30:00"), clockOutAt: kst("2026-03-02T17:00:00"), reason: "실제 출근 시각 반영", adminId });
    const [log] = await sql<{ reason: string; before: { clock_in_at: string }; after: { clock_in_at: string } }[]>`
      SELECT reason, before, after FROM audit_logs WHERE action = 'attendance.correct' AND target_id = ${recordId}`;
    expect(log.reason).toBe("실제 출근 시각 반영");
    expect(new Date(log.before.clock_in_at).getTime()).toBe(kst("2026-03-02T08:00:00").getTime());
    expect(new Date(log.after.clock_in_at).getTime()).toBe(kst("2026-03-02T07:30:00").getTime());
    const [ev] = await sql`SELECT event_type FROM attendance_events WHERE work_record_id = ${recordId} AND event_type = 'correction'`;
    expect(ev).toBeTruthy();
  });

  it("사유 없는 보정, 역전된 시각, 퇴근만 있는 입력, 근무일과 다른 출근 시각을 거절한다", async () => {
    const { recordId } = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    const base = { recordId, adminId };
    await expect(correctRecord(sql, { ...base, clockInAt: kst("2026-03-02T08:00:00"), clockOutAt: null, reason: " " })).rejects.toThrow("사유");
    await expect(correctRecord(sql, { ...base, clockInAt: kst("2026-03-02T18:00:00"), clockOutAt: kst("2026-03-02T17:00:00"), reason: "x" })).rejects.toThrow("늦어야");
    await expect(correctRecord(sql, { ...base, clockInAt: null, clockOutAt: kst("2026-03-02T17:00:00"), reason: "x" })).rejects.toThrow("퇴근 시각만");
    await expect(correctRecord(sql, { ...base, clockInAt: kst("2026-03-03T08:00:00"), clockOutAt: null, reason: "x" })).rejects.toThrow("근무일");
  });

  it("정산 확정된 기록은 보정·삭제할 수 없고, DB에서 직접 바꾸려 해도 막힌다", async () => {
    const { recordId } = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await clockOut(sql, { workerNumber: num, actor, now: kst("2026-03-02T17:00:00") });
    await confirmWages(sql, { from: "2026-03-02", to: "2026-03-02", adminId });
    await expect(correctRecord(sql, { recordId, clockInAt: kst("2026-03-02T07:00:00"), clockOutAt: kst("2026-03-02T17:00:00"), reason: "x", adminId })).rejects.toMatchObject({ code: "RECORD_CONFIRMED" });
    await expect(deleteRecord(sql, { recordId, reason: "x", adminId })).rejects.toMatchObject({ code: "RECORD_CONFIRMED" });
    await expect(sql`UPDATE work_records SET clock_in_at = now() - interval '1 day' WHERE id = ${recordId}`).rejects.toMatchObject({ code: "DW001" });
  });

  it("이력 테이블은 수정·삭제가 불가능하다", async () => {
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await expect(sql`DELETE FROM attendance_events`).rejects.toMatchObject({ code: "DW003" });
    await expect(sql`UPDATE audit_logs SET reason = '조작'`).rejects.toMatchObject({ code: "DW003" });
  });

  it("삭제한 기록은 출석부에서 빠지고 같은 날 다시 등록할 수 있다", async () => {
    const { recordId } = await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    await deleteRecord(sql, { recordId, reason: "번호 오입력", adminId });
    expect((await getDaily(sql, "2026-03-02")).rows).toHaveLength(0);
    expect((await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T09:00:00") })).recordId).not.toBe(recordId);
  });
});

describe("수동 출석과 키오스크", () => {
  it("미리 등록한 출석에 키오스크 출근 시각이 합쳐져 한 줄로 보인다", async () => {
    await addManualRecords(sql, { workerIds: [workerId], workDate: "2026-03-02", adminId });
    await clockIn(sql, { workerNumber: num, actor, now: kst("2026-03-02T08:00:00") });
    const { rows } = await getDaily(sql, "2026-03-02");
    expect(rows).toHaveLength(1);
    expect(rows[0].clock_in_at).not.toBeNull();
  });

  it("일괄 등록은 이미 있거나 비활성인 근무자를 건너뛰고 이유를 알려 준다", async () => {
    const off = await seedWorker(adminId);
    await setWorkerActive(sql, off.id, false, adminId);
    await addManualRecords(sql, { workerIds: [workerId], workDate: "2026-03-02", adminId });
    const fresh = await seedWorker(adminId);
    const r = await addManualRecords(sql, { workerIds: [workerId, off.id, fresh.id], workDate: "2026-03-02", adminId });
    expect(r.created).toBe(1);
    expect(r.skipped).toHaveLength(2);
  });

  it("전날 인원 불러오기는 활성 근무자만 시각 없이 복사하고 다시 실행해도 중복되지 않는다", async () => {
    const off = await seedWorker(adminId);
    await addManualRecords(sql, { workerIds: [workerId, off.id], workDate: "2026-03-01", adminId });
    await setWorkerActive(sql, off.id, false, adminId);
    expect((await copyPreviousDay(sql, "2026-03-02", adminId)).created).toBe(1);
    expect((await copyPreviousDay(sql, "2026-03-02", adminId)).created).toBe(0);
    const { rows } = await getDaily(sql, "2026-03-02");
    expect(rows).toHaveLength(1);
    expect(rows[0].clock_in_at).toBeNull();
    expect(rows[0].attendance_status).toBe("scheduled");
  });
});
