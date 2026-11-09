// 6월 출석부를 기준으로 근무자·출근 기록을 DB에 직접 넣고, 10월 출근부에서 계좌가 바뀐 사람은 10월 계좌로 맞춘다.
//
//   npx tsx --env-file=.env.local scripts/load-attendance-book.ts --june <6월.xlsx> --october <10월.xlsx>           # 확인만
//   npx tsx --env-file=.env.local scripts/load-attendance-book.ts --june <6월.xlsx> --october <10월.xlsx> --apply   # 적재
//   --workers-only: 근무자 정보만 넣고 출근 기록은 넣지 않는다.
//
// 로컬이 아닌 DB에는 --allow-remote 없이 쓰지 않는다. 화면에는 계좌 뒤 4자리만 출력한다.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { createSql } from "@/server/db";
import { blindIndex } from "@/server/crypto";
import { env } from "@/server/env";
import { analyseAttendanceBook, baseName, commitAttendanceBook, normalizeBank, readAttendanceBook, type BookPerson } from "@/server/services/attendanceBook";
import { getWorker, updateWorker, workerInputSchema } from "@/server/services/workers";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(k);
const last4 = (bank: string, a: string) => `${bank} ••••${a.slice(-4)}`;

type OctPerson = { row: number; name: string; rrn: string; bank: string; account: string };

/** 10월 출근부: A열 이름, B열 주민번호, 은행·계좌는 은행 이름이 많이 나오는 열과 그 오른쪽 열. */
async function readOctober(file: string): Promise<OctPerson[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(file) as never);
  const ws = wb.worksheets[0];
  const val = (v: ExcelJS.CellValue): string => {
    const x = v && typeof v === "object" && !(v instanceof Date) ? ("result" in v ? v.result : "richText" in v ? v.richText.map((t) => t.text).join("") : null) : v;
    return x == null ? "" : String(x).trim();
  };
  const isBank = (s: string) => /^(농협|농혀|국민|신한|우리|하나|기업|우체국|카카오|토스|신협|수협|새마을금고|SC|sc|케이뱅크)/.test(s);
  let bankCol = 0;
  for (let c = 3; c <= 40 && !bankCol; c++) {
    let n = 0;
    for (let r = 2; r <= 60; r++) if (isBank(val(ws.getRow(r).getCell(c).value))) n++;
    if (n >= 10) bankCol = c;
  }
  if (!bankCol) throw new Error("10월 출근부에서 은행 열을 찾지 못했습니다.");
  const out: OctPerson[] = [];
  for (let r = 2; r <= ws.actualRowCount + 5; r++) {
    const row = ws.getRow(r);
    const name = val(row.getCell(1).value);
    if (!name || /합계|인력|시간|^\d+분$/.test(name)) continue;
    out.push({
      row: r, name, rrn: val(row.getCell(2).value).replace(/\D/g, ""),
      bank: normalizeBank(val(row.getCell(bankCol).value)), account: val(row.getCell(bankCol + 1).value).replace(/\D/g, ""),
    });
  }
  return out;
}

async function main() {
  const juneFile = arg("--june"), octFile = arg("--october");
  if (!juneFile || !octFile) throw new Error("--june <파일> --october <파일>을 지정해 주세요.");
  // 운영에서는 트랜잭션 풀러 대신 마이그레이션용 연결을 쓴다.
  const url = process.env.MIGRATION_DATABASE_URL || env.databaseUrl;
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  if (flag("--apply") && !local && !flag("--allow-remote")) throw new Error("로컬이 아닌 DB에 쓰려면 --allow-remote를 붙여 주세요.");

  const june = await readAttendanceBook(readFileSync(juneFile));
  const october = await readOctober(octFile);

  // 같은 사람은 주민번호로 맞춘다. 10월에 계좌가 있고 6월과 다르면 10월 계좌가 맞다(계좌를 바꾼 것).
  const octByRrn = new Map(october.filter((o) => o.rrn.length === 13).map((o) => [o.rrn, o]));
  const changes: { person: BookPerson; from: string; to: string }[] = [];
  const people = june.people.map((p) => {
    const o = p.rrn.length === 13 ? octByRrn.get(p.rrn) : undefined;
    if (!o || !o.account || !o.bank || (o.account === p.account && o.bank === p.bank)) return p;
    changes.push({ person: p, from: last4(p.bank, p.account), to: last4(o.bank, o.account) });
    return { ...p, bank: o.bank, account: o.account };
  });
  // 주민번호가 없는 10월 사람은 이름으로만 맞출 수 있어 자동으로 바꾸지 않고 알려만 준다.
  const nameOnly = october.filter((o) => o.rrn.length !== 13).map((o) => {
    const cands = june.people.filter((p) => baseName(p.name) === baseName(o.name));
    const c = cands.length === 1 ? cands[0] : undefined;
    const note = !c ? `6월에 같은 이름 ${cands.length}명` : !o.account ? "10월 계좌 없음" : c.account === o.account ? "계좌 같음" : `계좌 다름 ${last4(c.bank, c.account)} → ${last4(o.bank, o.account)}`;
    return `10월 ${o.row}행 ${o.name} — ${c ? `6월 ${c.row}행 ${c.name}, ` : ""}${note}`;
  });
  const octOnly = october.filter((o) => o.rrn.length === 13 && !june.people.some((p) => p.rrn === o.rrn));

  const sql = createSql(url);
  try {
    const { rows, summary } = await analyseAttendanceBook(sql, people);
    console.log(`DB: ${local ? "로컬" : "원격"} · 6월 시트 "${june.sheet}"`);
    console.log(`6월 명단 ${summary.people}명 → 등록 대상 ${summary.ready}명, 이미 DB에 있음 ${summary.existing}명, 제외 ${summary.incomplete + summary.samePerson + summary.phoneConflict}명`);
    console.log(`출근 기록 ${summary.records}건 · 금액 합계 ${summary.amount.toLocaleString()}원${flag("--workers-only") ? " (이번에는 넣지 않음)" : ""}`);
    console.log(`\n10월 계좌로 바꾸는 사람 ${changes.length}명 (주민번호로 확인)`);
    changes.forEach((c) => console.log(`  ${c.person.row}행 ${c.person.name}: ${c.from} → ${c.to}`));
    console.log(`\n주민번호가 없거나 형식이 맞지 않아 넣지 않는 사람`);
    rows.filter((r) => r.problems.some((x) => x.startsWith("주민번호"))).forEach((r) => console.log(`  ${r.row}행 ${r.name}: ${r.problems.join(", ")}`));
    console.log(`\n그 밖의 이유로 제외`);
    rows.filter((r) => !["ready", "existing"].includes(r.status) && !r.problems.some((x) => x.startsWith("주민번호"))).forEach((r) => console.log(`  ${r.row}행 ${r.name}: ${r.problems.join(", ")}`));
    console.log(`\n10월에만 있는 사람(주민번호 기준, 6월 기준이라 넣지 않음) ${octOnly.length}명: ${octOnly.map((o) => o.name).join(", ") || "-"}`);
    console.log(`\n10월에 주민번호가 없어 이름으로만 맞출 수 있는 사람 ${nameOnly.length}명 (자동으로 바꾸지 않음)`);
    nameOnly.forEach((l) => console.log(`  ${l}`));

    if (!flag("--apply")) { console.log("\n확인만 했습니다. 넣으려면 --apply를 붙여 주세요."); return; }

    const [admin] = await sql<{ id: string }[]>`SELECT id FROM administrators WHERE is_active ORDER BY created_at LIMIT 1`;
    if (!admin) throw new Error("활성 관리자가 없습니다.");
    const result = await commitAttendanceBook(sql, { people, sheet: june.sheet, adminId: admin.id, records: !flag("--workers-only") });
    // 이미 DB에 있던 사람은 계좌가 다르면 최종 계좌(10월 우선)로 바꾸고, 비어 있는 주소는 채운다. 이전 계좌는 이력으로 남는다.
    let accountsUpdated = 0, addressesFilled = 0;
    for (const p of people.filter((x) => rows.some((r) => r.person === x && (r.status === "ready" || r.status === "existing")))) {
      const [w] = await sql<{ id: string; address: string; bank_name: string | null; account_number_hash: string | null }[]>`
        SELECT w.id, w.address, a.bank_name, a.account_number_hash FROM workers w LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current WHERE w.phone = ${p.phone}`;
      if (!w) continue;
      if (!w.address && p.address) {
        await sql`UPDATE workers SET address = ${p.address} WHERE id = ${w.id}`;
        addressesFilled++;
      }
      if (w.account_number_hash === blindIndex(p.account) && w.bank_name === p.bank) continue;
      const cur = await getWorker(sql, w.id);
      await updateWorker(sql, w.id, workerInputSchema.parse({
        name: cur.name, phone: cur.phone, baseDailyWage: cur.base_daily_wage, address: cur.address || p.address, memo: cur.memo,
        bankName: p.bank, accountNumber: p.account, accountHolder: cur.account_holder ?? p.holder,
      }), admin.id);
      accountsUpdated++;
    }
    console.log(`\n적재 완료: 근무자 ${result.workers}명 등록, 출근 기록 ${result.records}건, 기존 근무자 계좌 변경 ${accountsUpdated}명, 주소 채움 ${addressesFilled}명, 건너뛴 기록 ${result.skippedRecords}건`);
    if (result.openShifts.length) console.log(`퇴근 시각이 없어 0원으로 넣은 기록: ${result.openShifts.join(", ")}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
