// 현장에서 쓰던 월별 "출근부" 엑셀을 그대로 읽어 근무자와 출근 기록으로 옮긴다.
//
// 양식: 1행 날짜, 2행 머리글. 왼쪽에 사람 정보(이름·은행·계좌번호·주민등록번호·연락처),
// 오른쪽에 날짜마다 [성함, 출근, 퇴근, 금액] 네 칸이 이어진다.
import ExcelJS from "exceljs";
import type { Sql } from "../db";
import { tx } from "../db";
import { audit } from "../audit";
import { badRequest } from "../errors";
import { createWorker, workerInputSchema } from "./workers";

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

const HEADER_ROWS = 2;
const MAX_ROWS = 2000;

export type BookDay = { date: string; clockIn: string | null; clockOut: string | null; note: string; amount: number | null };
export type BookPerson = {
  row: number; name: string; holder: string; bank: string; account: string; rrn: string; phone: string; address: string; days: BookDay[];
};
export type BookStatus = "ready" | "incomplete" | "same_person" | "phone_conflict" | "existing";
export type BookRow = Omit<BookPerson, "account" | "rrn"> & {
  status: BookStatus; problems: string[]; accountLast4: string; hasRrn: boolean; foreigner: boolean; existingName?: string;
};

// 같은 은행을 여러 이름으로 적은 경우를 하나로 맞춘다.
const BANK_ALIASES: Record<string, string> = {
  우리은행: "우리", 하나은행: "하나", 농혀: "농협", 농협은행: "농협", 국민은행: "국민", 신한은행: "신한", 기업은행: "기업",
  카카오뱅크: "카카오", 토스뱅크: "토스", sc제일: "SC제일", SC스탠다드: "SC제일", SC제일은행: "SC제일", 케이뱅크: "케이뱅크",
};
export const normalizeBank = (b: string) => BANK_ALIASES[b.replace(/\s/g, "")] ?? BANK_ALIASES[b.replace(/\s/g, "").toLowerCase()] ?? b.replace(/\s/g, "");

/** "김영순(61)", "이미선 81", "김태욱(남)" → 예금주로 쓸 이름만 남긴다. */
export const baseName = (name: string) => name.replace(/\(.*?\)/g, "").replace(/\d+/g, "").replace(/\s+/g, "").trim() || name.trim();

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result ?? null;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return v.text;
    return null;
  }
  return v;
}
const text = (v: ExcelJS.CellValue) => { const x = cellValue(v); return x == null ? "" : x instanceof Date ? x.toISOString() : String(x).trim(); };
const digits = (v: ExcelJS.CellValue) => text(v).replace(/\D/g, "");

/** 엑셀 시각 셀(날짜 부분 없는 Date, 소수, "8:50" 문자열)을 "HH:MM"으로. 시각이 아니면 null. */
function timeOf(v: ExcelJS.CellValue): string | null {
  const x = cellValue(v);
  if (x instanceof Date) return x.toISOString().slice(11, 16);
  if (typeof x === "number" && x >= 0 && x < 1) { const m = Math.round(x * 24 * 60); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
  const m = typeof x === "string" ? /^(\d{1,2}):(\d{2})/.exec(x.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
function dateOf(v: ExcelJS.CellValue): string | null {
  const x = cellValue(v);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  const m = typeof x === "string" ? /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(x) : null;
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

type Layout = { ws: ExcelJS.Worksheet; cols: { name: number; bank: number; account: number; rrn: number; phone: number; address: number }; days: { col: number; date: string }[] };

function findLayout(ws: ExcelJS.Worksheet): Layout | null {
  const head = (c: number) => text(ws.getRow(HEADER_ROWS).getCell(c).value).replace(/\s/g, "") || text(ws.getRow(1).getCell(c).value).replace(/\s/g, "");
  const width = Math.min(ws.actualColumnCount + 10, 400);
  const find = (...names: string[]) => { for (let c = 1; c <= 15; c++) if (names.includes(head(c))) return c; return 0; };
  const cols = { name: find("이름", "성명"), bank: find("은행", "은행명"), account: find("계좌번호", "계좌"), rrn: find("주민등록번호", "주민번호"), phone: find("연락처", "전화번호", "휴대폰"), address: find("주소") };
  if (!cols.name || !cols.phone) return null;
  const days: Layout["days"] = [];
  for (let c = 1; c <= width; c++) {
    const r2 = (k: number) => text(ws.getRow(HEADER_ROWS).getCell(c + k).value).replace(/\s/g, "");
    if (r2(1) !== "출근" || r2(2) !== "퇴근") continue;
    const date = dateOf(ws.getRow(1).getCell(c).value) ?? dateOf(ws.getRow(1).getCell(c + 1).value);
    if (date && !days.some((d) => d.date === date)) days.push({ col: c, date });
  }
  return days.length ? { ws, cols, days } : null;
}

/** 출근부 양식인 시트 이름 목록과, 고른 시트의 사람·출근 내용을 돌려준다. DB는 건드리지 않는다. */
export async function readAttendanceBook(buffer: ArrayBuffer | Buffer, sheetName?: string) {
  if (buffer.byteLength > MAX_IMPORT_BYTES) throw badRequest("파일은 4MB 이하만 올릴 수 있습니다.");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as never); } catch { throw badRequest(".xlsx 형식의 파일만 읽을 수 있습니다."); }
  const layouts = wb.worksheets.map((ws) => findLayout(ws)).filter((l): l is Layout => !!l);
  if (!layouts.length) throw badRequest("출근부 양식(이름·연락처 열과 날짜별 출근·퇴근 칸)을 찾지 못했습니다.");
  const layout = sheetName ? layouts.find((l) => l.ws.name === sheetName) : layouts[0];
  if (!layout) throw badRequest("선택한 시트를 찾지 못했습니다.");
  const { ws, cols, days } = layout;

  const people: BookPerson[] = [];
  const last = Math.min(ws.actualRowCount + HEADER_ROWS, MAX_ROWS);
  for (let r = HEADER_ROWS + 1; r <= last; r++) {
    const row = ws.getRow(r);
    const name = text(row.getCell(cols.name).value).replace(/\s+/g, " ");
    if (!name || /합계|총/.test(name)) continue;
    const worked: BookDay[] = [];
    for (const d of days) {
      const who = text(row.getCell(d.col).value), inRaw = row.getCell(d.col + 1).value, outRaw = row.getCell(d.col + 2).value;
      const amountRaw = cellValue(row.getCell(d.col + 3).value);
      const clockIn = timeOf(inRaw), clockOut = timeOf(outRaw);
      if (!who && !clockIn && !text(outRaw) && amountRaw == null) continue;
      const outText = clockOut ? "" : text(outRaw);
      worked.push({ date: d.date, clockIn, clockOut, note: outText, amount: typeof amountRaw === "number" ? Math.round(amountRaw) : null });
    }
    people.push({
      row: r, name, holder: baseName(name), bank: cols.bank ? normalizeBank(text(row.getCell(cols.bank).value)) : "",
      account: cols.account ? digits(row.getCell(cols.account).value) : "", rrn: cols.rrn ? digits(row.getCell(cols.rrn).value) : "",
      phone: digits(row.getCell(cols.phone).value), address: cols.address ? text(row.getCell(cols.address).value).replace(/\s+/g, " ").slice(0, 200) : "", days: worked,
    });
  }
  return { sheets: layouts.map((l) => l.ws.name), sheet: ws.name, dates: days.map((d) => d.date), people };
}

const validPhone = (p: string) => /^010\d{8}$/.test(p);
const validAccount = (bank: string, a: string) => !!bank && /^\d{10,16}$/.test(a);
const validRrn = (r: string) => /^\d{6}[1-8]\d{6}$/.test(r);

/** 사람마다 등록 가능 여부를 판정한다. 휴대폰·계좌·주민번호가 모두 있어야 등록 대상이다. */
export async function analyseAttendanceBook(sql: Sql, people: BookPerson[]) {
  const existing = new Map((await sql<{ phone: string; name: string }[]>`SELECT phone, name FROM workers`).map((w) => [w.phone, w.name]));
  const byRrn = new Map<string, BookPerson>(), byPhone = new Map<string, BookPerson>();
  const rows: (BookRow & { person: BookPerson })[] = people.map((p) => {
    const problems: string[] = [];
    if (!validPhone(p.phone)) problems.push(p.phone ? "휴대폰 번호 형식 오류" : "휴대폰 번호 없음");
    if (!validAccount(p.bank, p.account)) problems.push(!p.account ? "계좌번호 없음" : !p.bank ? "은행 없음" : "계좌번호 형식 오류");
    if (!validRrn(p.rrn)) problems.push(p.rrn ? `주민번호 형식 오류(${p.rrn.length}자리)` : "주민번호 없음");
    let status: BookStatus = problems.length ? "incomplete" : "ready";
    let existingName: string | undefined;
    if (status === "ready") {
      const sameRrn = byRrn.get(p.rrn), samePhone = byPhone.get(p.phone);
      if (sameRrn) { status = "same_person"; problems.push(`${sameRrn.row}행 ${sameRrn.name}님과 주민번호가 같음(같은 사람)`); }
      else if (samePhone) { status = "phone_conflict"; problems.push(`${samePhone.row}행 ${samePhone.name}님과 휴대폰 번호가 같음`); }
      else if (existing.has(p.phone)) { status = "existing"; existingName = existing.get(p.phone); }
      if (status === "ready" || status === "existing") { byRrn.set(p.rrn, p); byPhone.set(p.phone, p); }
    }
    const { account, rrn, ...rest } = p;
    return { ...rest, status, problems, existingName, accountLast4: account.slice(-4), hasRrn: validRrn(rrn), foreigner: /^\d{6}[5-8]/.test(rrn), person: p };
  });
  // 같은 사람이 두 줄이면 출근 기록은 먼저 나온 줄에 합친다.
  const wages = people.flatMap((p) => p.days.map((d) => d.amount)).filter((a): a is number => a !== null);
  const counts = new Map<number, number>(); wages.forEach((a) => counts.set(a, (counts.get(a) ?? 0) + 1));
  const defaultWage = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const days = rows.filter((r) => r.status === "ready" || r.status === "existing").flatMap((r) => r.days);
  const summary = {
    people: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    existing: rows.filter((r) => r.status === "existing").length,
    incomplete: rows.filter((r) => r.status === "incomplete").length,
    samePerson: rows.filter((r) => r.status === "same_person").length,
    phoneConflict: rows.filter((r) => r.status === "phone_conflict").length,
    records: days.length,
    amount: days.reduce((s, d) => s + amountFor(d, defaultWage), 0),
    defaultWage,
  };
  return { rows, summary };
}

/** 금액이 빈 날: 퇴근까지 적혀 있으면 기본 일당, 조퇴처럼 퇴근 시각도 없으면 0원으로 두고 관리자가 입력한다. */
export const amountFor = (d: BookDay, base: number) => d.amount ?? (d.clockOut ? base : 0);

const kstTime = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`);

/** 등록 대상만 근무자로 만들고 출근 기록과 금액을 넣는다. 한 트랜잭션이라 중간에 실패하면 전부 취소된다. */
export async function commitAttendanceBook(sql: Sql, input: { people: BookPerson[]; sheet: string; adminId: string; records?: boolean }) {
  const { rows, summary } = await analyseAttendanceBook(sql, input.people);
  return tx(sql, async (t) => {
    let workers = 0, records = 0, skippedRecords = 0;
    const openShifts: string[] = [];
    // 같은 사람의 두 번째 줄에 있던 출근 기록은 첫 줄로 옮긴다.
    const extraDays = new Map<string, BookDay[]>();
    for (const r of rows.filter((x) => x.status === "same_person")) {
      const first = rows.find((x) => x.person.rrn === r.person.rrn && (x.status === "ready" || x.status === "existing"));
      if (first) extraDays.set(first.person.phone, [...(extraDays.get(first.person.phone) ?? []), ...r.days]);
    }
    for (const r of rows.filter((x) => x.status === "ready" || x.status === "existing")) {
      const p = r.person;
      let workerId: string, baseWage: number;
      if (r.status === "ready") {
        const own = p.days.map((d) => d.amount).find((a) => a !== null);
        const created = await createWorker(t, workerInputSchema.parse({
          name: p.name, phone: p.phone, baseDailyWage: own ?? summary.defaultWage, bankName: p.bank, accountNumber: p.account,
          accountHolder: p.holder, rrn: p.rrn, address: p.address, memo: `${input.sheet} ${p.row}행에서 가져옴`,
        }), input.adminId, { allowDuplicate: true });
        workerId = created.id; baseWage = own ?? summary.defaultWage; workers++;
      } else {
        const [w] = await t<{ id: string; base_daily_wage: number }[]>`SELECT id, base_daily_wage FROM workers WHERE phone = ${p.phone}`;
        workerId = w.id; baseWage = w.base_daily_wage;
      }
      const seen = new Set<string>();
      // records: false면 근무자 정보만 넣고 출근 기록은 건너뛴다.
      for (const d of input.records === false ? [] : [...p.days, ...(extraDays.get(p.phone) ?? [])]) {
        if (seen.has(d.date)) { skippedRecords++; continue; }
        seen.add(d.date);
        const [dup] = await t`SELECT 1 FROM work_records WHERE worker_id = ${workerId} AND work_date = ${d.date} AND deleted_at IS NULL`;
        if (dup) { skippedRecords++; continue; }
        const clockIn = d.clockIn ? kstTime(d.date, d.clockIn) : null;
        let clockOut = d.clockOut ? kstTime(d.date, d.clockOut) : null;
        if (clockIn && clockOut && clockOut <= clockIn) clockOut = new Date(clockOut.getTime() + 86_400_000); // 자정 넘김
        // 퇴근 시각이 없는 기록이 이미 있으면 같은 근무자에게 또 만들 수 없다(고유 인덱스).
        const leaveOpen = clockIn && !clockOut;
        if (leaveOpen) {
          const [open] = await t`SELECT 1 FROM work_records WHERE worker_id = ${workerId} AND clock_in_at IS NOT NULL AND clock_out_at IS NULL AND deleted_at IS NULL`;
          if (open) { skippedRecords++; continue; }
          openShifts.push(`${p.name} ${d.date}`);
        }
        const note = [d.note, `${input.sheet}에서 가져옴`].filter(Boolean).join(" · ");
        const [rec] = await t<{ id: string }[]>`
          INSERT INTO work_records (worker_id, work_date, clock_in_at, clock_out_at, source, note, created_by)
          VALUES (${workerId}, ${d.date}, ${clockIn}, ${clockOut}, 'manual', ${note}, ${input.adminId}) RETURNING id`;
        const amount = amountFor(d, baseWage);
        const wageNote = d.amount !== null ? "" : d.clockOut ? "금액 미기재, 기본 일당 적용" : "금액·퇴근 미기재, 확인 후 입력";
        await t`INSERT INTO daily_wages (work_record_id, base_wage, actual_wage, note) VALUES (${rec.id}, ${baseWage}, ${amount}, ${wageNote})`;
        records++;
      }
    }
    await audit(t, {
      administratorId: input.adminId, action: "excel.import.attendance_book", targetType: "excel", targetId: input.sheet,
      after: { workers, records, skippedRecords, excluded: summary.incomplete + summary.samePerson + summary.phoneConflict },
    });
    return { workers, records, skippedRecords, openShifts };
  });
}
