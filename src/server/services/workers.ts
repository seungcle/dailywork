import { z } from "zod";
import type { Sql } from "../db";
import { tx } from "../db";
import { blindIndex, decryptField, encryptField } from "../crypto";
import { badRequest, conflict, notFound, pgCode } from "../errors";
import { audit } from "../audit";
import { normalizePhone } from "@/lib/format";

const money = z.number().int().min(0).max(100_000_000);

export const workerInputSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요.").max(50),
  // 키오스크에서 이 번호로 본인을 찾으므로 필수이고 010 휴대폰 번호만 받는다.
  phone: z.string().nullish().transform((v) => normalizePhone(v) ?? "").refine((v) => /^010[0-9]{8}$/.test(v), "휴대폰 번호는 010으로 시작하는 11자리로 입력해 주세요."),
  baseDailyWage: money.default(0),
  bankName: z.string().trim().max(30).nullish(),
  accountNumber: z.string().nullish().transform((v) => (v ? v.replace(/[^0-9]/g, "") : null)).refine((v) => v === null || /^[0-9]{6,20}$/.test(v), "계좌번호 형식이 올바르지 않습니다."),
  accountHolder: z.string().trim().max(50).nullish(),
  rrn: z.string().nullish().transform((v) => (v ? v.replace(/[^0-9]/g, "") : null)).refine((v) => v === null || /^[0-9]{13}$/.test(v), "주민등록번호는 13자리여야 합니다."),
  address: z.string().trim().max(200, "주소는 200자 이내로 입력해 주세요.").default(""),
  memo: z.string().max(1000).default(""),
});
export type WorkerInput = z.output<typeof workerInputSchema>;

export type WorkerListRow = {
  id: string; worker_number: number; name: string; phone: string | null; base_daily_wage: number; is_active: boolean;
  address: string; memo: string; created_at: Date; last_work_date: string | null; bank_name: string | null; account_last4: string | null; account_holder: string | null;
};

const SORTS: Record<string, string> = {
  worker_number: "w.worker_number", name: "w.name", created_at: "w.created_at",
  base_daily_wage: "w.base_daily_wage", last_work_date: "last_work_date",
};

export async function listWorkers(sql: Sql, opts: { q?: string; status?: "active" | "inactive" | "all"; sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number } = {}) {
  const q = opts.q?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const status = opts.status ?? "active";
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(opts.pageSize ?? 30, 100);
  const sortCol = SORTS[opts.sort ?? ""] ?? "w.worker_number";
  const dir = opts.dir === "desc" ? "DESC" : "ASC";
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const where = sql`
    (${q === ""} OR w.name ILIKE ${like}
      OR (${digits !== ""} AND w.phone LIKE ${"%" + digits + "%"}))
    AND (${status === "all"} OR w.is_active = ${status === "active"})`;
  const rows = await sql<WorkerListRow[]>`
    SELECT w.id, w.worker_number, w.name, w.phone, w.base_daily_wage, w.is_active, w.address, w.memo, w.created_at,
      (SELECT max(r.work_date)::text FROM work_records r WHERE r.worker_id = w.id AND r.deleted_at IS NULL) AS last_work_date,
      a.bank_name, a.account_last4, a.account_holder
    FROM workers w LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current
    WHERE ${where}
    ORDER BY ${sql.unsafe(`${sortCol} ${dir} NULLS LAST`)}, w.worker_number
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM workers w WHERE ${where}`;
  return { rows, total: count, page, pageSize };
}

export type DuplicateCandidate = {
  id: string; worker_number: number; name: string; phone: string | null; is_active: boolean; reasons: string[]; strong: boolean;
};

/** 중복 근무자 후보. 전화번호·계좌·주민번호 일치는 강한 일치, 이름만 같으면 약한 일치다. */
export async function findDuplicates(sql: Sql, input: { name?: string | null; phone?: string | null; accountNumber?: string | null; rrn?: string | null; excludeId?: string }) {
  const accountHash = input.accountNumber ? blindIndex(input.accountNumber) : null;
  const rrnHash = input.rrn ? blindIndex(input.rrn) : null;
  const rows = await sql<{ id: string; worker_number: number; name: string; phone: string | null; is_active: boolean; same_name: boolean; same_phone: boolean; same_account: boolean; same_rrn: boolean }[]>`
    SELECT w.id, w.worker_number, w.name, w.phone, w.is_active,
      COALESCE(w.name = ${input.name ?? null}, false) AS same_name,
      COALESCE(w.phone = ${input.phone ?? null}, false) AS same_phone,
      COALESCE(a.account_number_hash = ${accountHash}, false) AS same_account,
      COALESCE(w.rrn_hash = ${rrnHash}, false) AS same_rrn
    FROM workers w LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current
    WHERE (w.name = ${input.name ?? null} OR w.phone = ${input.phone ?? null} OR a.account_number_hash = ${accountHash} OR w.rrn_hash = ${rrnHash})
      AND (${input.excludeId == null} OR w.id <> ${input.excludeId ?? "00000000-0000-0000-0000-000000000000"}::uuid)
    ORDER BY w.worker_number LIMIT 20`;
  return rows.map((r): DuplicateCandidate => {
    const reasons = [r.same_rrn && "주민등록번호 일치", r.same_phone && "전화번호 일치", r.same_account && "계좌번호 일치", r.same_name && "이름 일치"].filter(Boolean) as string[];
    return { id: r.id, worker_number: r.worker_number, name: r.name, phone: r.phone, is_active: r.is_active, reasons, strong: r.same_rrn || r.same_phone || r.same_account };
  });
}

const phoneTaken = () => conflict("PHONE_TAKEN", "이미 다른 근무자가 쓰는 휴대폰 번호입니다.");

/** 번호가 겹치면 키오스크에서 사람을 구분할 수 없으므로 '그래도 등록'도 허용하지 않는다. */
async function assertPhoneFree(t: Sql, phone: string, excludeId?: string) {
  const [dup] = await t`SELECT 1 FROM workers WHERE phone = ${phone} AND (${excludeId == null} OR id <> ${excludeId ?? "00000000-0000-0000-0000-000000000000"}::uuid)`;
  if (dup) throw phoneTaken();
}
/** 동시 저장으로 위 확인을 지나쳐 고유 인덱스에 걸린 경우에도 같은 안내를 준다. */
async function mapPhoneConflict<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (pgCode(e) === "23505" && (e as { constraint_name?: string }).constraint_name === "workers_phone_key") throw phoneTaken();
    throw e;
  }
}

function assertAccountComplete(i: WorkerInput) {
  const filled = [i.bankName, i.accountNumber, i.accountHolder].filter(Boolean).length;
  if (filled > 0 && filled < 3) throw badRequest("은행명, 계좌번호, 예금주를 모두 입력해 주세요.");
}
function rrnColumns(i: WorkerInput) {
  return i.rrn ? { enc: encryptField(i.rrn), hash: blindIndex(i.rrn) } : null;
}
async function replaceAccount(t: Sql, workerId: string, i: WorkerInput) {
  await t`UPDATE worker_payment_accounts SET is_current = false, replaced_at = clock_timestamp() WHERE worker_id = ${workerId} AND is_current`;
  await t`INSERT INTO worker_payment_accounts (worker_id, bank_name, account_number_enc, account_number_hash, account_last4, account_holder)
          VALUES (${workerId}, ${i.bankName!}, ${encryptField(i.accountNumber!)}, ${blindIndex(i.accountNumber!)}, ${i.accountNumber!.slice(-4)}, ${i.accountHolder!})`;
}

export async function createWorker(sql: Sql, input: WorkerInput, adminId: string, opts: { allowDuplicate?: boolean } = {}) {
  assertAccountComplete(input);
  const rrn = rrnColumns(input);
  return mapPhoneConflict(() => tx(sql, async (t) => {
    await assertPhoneFree(t, input.phone);
    if (!opts.allowDuplicate) {
      const dups = (await findDuplicates(t, input)).filter((d) => d.strong);
      // 동시 저장으로 방금 같은 번호가 들어온 경우에도 번호 중복으로 안내한다.
      if (dups.some((d) => d.phone === input.phone)) throw phoneTaken();
      if (dups.length) throw conflict("DUPLICATE_WORKER", "이미 등록된 근무자와 정보가 겹칩니다.", { candidates: dups });
    }
    const [w] = await t<{ id: string; worker_number: number }[]>`
      INSERT INTO workers (name, phone, base_daily_wage, rrn_enc, rrn_hash, address, memo, created_by)
      VALUES (${input.name}, ${input.phone}, ${input.baseDailyWage}, ${rrn?.enc ?? null}, ${rrn?.hash ?? null}, ${input.address}, ${input.memo}, ${adminId})
      RETURNING id, worker_number`;
    if (input.accountNumber) await replaceAccount(t, w.id, input);
    await audit(t, {
      administratorId: adminId, action: "worker.create", targetType: "worker", targetId: w.id,
      after: { worker_number: w.worker_number, name: input.name, base_daily_wage: input.baseDailyWage, has_account: !!input.accountNumber, has_rrn: !!rrn },
    });
    return w;
  }));
}

export async function getWorker(sql: Sql, id: string) {
  const [w] = await sql<(WorkerListRow & { has_rrn: boolean; rrn_enc: string | null })[]>`
    SELECT w.id, w.worker_number, w.name, w.phone, w.base_daily_wage, w.is_active, w.address, w.memo, w.created_at,
      (w.rrn_enc IS NOT NULL) AS has_rrn, w.rrn_enc,
      (SELECT max(r.work_date)::text FROM work_records r WHERE r.worker_id = w.id AND r.deleted_at IS NULL) AS last_work_date,
      a.bank_name, a.account_last4, a.account_holder
    FROM workers w LEFT JOIN worker_payment_accounts a ON a.worker_id = w.id AND a.is_current
    WHERE w.id = ${id}`;
  if (!w) throw notFound("근무자를 찾을 수 없습니다.");
  // 주민등록번호는 저장할 때만 암호화하고, 관리자 화면에는 그대로 보여 준다.
  const { rrn_enc, ...rest } = w;
  return { ...rest, rrn: rrn_enc ? decryptField(rrn_enc) : null };
}

/**
 * 근무자 수정. 계좌번호나 주민번호를 비워 보내면 기존 값을 유지한다
 * (화면에 원문을 내려 주지 않으므로 빈 값은 '변경 없음'을 뜻한다).
 */
export async function updateWorker(sql: Sql, id: string, input: WorkerInput, adminId: string) {
  const rrn = rrnColumns(input);
  return mapPhoneConflict(() => tx(sql, async (t) => {
    const before = await getWorker(t, id);
    await t`SELECT 1 FROM workers WHERE id = ${id} FOR UPDATE`;
    await assertPhoneFree(t, input.phone, id);
    const accountChanging = !!input.accountNumber;
    if (accountChanging) assertAccountComplete(input);
    else if (input.bankName || input.accountHolder) {
      if (!before.account_last4) throw badRequest("은행명, 계좌번호, 예금주를 모두 입력해 주세요.");
      if (!input.bankName || !input.accountHolder) throw badRequest("은행명과 예금주를 모두 입력해 주세요.");
    }
    await t`UPDATE workers SET name = ${input.name}, phone = ${input.phone}, base_daily_wage = ${input.baseDailyWage}, address = ${input.address}, memo = ${input.memo},
              rrn_enc = COALESCE(${rrn?.enc ?? null}, rrn_enc), rrn_hash = COALESCE(${rrn?.hash ?? null}, rrn_hash)
            WHERE id = ${id}`;
    if (accountChanging) await replaceAccount(t, id, input);
    else if (input.bankName && input.accountHolder) {
      await t`UPDATE worker_payment_accounts SET bank_name = ${input.bankName}, account_holder = ${input.accountHolder} WHERE worker_id = ${id} AND is_current`;
    }
    await audit(t, {
      administratorId: adminId, action: "worker.update", targetType: "worker", targetId: id,
      before: { name: before.name, phone: before.phone, base_daily_wage: before.base_daily_wage, address: before.address, account_last4: before.account_last4 },
      after: { name: input.name, phone: input.phone, base_daily_wage: input.baseDailyWage, address: input.address, account_changed: accountChanging, rrn_changed: !!rrn },
    });
  }));
}

export async function setWorkerActive(sql: Sql, id: string, active: boolean, adminId: string) {
  return tx(sql, async (t) => {
    const [w] = await t`UPDATE workers SET is_active = ${active}, deactivated_at = ${active ? null : new Date()} WHERE id = ${id} RETURNING id`;
    if (!w) throw notFound("근무자를 찾을 수 없습니다.");
    await audit(t, { administratorId: adminId, action: active ? "worker.activate" : "worker.deactivate", targetType: "worker", targetId: id });
  });
}

/**
 * 근무자 삭제. 출근 기록이나 키오스크 이력이 하나라도 있으면 기록 보존을 위해 삭제하지 않고 비활성화를 안내한다.
 */
export async function deleteWorker(sql: Sql, id: string, adminId: string) {
  return tx(sql, async (t) => {
    const [w] = await t<{ id: string; name: string; phone: string }[]>`SELECT id, name, phone FROM workers WHERE id = ${id} FOR UPDATE`;
    if (!w) throw notFound("근무자를 찾을 수 없습니다.");
    const [used] = await t`SELECT 1 FROM work_records WHERE worker_id = ${id} UNION ALL SELECT 1 FROM attendance_events WHERE worker_id = ${id} LIMIT 1`;
    if (used) throw conflict("WORKER_HAS_RECORDS", "출근 기록이 있는 근무자는 삭제할 수 없습니다. 대신 비활성화해 주세요.");
    await t`DELETE FROM worker_payment_accounts WHERE worker_id = ${id}`;
    await t`DELETE FROM workers WHERE id = ${id}`;
    await audit(t, { administratorId: adminId, action: "worker.delete", targetType: "worker", targetId: id, before: { name: w.name, phone: w.phone } });
  });
}

/** 계좌번호·주민번호 원문 조회. 조회할 때마다 이력을 남긴다. */
export async function revealSensitive(sql: Sql, id: string, field: "account" | "rrn", adminId: string) {
  let value: string | null = null;
  if (field === "account") {
    const [a] = await sql<{ account_number_enc: string }[]>`SELECT account_number_enc FROM worker_payment_accounts WHERE worker_id = ${id} AND is_current`;
    value = a ? decryptField(a.account_number_enc) : null;
  } else {
    const [w] = await sql<{ rrn_enc: string | null }[]>`SELECT rrn_enc FROM workers WHERE id = ${id}`;
    value = w?.rrn_enc ? decryptField(w.rrn_enc) : null;
  }
  if (value === null) throw notFound("저장된 정보가 없습니다.");
  await audit(sql, { administratorId: adminId, action: `worker.reveal_${field}`, targetType: "worker", targetId: id });
  return value;
}

export async function workerHistory(sql: Sql, id: string, limit = 100) {
  const rows = await sql`
    SELECT r.id AS record_id, r.work_date::text AS work_date, r.clock_in_at, r.clock_out_at, r.source,
      dw.actual_wage, dw.extra_pay, dw.final_wage, dw.status
    FROM work_records r JOIN daily_wages dw ON dw.work_record_id = r.id
    WHERE r.worker_id = ${id} AND r.deleted_at IS NULL ORDER BY r.work_date DESC LIMIT ${limit}`;
  const [totals] = await sql<{ work_days: number; total_wage: number; confirmed_wage: number }[]>`
    SELECT count(*)::int AS work_days, COALESCE(sum(dw.final_wage), 0)::float8 AS total_wage,
      COALESCE(sum(dw.final_wage) FILTER (WHERE dw.status = 'confirmed'), 0)::float8 AS confirmed_wage
    FROM work_records r JOIN daily_wages dw ON dw.work_record_id = r.id
    WHERE r.worker_id = ${id} AND r.deleted_at IS NULL`;
  return { rows, totals };
}
