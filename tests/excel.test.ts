import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildExport, buildTemplate, commitImport, parseWorkbook, suggestMapping, validateImport } from "@/server/services/excel";
import { createWorker, getWorker, revealSensitive, workerInputSchema } from "@/server/services/workers";
import { addManualRecords } from "@/server/services/attendance";
import { resetDb, seedAdmin, sql } from "./helpers";

let adminId: string;
beforeEach(async () => { await resetDb(); adminId = (await seedAdmin()).id; });

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const HEAD = ["성명", "연락처", "일당", "은행", "계좌번호", "예금주"];
const mapping = { name: 0, phone: 1, baseDailyWage: 2, bankName: 3, accountNumber: 4, accountHolder: 5 };

describe("가져오기", () => {
  it("열 이름을 자동으로 연결한다", () => {
    expect(suggestMapping(["No", "성명", "휴대폰 번호", "기본 일당", "은행명", "계좌 번호", "예금주", "비고"]))
      .toMatchObject({ name: 1, phone: 2, baseDailyWage: 3, bankName: 4, accountNumber: 5, accountHolder: 6, memo: 7 });
  });

  it("파일을 읽어도 DB에는 쓰지 않고, 숫자 셀과 서식이 있는 값을 문자열로 읽는다", async () => {
    const p = await parseWorkbook(await xlsx([HEAD, ["김갑", 1012345678, 150000, "국민", "123-45", "김갑"]]));
    expect(p.headers).toEqual(HEAD);
    expect(p.rows[0][1]).toBe("1012345678");
    expect(await sql`SELECT 1 FROM workers`).toHaveLength(0);
  });

  it("엑셀이 아닌 파일을 친절하게 거절한다", async () => {
    await expect(parseWorkbook(Buffer.from("not excel"))).rejects.toThrow(".xlsx");
  });

  it("오류·중복·신규를 구분하고 사유를 알려 준다", async () => {
    await createWorker(sql, workerInputSchema.parse({ name: "기존", phone: "01000000001" }), adminId);
    const rows = [
      ["신규", "010-9999-0001", "150,000원", "", "", ""],
      ["기존 전화", "01000000001", "1", "", "", ""],
      ["", "010-9999-0002", "1", "", "", ""],
      ["금액오류", "010-9999-0003", "많이", "", "", ""],
      ["전화오류", "12", "1", "", "", ""],
      ["계좌일부", "010-9999-0004", "1", "국민", "", ""],
      ["파일중복A", "010-9999-0005", "1", "", "", ""],
      ["파일중복B", "010-9999-0005", "1", "", "", ""],
    ];
    const { results, summary } = await validateImport(sql, rows, mapping);
    expect(results.map((r) => r.status)).toEqual(["new", "duplicate", "error", "error", "error", "error", "new", "duplicate"]);
    expect(summary).toEqual({ total: 8, new: 2, duplicate: 2, error: 4 });
    expect(results[0].baseDailyWage).toBe(150000);
    expect(results[0].row).toBe(2);
    expect(results[7].reasons[0]).toContain("파일 8행");
  });

  it("휴대폰 번호가 없거나 서로 다른 두 사람과 겹치는 행은 오류로 표시한다", async () => {
    const acct = { bankName: "국민", accountNumber: "123456789012", accountHolder: "갑" };
    await createWorker(sql, workerInputSchema.parse({ name: "갑", phone: "01000000001", ...acct }), adminId);
    await createWorker(sql, workerInputSchema.parse({ name: "을", phone: "01000000002" }), adminId);
    const { results } = await validateImport(sql, [
      ["번호없음", "", "1", "", "", ""],
      ["겹침", "01000000002", "1", "국민", "123456789012", "을"],
    ], mapping);
    expect(results.map((r) => r.status)).toEqual(["error", "error"]);
    expect(results[1].errors[0]).toContain("서로 다른 근무자");
  });

  it("앞자리 0이 사라진 휴대폰 번호를 복원해 중복을 찾는다", async () => {
    await createWorker(sql, workerInputSchema.parse({ name: "기존", phone: "01012345678" }), adminId);
    const { results } = await validateImport(sql, [["누구", "1012345678", "", "", "", ""]], mapping);
    expect(results[0].status).toBe("duplicate");
  });

  it("검증 응답에 계좌번호 원문을 담지 않는다", async () => {
    const { results } = await validateImport(sql, [["김갑", "", "1", "국민", "123456789012", "김갑"]], mapping);
    expect(JSON.stringify(results)).not.toContain("123456789012");
    expect(results[0].accountLast4).toBe("9012");
  });

  it("건너뛰기: 신규만 등록하고 번호를 자동 발급하며 계좌를 암호화한다", async () => {
    await createWorker(sql, workerInputSchema.parse({ name: "기존", phone: "01000000001", baseDailyWage: 1000 }), adminId);
    const rows = [["새사람", "010-9999-0001", "150000", "국민", "123456789012", "새사람"], ["기존", "01000000001", "2000", "", "", ""], ["", "", "", "", "", ""]];
    const r = await commitImport(sql, { rows, mapping, duplicatePolicy: "skip", adminId });
    expect(r).toEqual({ created: 1, updated: 0, skipped: 1, errors: 1 });
    const [n] = await sql<{ id: string; worker_number: number }[]>`SELECT id, worker_number FROM workers WHERE name = '새사람'`;
    expect(n.worker_number).toBeGreaterThan(0);
    expect(await revealSensitive(sql, n.id, "account", adminId)).toBe("123456789012");
    const [old] = await sql<{ base_daily_wage: number }[]>`SELECT base_daily_wage FROM workers WHERE name = '기존'`;
    expect(old.base_daily_wage).toBe(1000);
  });

  it("덮어쓰기: 파일에 있는 값만 갱신하고 비어 있는 값은 유지한다", async () => {
    const w = await createWorker(sql, workerInputSchema.parse({ name: "기존", phone: "01000000001", baseDailyWage: 1000, memo: "유지", bankName: "국민", accountNumber: "111111111", accountHolder: "기존" }), adminId);
    const r = await commitImport(sql, { rows: [["기존", "01000000001", "", "", "", ""]], mapping, duplicatePolicy: "update", adminId });
    expect(r.updated).toBe(1);
    let cur = await getWorker(sql, w.id);
    expect(cur.base_daily_wage).toBe(1000);
    expect(cur.memo).toBe("유지");
    expect(await revealSensitive(sql, w.id, "account", adminId)).toBe("111111111");
    await commitImport(sql, { rows: [["기존", "01000000001", "2000", "", "", ""]], mapping, duplicatePolicy: "update", adminId });
    cur = await getWorker(sql, w.id);
    expect(cur.base_daily_wage).toBe(2000);
  });

  it("다시 가져와도 근무자가 중복 생성되지 않는다", async () => {
    const rows = [["새사람", "010-9999-0001", "150000", "", "", ""]];
    await commitImport(sql, { rows, mapping, duplicatePolicy: "skip", adminId });
    expect((await commitImport(sql, { rows, mapping, duplicatePolicy: "skip", adminId })).skipped).toBe(1);
    expect(await sql`SELECT 1 FROM workers`).toHaveLength(1);
  });

  it("제공한 양식을 그대로 읽을 수 있다", async () => {
    const p = await parseWorkbook(await buildTemplate());
    expect(p.mapping).toMatchObject({ name: 0, phone: 1, baseDailyWage: 2, bankName: 3, accountNumber: 4, accountHolder: 5 });
    const { results } = await validateImport(sql, p.rows, p.mapping);
    expect(results[0].status).toBe("new");
  });
});

describe("내보내기", () => {
  async function read(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    return wb.worksheets[0];
  }

  it("수식처럼 보이는 값을 수식이 아닌 문자열로 저장한다", async () => {
    await createWorker(sql, workerInputSchema.parse({ name: '=HYPERLINK("http://evil","x")', phone: "01012345678" }), adminId);
    const { buffer } = await buildExport(sql, { type: "workers", adminId });
    const ws = await read(buffer);
    const v = ws.getRow(2).getCell(1).value;
    expect(typeof v).toBe("string");
    expect(ws.getRow(2).getCell(1).type).toBe(ExcelJS.ValueType.String);
  });

  it("다섯 종류 내보내기가 모두 동작하고 이력이 남는다", async () => {
    const w = await createWorker(sql, workerInputSchema.parse({ name: "김갑", phone: "01012345678", baseDailyWage: 1000 }), adminId);
    await addManualRecords(sql, { workerIds: [w.id], workDate: "2026-03-02", adminId });
    for (const a of [
      { type: "workers" as const }, { type: "attendance" as const, date: "2026-03-02" },
      { type: "records" as const, from: "2026-03-01", to: "2026-03-31" },
      { type: "wage-summary" as const, from: "2026-03-01", to: "2026-03-31" },
      { type: "payment" as const, from: "2026-03-01", to: "2026-03-31" },
    ]) {
      const { buffer, filename } = await buildExport(sql, { ...a, adminId });
      expect(filename.endsWith(".xlsx")).toBe(true);
      expect((await read(buffer)).rowCount).toBeGreaterThanOrEqual(1);
    }
    const logs = await sql`SELECT 1 FROM audit_logs WHERE action LIKE 'excel.export.%'`;
    expect(logs).toHaveLength(5);
  });
});
