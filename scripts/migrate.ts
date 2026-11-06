import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** db/migrations의 SQL을 파일명 순서대로 한 번씩 적용한다. */
export async function migrate(url: string, log: (m: string) => void = console.log) {
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const sql = postgres(url, { max: 1, ssl: local ? false : "require", onnotice: () => {} });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    await sql`ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY`;
    const dir = join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const [done] = await sql`SELECT 1 FROM schema_migrations WHERE name = ${file}`;
      if (done) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, file), "utf8"));
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      log(`적용: ${file}`);
    }
    log("마이그레이션 완료");
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL이 필요합니다.");
    process.exit(1);
  }
  migrate(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
