import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { analyseAttendanceBook, baseName, commitAttendanceBook, normalizeBank, readAttendanceBook } from "@/server/services/attendanceBook";
import { createWorker, getWorker, revealSensitive, workerInputSchema } from "@/server/services/workers";
import { resetDb, seedAdmin, sql } from "./helpers";

let adminId: string;
beforeEach(async () => { await resetDb(); adminId = (await seedAdmin()).id; });

// 실제 출근부와 같은 모양: 1행 날짜, 2행 머리글, 날짜마다 [성함, 출근, 퇴근, 금액]. 값은 모두 가짜다.
const t = (hm: string) => new Date(`1899-12-30T${hm}:00.000Z`);
type P = { name: string; bank?: string; acct?: string; rrn?: string; phone?: string; days?: Record<string, [string | null, Date | string | null, number | null]> };
async function book(people: P[], dates = ["2025-06-01", "2025-06-02"]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("2025년 6월 출근부");
  const left = ["NO", "이 름", "은행", "계좌번호", "주민등록번호", "주   소", "연락처", "작업일수", "총액", "이체금액", "", "NO"];
  const r1 = [...left], r2 = [...left];
  dates.forEach((d) => { r1.push(new Date(`${d}T00:00:00Z`) as never, "", "", ""); r2.push("성함", "출근", "퇴근", "금액"); });
  ws.addRow(r1); ws.addRow(r2);
  people.forEach((p, i) => {
    const row: unknown[] = [i + 1, p.name, p.bank ?? "", p.acct ?? "", p.rrn ?? "", `일산동구 ${i + 1}`, p.phone ?? "", null, null, null, null, i + 1];
    dates.forEach((d) => { const x = p.days?.[d]; row.push(x ? p.name : null, x ? t("08:50") : null, x ? x[1] : null, x ? x[2] : null); });
    ws.addRow(row);
  });
  ws.addRow(["총 합 계 액", "총 합 계 액"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const ok = (n: number, extra: Partial<P> = {}): P => ({
  name: `근무자${n}`, bank: "농협", acct: `3020000000${String(n).padStart(3, "0")}`, rrn: `800101-2${String(n).padStart(6, "0")}`, phone: `010-5000-${String(n).padStart(4, "0")}`, ...extra,
});
const workedOn = (amount: number | null, out: Date | string | null = t("17:50")) => ({ "2025-06-02": [null, out, amount] as [null, Date | string | null, number | null] });

describe("출근부 읽기", () => {
  it("사람 정보와 날짜별 출근·퇴근·금액을 읽는다", async () => {
    const b = await readAttendanceBook(await book([ok(1, { days: workedOn(93000) })]));
    expect(b.dates).toEqual(["2025-06-01", "2025-06-02"]);
    expect(b.people).toHaveLength(1); // 합계 행은 사람이 아니다
    expect(b.people[0]).toMatchObject({ name: "근무자1", phone: "01050000001", bank: "농협", address: "일산동구 1", days: [{ date: "2025-06-02", clockIn: "08:50", clockOut: "17:50", amount: 93000 }] });
  });

  it("은행 이름과 예금주 이름을 정리한다", () => {
    expect(["우리은행", "농혀", "sc제일", "카카오뱅크"].map(normalizeBank)).toEqual(["우리", "농협", "SC제일", "카카오"]);
    expect(["김영순(61)", "이미선 81", "김태욱(남)", "진세라"].map(baseName)).toEqual(["김영순", "이미선", "김태욱", "진세라"]);
  });

  it("휴대폰·계좌·주민번호가 모두 있어야 등록 대상이다", async () => {
    const b = await readAttendanceBook(await book([
      ok(1), ok(2, { rrn: "800101-200000" }), ok(3, { phone: "" }), ok(4, { acct: "" }),
      ok(5, { rrn: "800101-5000005" }), // 외국인등록번호
      ok(6, { acct: "010-5000-0006", bank: "기업" }), // 휴대폰 번호 계좌
    ]));
    const { rows, summary } = await analyseAttendanceBook(sql, b.people);
    expect(rows.map((r) => r.status)).toEqual(["ready", "incomplete", "incomplete", "incomplete", "ready", "ready"]);
    expect(rows[1].problems[0]).toContain("12자리");
    expect(rows[4].foreigner).toBe(true);
    expect(summary).toMatchObject({ people: 6, ready: 3, incomplete: 3 });
  });

  it("같은 사람이 두 줄이면 하나로, 휴대폰 번호만 겹치면 뒤 사람을 제외한다", async () => {
    const b = await readAttendanceBook(await book([
      ok(1), ok(1, { name: "근무자1(별칭)" }), ok(2), ok(3, { phone: "010-5000-0002" }),
    ]));
    const { rows } = await analyseAttendanceBook(sql, b.people);
    expect(rows.map((r) => r.status)).toEqual(["ready", "same_person", "ready", "phone_conflict"]);
  });
});

describe("출근부 등록", () => {
  it("등록 대상만 근무자로 만들고 출근 기록과 금액을 넣는다", async () => {
    const buf = await book([
      ok(1, { days: workedOn(93000) }), ok(2, { days: workedOn(108000) }), ok(3, { rrn: "" , days: workedOn(93000) }),
    ]);
    const b = await readAttendanceBook(buf);
    const r = await commitAttendanceBook(sql, { people: b.people, sheet: b.sheet, adminId });
    expect(r).toMatchObject({ workers: 2, records: 2 });
    const recs = await sql<{ name: string; clock_in_at: Date; clock_out_at: Date; actual_wage: number; status: string }[]>`
      SELECT w.name, r.clock_in_at, r.clock_out_at, dw.actual_wage, dw.status FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id ORDER BY w.name`;
    expect(recs.map((x) => [x.name, x.actual_wage, x.status])).toEqual([["근무자1", 93000, "pending"], ["근무자2", 108000, "pending"]]);
    expect(recs[0].clock_in_at.toISOString()).toBe("2025-06-01T23:50:00.000Z"); // 6월 2일 08:50 한국 시간
    expect(recs[0].clock_out_at.toISOString()).toBe("2025-06-02T08:50:00.000Z");
    const [w] = await sql<{ id: string; rrn_enc: string | null }[]>`SELECT id, rrn_enc FROM workers WHERE name = '근무자1'`;
    expect(w.rrn_enc).not.toBeNull();
    expect(await getWorker(sql, w.id)).toMatchObject({ rrn: "8001012000001", address: "일산동구 1" });
    expect(await revealSensitive(sql, w.id, "account", adminId)).toBe("3020000000001");
  });

  it("다시 올려도 근무자와 출근 기록이 두 번 생기지 않는다", async () => {
    const b = await readAttendanceBook(await book([ok(1, { days: workedOn(93000) })]));
    await commitAttendanceBook(sql, { people: b.people, sheet: b.sheet, adminId });
    const again = await commitAttendanceBook(sql, { people: b.people, sheet: b.sheet, adminId });
    expect(again).toMatchObject({ workers: 0, records: 0, skippedRecords: 1 });
    expect(await sql`SELECT 1 FROM workers`).toHaveLength(1);
  });

  it("이미 등록된 휴대폰 번호면 기존 근무자에게 출근 기록만 붙인다", async () => {
    const existing = await createWorker(sql, workerInputSchema.parse({ name: "기존", phone: "01050000001", baseDailyWage: 90000 }), adminId);
    const b = await readAttendanceBook(await book([ok(1, { days: workedOn(null) })]));
    const { rows } = await analyseAttendanceBook(sql, b.people);
    expect(rows[0]).toMatchObject({ status: "existing", existingName: "기존" });
    await commitAttendanceBook(sql, { people: b.people, sheet: b.sheet, adminId });
    const [rec] = await sql<{ worker_id: string; actual_wage: number }[]>`SELECT r.worker_id, dw.actual_wage FROM work_records r JOIN daily_wages dw ON dw.work_record_id = r.id`;
    expect(rec).toEqual({ worker_id: existing.id, actual_wage: 90000 }); // 금액이 비어 있으면 기본 일당
  });

  it("퇴근 시각 대신 '조퇴'만 적힌 날은 퇴근 없이 넣고 알려 준다", async () => {
    const b = await readAttendanceBook(await book([ok(1, { days: workedOn(null, "조퇴") })]));
    expect(b.people[0].days[0]).toMatchObject({ clockOut: null, note: "조퇴" });
    const r = await commitAttendanceBook(sql, { people: b.people, sheet: b.sheet, adminId });
    expect(r.openShifts).toEqual(["근무자1 2025-06-02"]);
    const [w] = await sql<{ actual_wage: number; note: string }[]>`SELECT actual_wage, note FROM daily_wages`;
    expect(w).toEqual({ actual_wage: 0, note: "금액·퇴근 미기재, 확인 후 입력" }); // 시트에 없는 돈을 붙이지 않는다
  });
});

describe("근무자만 넣기", () => {
  it("records: false면 출근 기록 없이 근무자만 등록한다", async () => {
    const b = await readAttendanceBook(await book([ok(1, { days: workedOn(93000) })]));
    const r = await commitAttendanceBook(sql, { people: b.people, sheet: b.sheet, adminId, records: false });
    expect(r).toMatchObject({ workers: 1, records: 0 });
    expect(await sql`SELECT 1 FROM work_records`).toHaveLength(0);
  });
});
