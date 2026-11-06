import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./db";
import { decryptField } from "./crypto";

export type CheckResult = { level: "ok" | "warn" | "fail"; label: string; detail?: string };

/** 연결 문자열 형식 점검. 값 자체는 결과에 넣지 않는다. */
export function checkConnectionUrls(databaseUrl: string | undefined, migrationUrl: string | undefined): CheckResult[] {
  const out: CheckResult[] = [];
  if (!databaseUrl) return [{ level: "fail", label: "DATABASE_URL이 없습니다." }];
  let u: URL;
  try { u = new URL(databaseUrl); } catch { return [{ level: "fail", label: "DATABASE_URL 형식이 올바르지 않습니다.", detail: "비밀번호의 특수문자는 URL 인코딩해야 합니다." }]; }
  if (/\[.*\]|YOUR-PASSWORD/i.test(databaseUrl)) out.push({ level: "fail", label: "DATABASE_URL에 비밀번호 자리표시자가 남아 있습니다." });
  if (["127.0.0.1", "localhost"].includes(u.hostname)) out.push({ level: "fail", label: "DATABASE_URL이 로컬 DB를 가리킵니다." });
  else if (u.port === "6543") out.push({ level: "ok", label: "DATABASE_URL: Transaction pooler(6543)" });
  else out.push({ level: "warn", label: "DATABASE_URL이 Transaction pooler(6543)가 아닙니다.", detail: "Vercel에서는 연결 수가 빠르게 늘 수 있습니다." });
  if (migrationUrl) {
    try {
      const m = new URL(migrationUrl);
      if (m.port === "6543") out.push({ level: "warn", label: "MIGRATION_DATABASE_URL은 Session pooler(5432)나 Direct 연결을 권장합니다." });
      else out.push({ level: "ok", label: "MIGRATION_DATABASE_URL 형식 확인" });
    } catch { out.push({ level: "fail", label: "MIGRATION_DATABASE_URL 형식이 올바르지 않습니다." }); }
  }
  return out;
}

export function checkEncryptionKey(key: string | undefined, localKey?: string): CheckResult[] {
  if (!key) return [{ level: "fail", label: "DATA_ENCRYPTION_KEY가 없습니다." }];
  if (Buffer.from(key, "base64").length !== 32) return [{ level: "fail", label: "DATA_ENCRYPTION_KEY는 32바이트 base64여야 합니다." }];
  if (localKey && key === localKey) return [{ level: "fail", label: "운영 키가 로컬 개발 키와 같습니다.", detail: "운영 전용 키를 새로 만들어 주세요." }];
  return [{ level: "ok", label: "DATA_ENCRYPTION_KEY 형식 확인" }];
}

/** 실제 DB 상태 점검. 읽기만 하며 아무것도 바꾸지 않는다. */
export async function checkDatabase(sql: Sql, migrationsDir = join(process.cwd(), "db", "migrations")): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  const [{ version }] = await sql<{ version: string }[]>`SELECT current_setting('server_version') AS version`;
  out.push({ level: "ok", label: `DB 연결 성공 (PostgreSQL ${version})` });

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const [{ exists }] = await sql<{ exists: boolean }[]>`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`;
  const applied = exists ? (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name) : [];
  const missing = files.filter((f) => !applied.includes(f));
  if (missing.length) {
    out.push({ level: "fail", label: "적용되지 않은 마이그레이션이 있습니다.", detail: missing.join(", ") });
    return out;
  }
  out.push({ level: "ok", label: `마이그레이션 ${files.length}개 적용 완료` });

  const noRls = await sql<{ relname: string }[]>`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`;
  out.push(noRls.length
    ? { level: "fail", label: "RLS가 꺼진 테이블이 있습니다.", detail: noRls.map((r) => r.relname).join(", ") }
    : { level: "ok", label: "모든 테이블에 RLS 적용" });

  const policies = await sql<{ tablename: string }[]>`SELECT tablename FROM pg_policies WHERE schemaname = 'public'`;
  if (policies.length) out.push({ level: "warn", label: "예상하지 않은 RLS 정책이 있습니다.", detail: policies.map((p) => p.tablename).join(", ") });

  const exposed = await sql<{ role: string; relname: string }[]>`
    SELECT r.rolname AS role, c.relname
    FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE r.rolname IN ('anon', 'authenticated') AND n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
      AND (has_table_privilege(r.oid, c.oid, 'SELECT') OR has_table_privilege(r.oid, c.oid, 'INSERT')
        OR has_table_privilege(r.oid, c.oid, 'UPDATE') OR has_table_privilege(r.oid, c.oid, 'DELETE'))`;
  out.push(exposed.length
    ? { level: "fail", label: "공개 API 역할이 접근할 수 있는 테이블이 있습니다.", detail: exposed.map((e) => `${e.role}:${e.relname}`).join(", ") }
    : { level: "ok", label: "공개 API 역할(anon, authenticated) 접근 차단" });

  const [{ tz }] = await sql<{ tz: string }[]>`SELECT (now() AT TIME ZONE 'Asia/Seoul')::text AS tz`;
  out.push({ level: "ok", label: `DB 기준 현재 한국 시각 ${tz.slice(0, 16)}` });

  const [{ admins }] = await sql<{ admins: number }[]>`SELECT count(*)::int AS admins FROM administrators WHERE is_active`;
  out.push(admins
    ? { level: "ok", label: `활성 관리자 ${admins}명` }
    : { level: "warn", label: "관리자 계정이 없습니다.", detail: "npm run admin:create:prod 로 발급해 주세요." });

  const [sample] = await sql<{ enc: string }[]>`SELECT account_number_enc AS enc FROM worker_payment_accounts LIMIT 1`;
  if (sample) {
    try { decryptField(sample.enc); out.push({ level: "ok", label: "암호화 키로 저장된 계좌 복호화 성공" }); }
    catch { out.push({ level: "fail", label: "현재 암호화 키로 저장된 계좌를 복호화할 수 없습니다.", detail: "데이터를 암호화한 키와 다른 키입니다." }); }
  }
  return out;
}
