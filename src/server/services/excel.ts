import ExcelJS from "exceljs";
import type { Sql } from "../db";
import { tx } from "../db";
import { blindIndex, decryptField } from "../crypto";
import { badRequest } from "../errors";
import { audit } from "../audit";
import { env } from "../env";
import { formatDateTime, formatPhone, normalizePhone, parseMoney } from "@/lib/format";
import { createWorker, getWorker, updateWorker, workerInputSchema, type WorkerInput } from "./workers";
import { getDaily } from "./attendance";
import { settlementReport } from "./settlement";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

// ── 내보내기 ───────────────────────────────────────────
type Col = { header: string; key: string; width?: number; kind?: "text" | "money" | "int" };

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[], totals?: Record<string, unknown>) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({
    header: c.header, key: c.key, width: c.width ?? 14,
    // 전화번호·계좌번호는 앞자리 0이 사라지지 않게 텍스트 서식을 쓴다.
    style: { numFmt: c.kind === "money" ? "#,##0" : c.kind === "int" ? "0" : "@" },
  }));
  rows.forEach((r) => ws.addRow(r));
  if (totals) ws.addRow(totals).font = { bold: true };
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  head.alignment = { vertical: "middle", horizontal: "center" };
  head.height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

async function toBuffer(wb: ExcelJS.Workbook) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const dt = (d: Date | null) => (d ? formatDateTime(d.toISOString()) : "");
const STATUS: Record<string, string> = { pending: "미확정", confirmed: "확정" };
const ATT: Record<string, string> = { scheduled: "출근 전", working: "근무 중", done: "퇴근 완료", missing_out: "퇴근 누락" };

async function exportWorkers(sql: Sql) {
  const rows = await sql<{ worker_number: number; name: string; phone: string | null; base_daily_wage: number; bank_name: string | null; enc: string | null; account_holder: string | null; memo: string; created_at: Date; last_work_date: string | null; is_active: boolean }[]>`
    SELECT w.worker_number, w.name, w.phone, w.base_daily_wage, a.bank_name, a.account_number_enc AS enc, a.account_holder, w.memo, w.created_at, w.is_active,
      (SELECT max(r.work_date)::text FROM work_records r WHERE r.worker_id = w.id AND r.deleted_at IS NULL) AS last_work_date
    FROM workers w LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current ORDER BY w.worker_number`;
  const wb = new ExcelJS.Workbook();
  sheet(wb, "근무자 명부", [
    { header: "고유번호", key: "num", kind: "int", width: 10 }, { header: "이름", key: "name" }, { header: "전화번호", key: "phone", width: 16 },
    { header: "기본 일당", key: "wage", kind: "money" }, { header: "은행명", key: "bank" }, { header: "계좌번호", key: "account", width: 20 },
    { header: "예금주", key: "holder" }, { header: "상태", key: "status", width: 8 }, { header: "등록일", key: "created" , width: 18}, { header: "최근 근무일", key: "last" }, { header: "메모", key: "memo", width: 30 },
  ], rows.map((r) => ({
    num: r.worker_number, name: r.name, phone: r.phone ? formatPhone(r.phone) : "", wage: r.base_daily_wage, bank: r.bank_name ?? "",
    account: r.enc ? decryptField(r.enc) : "", holder: r.account_holder ?? "", status: r.is_active ? "활성" : "비활성",
    created: dt(r.created_at), last: r.last_work_date ?? "", memo: r.memo,
  })));
  return { wb, filename: "근무자_명부.xlsx", count: rows.length };
}

async function exportAttendance(sql: Sql, date: string) {
  const { rows, summary } = await getDaily(sql, date);
  const wb = new ExcelJS.Workbook();
  sheet(wb, `출석부 ${date}`, [
    { header: "고유번호", key: "num", kind: "int", width: 10 }, { header: "이름", key: "name" }, { header: "출근", key: "in", width: 18 }, { header: "퇴근", key: "out", width: 18 },
    { header: "상태", key: "status", width: 10 }, { header: "등록 방식", key: "source", width: 10 }, { header: "당일 일당", key: "actual", kind: "money" },
    { header: "추가 지급액", key: "extra", kind: "money" }, { header: "최종 일당", key: "final", kind: "money" }, { header: "정산", key: "wage", width: 8 },
  ], rows.map((r) => ({
    num: r.worker_number, name: r.name, in: dt(r.clock_in_at), out: dt(r.clock_out_at), status: ATT[r.attendance_status],
    source: r.source === "kiosk" ? "키오스크" : "수동", actual: r.actual_wage, extra: r.extra_pay, final: r.final_wage, wage: STATUS[r.wage_status],
  })), { name: `합계 ${summary.total}명`, final: summary.totalWage });
  return { wb, filename: `출석부_${date}.xlsx`, count: rows.length };
}

async function exportRecords(sql: Sql, from: string, to: string) {
  const rows = await sql<{ work_date: string; worker_number: number; name: string; clock_in_at: Date | null; clock_out_at: Date | null; source: string; base_wage: number; actual_wage: number; extra_pay: number; final_wage: number; status: string; note: string }[]>`
    SELECT r.work_date::text AS work_date, w.worker_number, w.name, r.clock_in_at, r.clock_out_at, r.source, dw.base_wage, dw.actual_wage, dw.extra_pay, dw.final_wage, dw.status, dw.note
    FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id
    WHERE r.work_date BETWEEN ${from} AND ${to} AND r.deleted_at IS NULL ORDER BY r.work_date, w.worker_number`;
  const wb = new ExcelJS.Workbook();
  sheet(wb, "근무 기록", [
    { header: "근무일", key: "date", width: 12 }, { header: "고유번호", key: "num", kind: "int", width: 10 }, { header: "이름", key: "name" }, { header: "출근", key: "in", width: 18 }, { header: "퇴근", key: "out", width: 18 },
    { header: "등록 방식", key: "source", width: 10 }, { header: "기본 일당", key: "base", kind: "money" }, { header: "당일 일당", key: "actual", kind: "money" }, { header: "추가 지급액", key: "extra", kind: "money" },
    { header: "최종 일당", key: "final", kind: "money" }, { header: "정산", key: "status", width: 8 }, { header: "비고", key: "note", width: 24 },
  ], rows.map((r) => ({
    date: r.work_date, num: r.worker_number, name: r.name, in: dt(r.clock_in_at), out: dt(r.clock_out_at), source: r.source === "kiosk" ? "키오스크" : "수동",
    base: r.base_wage, actual: r.actual_wage, extra: r.extra_pay, final: r.final_wage, status: STATUS[r.status], note: r.note,
  })));
  return { wb, filename: `근무기록_${from}_${to}.xlsx`, count: rows.length };
}

async function exportWageSummary(sql: Sql, from: string, to: string) {
  const { rows, summary } = await settlementReport(sql, from, to);
  const wb = new ExcelJS.Workbook();
  sheet(wb, "일당 합계", [
    { header: "고유번호", key: "num", kind: "int", width: 10 }, { header: "이름", key: "name" }, { header: "근무일 수", key: "days", kind: "int", width: 10 },
    { header: "일당 합계", key: "total", kind: "money" }, { header: "확정 금액", key: "confirmed", kind: "money" }, { header: "미확정 금액", key: "pending", kind: "money" },
  ], rows.map((r) => ({ num: r.worker_number, name: r.name, days: r.work_days, total: r.total_wage, confirmed: r.confirmed_wage, pending: r.pending_wage })),
  { name: "합계", days: summary.workDays, total: summary.totalWage, confirmed: summary.confirmedWage, pending: summary.pendingWage });
  return { wb, filename: `일당합계_${from}_${to}.xlsx`, count: rows.length };
}

/** 지급용 자료에는 관리자가 확정한 금액만 들어간다. */
async function exportPayment(sql: Sql, from: string, to: string) {
  const rows = await sql<{ worker_number: number; name: string; bank_name: string | null; enc: string | null; account_holder: string | null; work_days: number; amount: number }[]>`
    SELECT w.worker_number, w.name, a.bank_name, a.account_number_enc AS enc, a.account_holder, count(*)::int AS work_days, sum(dw.final_wage)::float8 AS amount
    FROM work_records r JOIN workers w ON w.id = r.worker_id JOIN daily_wages dw ON dw.work_record_id = r.id
    LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current
    WHERE r.work_date BETWEEN ${from} AND ${to} AND r.deleted_at IS NULL AND dw.status = 'confirmed'
    GROUP BY w.worker_number, w.name, a.bank_name, a.account_number_enc, a.account_holder ORDER BY w.worker_number`;
  const wb = new ExcelJS.Workbook();
  const total = rows.reduce((s, r) => s + r.amount, 0);
  sheet(wb, "지급 자료", [
    { header: "고유번호", key: "num", kind: "int", width: 10 }, { header: "이름", key: "name" }, { header: "은행명", key: "bank" }, { header: "계좌번호", key: "account", width: 20 },
    { header: "예금주", key: "holder" }, { header: "확정 근무일", key: "days", kind: "int", width: 11 }, { header: "지급 금액", key: "amount", kind: "money" }, { header: "비고", key: "note", width: 16 },
  ], rows.map((r) => ({
    num: r.worker_number, name: r.name, bank: r.bank_name ?? "", account: r.enc ? decryptField(r.enc) : "", holder: r.account_holder ?? "",
    days: r.work_days, amount: r.amount, note: r.enc ? "" : "계좌 미등록",
  })), { name: "합계", amount: total });
  return { wb, filename: `지급자료_${from}_${to}.xlsx`, count: rows.length };
}

export type ExportType = "workers" | "attendance" | "records" | "wage-summary" | "payment";

export async function buildExport(sql: Sql, input: { type: ExportType; date?: string; from?: string; to?: string; adminId: string }) {
  const need = (v?: string) => { if (!v) throw badRequest("날짜를 지정해 주세요."); return v; };
  const result =
    input.type === "workers" ? await exportWorkers(sql)
    : input.type === "attendance" ? await exportAttendance(sql, need(input.date))
    : input.type === "records" ? await exportRecords(sql, need(input.from), need(input.to))
    : input.type === "wage-summary" ? await exportWageSummary(sql, need(input.from), need(input.to))
    : await exportPayment(sql, need(input.from), need(input.to));
  await audit(sql, {
    administratorId: input.adminId, action: `excel.export.${input.type}`, targetType: "excel", targetId: result.filename,
    after: { rows: result.count, date: input.date, from: input.from, to: input.to },
  });
  return { buffer: await toBuffer(result.wb), filename: result.filename };
}

// ── 가져오기 ───────────────────────────────────────────
export const IMPORT_FIELDS = [
  { key: "name", label: "이름", required: true, synonyms: ["이름", "성명", "근무자", "근무자명", "name"] },
  { key: "phone", label: "전화번호", synonyms: ["전화번호", "연락처", "휴대폰", "휴대전화", "핸드폰", "전화", "phone"] },
  { key: "baseDailyWage", label: "기본 일당", synonyms: ["기본일당", "일당", "단가", "일급", "기본단가"] },
  { key: "bankName", label: "은행명", synonyms: ["은행명", "은행", "bank"] },
  { key: "accountNumber", label: "계좌번호", synonyms: ["계좌번호", "계좌", "account"] },
  { key: "accountHolder", label: "예금주", synonyms: ["예금주", "예금주명", "수취인"] },
  { key: "memo", label: "메모", synonyms: ["메모", "비고", "참고"] },
  { key: "rrn", label: "주민등록번호", rrnOnly: true, synonyms: ["주민등록번호", "주민번호"] },
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ImportMapping = Partial<Record<ImportFieldKey, number>>;

export const availableImportFields = () => IMPORT_FIELDS.filter((f) => !("rrnOnly" in f) || env.rrnEnabled);

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("").trim();
    if ("result" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}

export function suggestMapping(headers: string[]): ImportMapping {
  const clean = headers.map((h) => h.replace(/\s/g, "").toLowerCase());
  const mapping: ImportMapping = {};
  for (const f of availableImportFields()) {
    const idx = clean.findIndex((h) => (f.synonyms as readonly string[]).some((s) => h === s.toLowerCase()));
    const loose = idx >= 0 ? idx : clean.findIndex((h) => (f.synonyms as readonly string[]).some((s) => h.includes(s.toLowerCase())));
    if (loose >= 0) mapping[f.key] = loose;
  }
  return mapping;
}

/** 업로드한 파일을 읽어 머리글과 행을 돌려준다. DB에는 아직 아무것도 쓰지 않는다. */
export async function parseWorkbook(buffer: ArrayBuffer | Buffer) {
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw badRequest("파일은 4MB 이하만 업로드할 수 있습니다.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as never);
  } catch {
    throw badRequest(".xlsx 형식의 파일만 읽을 수 있습니다. 엑셀에서 '다른 이름으로 저장'으로 .xlsx로 저장해 주세요.");
  }
  const ws = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!ws) throw badRequest("내용이 있는 시트를 찾지 못했습니다.");
  const all: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= ws.actualColumnCount; c++) values.push(cellText(row.getCell(c).value));
    if (values.some(Boolean)) all.push(values);
  });
  if (all.length < 2) throw badRequest("머리글과 데이터가 최소 한 행씩 있어야 합니다.");
  const [headers, ...rows] = all;
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`한 번에 ${MAX_IMPORT_ROWS.toLocaleString()}행까지 가져올 수 있습니다.`);
  return { headers, rows, mapping: suggestMapping(headers), fields: availableImportFields().map(({ key, label, ...f }) => ({ key, label, required: "required" in f })) };
}

export type ImportRowResult = {
  row: number; status: "new" | "duplicate" | "error"; errors: string[]; reasons: string[]; existingNumber?: number;
  name: string; phone: string | null; baseDailyWage: number | null; bankName: string | null; accountLast4: string | null; accountHolder: string | null;
};

type ParsedRow = { result: ImportRowResult; input?: WorkerInput; wageGiven: boolean; existingId?: string };

async function analyse(sql: Sql, rows: string[][], mapping: ImportMapping): Promise<ParsedRow[]> {
  if (mapping.name === undefined) throw badRequest("이름 열을 지정해 주세요.");
  const existing = await sql<{ id: string; worker_number: number; name: string; phone: string | null; rrn_hash: string | null; account_number_hash: string | null }[]>`
    SELECT w.id, w.worker_number, w.name, w.phone, w.rrn_hash, a.account_number_hash
    FROM workers w LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current`;
  type Ref = { id?: string; number?: number; row?: number; hasPhone: boolean };
  const byPhone = new Map<string, Ref>(), byAccount = new Map<string, Ref>(), byRrn = new Map<string, Ref>(), byName = new Map<string, Ref>();
  for (const w of existing) {
    const ref = { id: w.id, number: w.worker_number, hasPhone: !!w.phone };
    if (w.phone) byPhone.set(w.phone, ref);
    if (w.account_number_hash) byAccount.set(w.account_number_hash, ref);
    if (w.rrn_hash) byRrn.set(w.rrn_hash, ref);
    byName.set(w.name, ref);
  }
  const get = (r: string[], k: ImportFieldKey) => { const i = mapping[k]; return i === undefined ? "" : (r[i] ?? "").trim(); };

  return rows.map((r, i): ParsedRow => {
    const rowNumber = i + 2; // 1행은 머리글
    const errors: string[] = [];
    const wageRaw = get(r, "baseDailyWage");
    const wage = parseMoney(wageRaw);
    if (wage === null) errors.push("기본 일당이 숫자가 아닙니다.");
    const parsed = workerInputSchema.safeParse({
      name: get(r, "name"), phone: get(r, "phone") || null, baseDailyWage: wage ?? 0,
      bankName: get(r, "bankName") || null, accountNumber: get(r, "accountNumber") || null, accountHolder: get(r, "accountHolder") || null,
      rrn: env.rrnEnabled ? get(r, "rrn") || null : null, memo: get(r, "memo"),
    });
    if (!parsed.success) errors.push(...parsed.error.issues.map((x) => x.message));
    const input = parsed.success ? parsed.data : undefined;
    if (input) {
      const filled = [input.bankName, input.accountNumber, input.accountHolder].filter(Boolean).length;
      if (filled > 0 && filled < 3) errors.push("은행명, 계좌번호, 예금주를 모두 입력해 주세요.");
    }
    const digits = get(r, "accountNumber").replace(/\D/g, "");
    const base: ImportRowResult = {
      row: rowNumber, status: "new", errors, reasons: [], name: input?.name ?? get(r, "name"),
      phone: input?.phone ?? normalizePhone(get(r, "phone")), baseDailyWage: wage,
      bankName: input?.bankName ?? null, accountLast4: digits ? digits.slice(-4) : null, accountHolder: input?.accountHolder ?? null,
    };
    if (errors.length || !input) return { result: { ...base, status: "error" }, wageGiven: wageRaw !== "" };

    const accountHash = input.accountNumber ? blindIndex(input.accountNumber) : null;
    const rrnHash = input.rrn ? blindIndex(input.rrn) : null;
    const matches: [string, Ref | undefined][] = [
      ["주민등록번호 일치", rrnHash ? byRrn.get(rrnHash) : undefined],
      ["전화번호 일치", input.phone ? byPhone.get(input.phone) : undefined],
      ["계좌번호 일치", accountHash ? byAccount.get(accountHash) : undefined],
    ];
    // 전화번호가 없으면 이름으로만 구분할 수 있어 같은 이름을 중복으로 본다.
    const sameName = byName.get(input.name);
    if (sameName && (!input.phone || !sameName.hasPhone)) matches.push(["이름 일치(전화번호 없음)", sameName]);
    const hit = matches.filter(([, ref]) => ref);
    const first = hit[0]?.[1];
    const out: ParsedRow = {
      result: {
        ...base, status: hit.length ? "duplicate" : "new",
        reasons: hit.map(([label, ref]) => (ref?.row ? `${label} (파일 ${ref.row}행)` : label)),
        existingNumber: first?.number,
      },
      input, wageGiven: wageRaw !== "", existingId: first?.id,
    };
    if (!hit.length) {
      // 파일 안의 중복도 잡도록 새 행을 색인에 추가한다.
      const ref = { row: rowNumber, hasPhone: !!input.phone };
      if (input.phone) byPhone.set(input.phone, ref);
      if (accountHash) byAccount.set(accountHash, ref);
      if (rrnHash) byRrn.set(rrnHash, ref);
      byName.set(input.name, ref);
    }
    return out;
  });
}

export async function validateImport(sql: Sql, rows: string[][], mapping: ImportMapping) {
  const parsed = await analyse(sql, rows, mapping);
  const results = parsed.map((p) => p.result);
  return {
    results,
    summary: {
      total: results.length,
      new: results.filter((r) => r.status === "new").length,
      duplicate: results.filter((r) => r.status === "duplicate").length,
      error: results.filter((r) => r.status === "error").length,
    },
  };
}

/** 서버에서 다시 검증한 뒤 한 트랜잭션으로 반영한다. 중간에 실패하면 전부 취소된다. */
export async function commitImport(sql: Sql, input: { rows: string[][]; mapping: ImportMapping; duplicatePolicy: "skip" | "update"; adminId: string }) {
  if (input.rows.length > MAX_IMPORT_ROWS) throw badRequest(`한 번에 ${MAX_IMPORT_ROWS.toLocaleString()}행까지 가져올 수 있습니다.`);
  return tx(sql, async (t) => {
    const parsed = await analyse(t, input.rows, input.mapping);
    let created = 0, updated = 0, skipped = 0, errors = 0;
    for (const p of parsed) {
      if (p.result.status === "error" || !p.input) { errors++; continue; }
      if (p.result.status === "new") {
        await createWorker(t, p.input, input.adminId, { allowDuplicate: true });
        created++;
      } else if (input.duplicatePolicy === "update" && p.existingId) {
        const cur = await getWorker(t, p.existingId);
        await updateWorker(t, p.existingId, {
          ...p.input,
          phone: p.input.phone ?? cur.phone,
          baseDailyWage: p.wageGiven ? p.input.baseDailyWage : cur.base_daily_wage,
          memo: p.input.memo || cur.memo,
        }, input.adminId);
        updated++;
      } else skipped++;
    }
    await audit(t, { administratorId: input.adminId, action: "excel.import.workers", targetType: "excel", after: { created, updated, skipped, errors } });
    return { created, updated, skipped, errors };
  });
}

export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const cols: Col[] = availableImportFields().map((f) => ({ header: f.label, key: f.key, width: f.key === "memo" ? 30 : 16, kind: f.key === "baseDailyWage" ? "money" : "text" }));
  sheet(wb, "근무자 등록", cols, [{
    name: "홍길동", phone: "010-0000-0000", baseDailyWage: 150000, bankName: "국민은행", accountNumber: "000000-00-000000", accountHolder: "홍길동", memo: "예시 행입니다. 지우고 입력하세요.",
  }]);
  return toBuffer(wb);
}
