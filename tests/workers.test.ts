import { beforeEach, describe, expect, it } from "vitest";
import { createWorker, findDuplicates, getWorker, listWorkers, revealSensitive, updateWorker, workerHistory, workerInputSchema } from "@/server/services/workers";
import { addManualRecords } from "@/server/services/attendance";
import { resetDb, seedAdmin, seedWorker, sql } from "./helpers";

let adminId: string;
beforeEach(async () => { await resetDb(); adminId = (await seedAdmin()).id; });
const input = (o: Record<string, unknown>) => workerInputSchema.parse({ phone: "01012349999", ...o });

describe("근무자 내부 번호", () => {
  it("동시에 등록해도 번호가 겹치지 않는다", async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => createWorker(sql, input({ name: `동시${i}`, phone: `0108888${String(i).padStart(4, "0")}` }), adminId)));
    expect(new Set(rs.map((r) => r.worker_number)).size).toBe(20);
  });
  it("발급 후 바꿀 수 없다", async () => {
    const w = await seedWorker(adminId);
    await expect(sql`UPDATE workers SET worker_number = 1 WHERE id = ${w.id}`).rejects.toMatchObject({ code: "DW002" });
  });
});

describe("민감정보 보호", () => {
  const acct = { bankName: "국민은행", accountNumber: "123-456-789012", accountHolder: "김갑" };

  it("계좌번호·주민번호를 암호화해 저장하고 목록에는 뒤 4자리만 내려 준다", async () => {
    const w = await createWorker(sql, input({ name: "김갑", rrn: "900101-1234567", ...acct }), adminId);
    const [a] = await sql<{ account_number_enc: string }[]>`SELECT account_number_enc FROM worker_payment_accounts WHERE worker_id = ${w.id}`;
    const [r] = await sql<{ rrn_enc: string }[]>`SELECT rrn_enc FROM workers WHERE id = ${w.id}`;
    expect(a.account_number_enc).not.toContain("123456789012");
    expect(r.rrn_enc).not.toContain("9001011234567");
    const list = JSON.stringify((await listWorkers(sql, { status: "all" })).rows);
    expect(list).not.toContain("123456789012");
    expect(list).toContain("9012");
  });

  it("원문 조회는 이력을 남기고, 이력에는 원문이 없다", async () => {
    const w = await createWorker(sql, input({ name: "김갑", ...acct }), adminId);
    expect(await revealSensitive(sql, w.id, "account", adminId)).toBe("123456789012");
    const logs = await sql`SELECT action, before, after FROM audit_logs WHERE target_id = ${w.id}`;
    expect(logs.map((l) => l.action)).toContain("worker.reveal_account");
    expect(JSON.stringify(logs)).not.toContain("123456789012");
  });

  it("같은 값도 암호문은 매번 달라진다", async () => {
    const a = await createWorker(sql, input({ name: "가", phone: "01012341111", ...acct }), adminId, { allowDuplicate: true });
    const b = await createWorker(sql, input({ name: "나", phone: "01012342222", ...acct }), adminId, { allowDuplicate: true });
    const rows = await sql<{ account_number_enc: string; account_number_hash: string }[]>`SELECT account_number_enc, account_number_hash FROM worker_payment_accounts WHERE worker_id IN (${a.id}, ${b.id})`;
    expect(rows[0].account_number_enc).not.toBe(rows[1].account_number_enc);
    expect(rows[0].account_number_hash).toBe(rows[1].account_number_hash);
  });

  it("계좌를 바꾸면 이전 계좌는 이력으로 남고 현재 계좌는 하나다", async () => {
    const w = await createWorker(sql, input({ name: "김갑", ...acct }), adminId);
    await updateWorker(sql, w.id, input({ name: "김갑", bankName: "신한은행", accountNumber: "999-999-999999", accountHolder: "김갑" }), adminId);
    const rows = await sql<{ is_current: boolean }[]>`SELECT is_current FROM worker_payment_accounts WHERE worker_id = ${w.id}`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_current)).toHaveLength(1);
    expect(await revealSensitive(sql, w.id, "account", adminId)).toBe("999999999999");
  });

  it("수정 시 계좌번호를 비우면 기존 계좌를 유지한다", async () => {
    const w = await createWorker(sql, input({ name: "김갑", ...acct }), adminId);
    await updateWorker(sql, w.id, input({ name: "김갑수" }), adminId);
    expect(await revealSensitive(sql, w.id, "account", adminId)).toBe("123456789012");
    expect((await getWorker(sql, w.id)).name).toBe("김갑수");
  });

  it("계좌 정보 일부만 입력하면 거절한다", async () => {
    await expect(createWorker(sql, input({ name: "김갑", bankName: "국민은행" }), adminId)).rejects.toThrow("모두 입력");
  });
});

describe("중복 감지와 검색", () => {
  it("같은 휴대폰 번호는 확인을 거쳐도 등록할 수 없다", async () => {
    const w = await createWorker(sql, input({ name: "김갑", phone: "010-1234-5678" }), adminId);
    await expect(createWorker(sql, input({ name: "다른이름", phone: "01012345678" }), adminId)).rejects.toMatchObject({ code: "PHONE_TAKEN" });
    await expect(createWorker(sql, input({ name: "다른이름", phone: "01012345678" }), adminId, { allowDuplicate: true })).rejects.toMatchObject({ code: "PHONE_TAKEN" });
    const other = await createWorker(sql, input({ name: "이을", phone: "01012340000" }), adminId);
    await expect(updateWorker(sql, other.id, input({ name: "이을", phone: "01012345678" }), adminId)).rejects.toMatchObject({ code: "PHONE_TAKEN" });
    // 자기 번호를 그대로 저장하는 것은 문제없다.
    await expect(updateWorker(sql, w.id, input({ name: "김갑갑", phone: "01012345678" }), adminId)).resolves.toBeUndefined();
  });

  it("동시에 같은 번호로 등록해도 한 명만 들어간다", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createWorker(sql, input({ name: `동시${i}`, phone: "01012345678" }), adminId)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "PHONE_TAKEN" });
  });

  it("휴대폰 번호는 필수이고 010 번호만 받는다", () => {
    for (const phone of [null, "", "02-123-4567", "011-123-4567", "010-1234"]) {
      expect(workerInputSchema.safeParse({ name: "김갑", phone }).success).toBe(false);
    }
    expect(input({ name: "김갑", phone: "010-1234-5678" }).phone).toBe("01012345678");
  });

  it("같은 계좌는 등록을 막고, 확인 후 등록할 수 있다", async () => {
    const acct = { bankName: "국민", accountNumber: "123456789012", accountHolder: "김갑" };
    await createWorker(sql, input({ name: "김갑", phone: "01012345678", ...acct }), adminId);
    await expect(createWorker(sql, input({ name: "이을", phone: "01012340000", ...acct }), adminId)).rejects.toMatchObject({ code: "DUPLICATE_WORKER" });
    await expect(createWorker(sql, input({ name: "이을", phone: "01012340000", ...acct }), adminId, { allowDuplicate: true })).resolves.toBeTruthy();
  });

  it("이름만 같으면 약한 후보로 알려 주고 등록은 허용한다", async () => {
    await createWorker(sql, input({ name: "김갑", phone: "01011112222" }), adminId);
    const d = await findDuplicates(sql, { name: "김갑", phone: "01033334444" });
    expect(d).toHaveLength(1);
    expect(d[0].strong).toBe(false);
    await expect(createWorker(sql, input({ name: "김갑", phone: "01033334444" }), adminId)).resolves.toBeTruthy();
  });

  it("이름·휴대폰 번호로 검색하고 특수문자는 일반 문자로 처리한다", async () => {
    const w = await createWorker(sql, input({ name: "홍길동", phone: "01055556666", baseDailyWage: 100 }), adminId);
    await createWorker(sql, input({ name: "이순신", phone: "01077778888" }), adminId);
    expect((await listWorkers(sql, { q: "길동" })).rows.map((r) => r.id)).toEqual([w.id]);
    expect((await listWorkers(sql, { q: "5556" })).rows.map((r) => r.id)).toEqual([w.id]);
    expect((await listWorkers(sql, { q: "%" })).rows).toHaveLength(0);
  });

  it("허용되지 않은 정렬 값은 무시한다", async () => {
    await seedWorker(adminId);
    await expect(listWorkers(sql, { sort: "name; DROP TABLE workers" })).resolves.toBeTruthy();
    expect(await sql`SELECT 1 FROM workers`).not.toHaveLength(0);
  });
});

describe("근무 이력", () => {
  it("근무자별 근무일과 누적 일당을 집계하고 최근 근무일을 알려 준다", async () => {
    const w = await seedWorker(adminId, { baseDailyWage: 100000 });
    await addManualRecords(sql, { workerIds: [w.id], workDate: "2026-03-02", adminId });
    await addManualRecords(sql, { workerIds: [w.id], workDate: "2026-03-05", adminId });
    const h = await workerHistory(sql, w.id);
    expect(h.totals.work_days).toBe(2);
    expect(h.totals.total_wage).toBe(200000);
    expect((await getWorker(sql, w.id)).last_work_date).toBe("2026-03-05");
  });
});
