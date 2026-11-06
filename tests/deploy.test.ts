import { beforeEach, describe, expect, it } from "vitest";
import { checkConnectionUrls, checkDatabase, checkEncryptionKey } from "@/server/deployCheck";
import { createWorker, workerInputSchema } from "@/server/services/workers";
import { resetDb, seedAdmin, sql } from "./helpers";

const POOLER = "postgres://postgres.abc:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres";
const levels = (r: { level: string }[]) => r.map((x) => x.level);

describe("Supabase 공개 API 차단", () => {
  const TABLES = ["administrators", "admin_sessions", "workers", "worker_payment_accounts", "kiosk_devices", "kiosk_sessions", "work_records", "daily_wages", "attendance_events", "audit_logs", "app_settings", "rate_limits", "schema_migrations"];

  for (const role of ["anon", "authenticated"]) {
    it(`${role} 역할은 어떤 테이블도 읽거나 쓸 수 없다`, async () => {
      for (const table of TABLES) {
        await expect(sql.begin(async (t) => {
          await t.unsafe(`SET LOCAL ROLE ${role}`);
          await t.unsafe(`SELECT * FROM public.${table} LIMIT 1`);
        }), table).rejects.toMatchObject({ code: "42501" });
      }
    });
  }

  it("앞으로 만드는 테이블에도 자동 권한이 붙지 않는다", async () => {
    await sql`CREATE TABLE public.dw_future_check (id int)`;
    try {
      const [r] = await sql<{ ok: boolean }[]>`SELECT has_table_privilege('anon', 'public.dw_future_check', 'SELECT') AS ok`;
      expect(r.ok).toBe(false);
    } finally {
      await sql`DROP TABLE public.dw_future_check`;
    }
  });
});

describe("배포 전 점검", () => {
  beforeEach(resetDb);

  it("연결 문자열을 구분한다", () => {
    expect(levels(checkConnectionUrls(undefined, undefined))).toEqual(["fail"]);
    expect(levels(checkConnectionUrls("postgres://a:b@127.0.0.1:54329/x", undefined))).toContain("fail");
    expect(levels(checkConnectionUrls(POOLER, undefined))).toEqual(["ok"]);
    expect(levels(checkConnectionUrls(POOLER.replace(":6543", ":5432"), undefined))).toEqual(["warn"]);
    expect(levels(checkConnectionUrls(POOLER.replace("pw", "[YOUR-PASSWORD]"), undefined))).toContain("fail");
    expect(levels(checkConnectionUrls(POOLER, POOLER))).toContain("warn");
    expect(levels(checkConnectionUrls("비밀번호에 잘못된 값", undefined))).toEqual(["fail"]);
  });

  it("결과에 연결 비밀번호를 넣지 않는다", () => {
    expect(JSON.stringify(checkConnectionUrls(POOLER.replace("pw", "secret-pw"), POOLER.replace("pw", "secret-pw")))).not.toContain("secret-pw");
  });

  it("암호화 키를 확인하고 로컬 키 재사용을 막는다", () => {
    const key = Buffer.alloc(32, 1).toString("base64");
    expect(levels(checkEncryptionKey(undefined))).toEqual(["fail"]);
    expect(levels(checkEncryptionKey("짧음"))).toEqual(["fail"]);
    expect(levels(checkEncryptionKey(key))).toEqual(["ok"]);
    expect(levels(checkEncryptionKey(key, key))).toEqual(["fail"]);
  });

  it("정상 DB는 통과하고 관리자가 없으면 경고한다", async () => {
    const r = await checkDatabase(sql);
    expect(levels(r)).not.toContain("fail");
    expect(r.some((x) => x.level === "warn" && x.label.includes("관리자"))).toBe(true);
    await seedAdmin();
    expect(levels(await checkDatabase(sql))).not.toContain("warn");
  });

  it("RLS가 꺼지면 실패로 알린다", async () => {
    await sql`ALTER TABLE workers DISABLE ROW LEVEL SECURITY`;
    try {
      expect((await checkDatabase(sql)).some((x) => x.level === "fail" && x.detail === "workers")).toBe(true);
    } finally {
      await sql`ALTER TABLE workers ENABLE ROW LEVEL SECURITY`;
    }
  });

  it("공개 API 역할에 권한이 열리면 실패로 알린다", async () => {
    await sql`GRANT SELECT ON workers TO anon`;
    try {
      expect((await checkDatabase(sql)).some((x) => x.level === "fail" && x.detail?.includes("anon:workers"))).toBe(true);
    } finally {
      await sql`REVOKE SELECT ON workers FROM anon`;
    }
  });

  it("다른 키로 암호화된 데이터를 찾아낸다", async () => {
    const { id } = await seedAdmin();
    await createWorker(sql, workerInputSchema.parse({ name: "김갑", phone: "01012345678", bankName: "국민", accountNumber: "123456789", accountHolder: "김갑" }), id);
    expect(levels(await checkDatabase(sql))).not.toContain("fail");
    const original = process.env.DATA_ENCRYPTION_KEY;
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    try {
      expect((await checkDatabase(sql)).some((x) => x.level === "fail" && x.label.includes("복호화"))).toBe(true);
    } finally {
      process.env.DATA_ENCRYPTION_KEY = original;
    }
  });

  it("점검은 DB를 바꾸지 않는다", async () => {
    await seedAdmin();
    const count = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_logs`)[0].n;
    const before = await count();
    await checkDatabase(sql);
    expect(await count()).toBe(before);
  });
});
