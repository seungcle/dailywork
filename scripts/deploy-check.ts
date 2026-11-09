// 배포 전 점검: npm run deploy:check
// .env.deploy의 값으로 운영 DB에 접속해 상태를 읽기만 한다. 비밀값은 출력하지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { createSql } from "@/server/db";
import { checkConnectionUrls, checkDatabase, checkEncryptionKey, type CheckResult } from "@/server/deployCheck";

const ICON = { ok: "✓", warn: "!", fail: "✗" };

function print(results: CheckResult[]) {
  for (const r of results) console.log(`${ICON[r.level]} ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
}

function localKey() {
  if (!existsSync(".env.local")) return undefined;
  return readFileSync(".env.local", "utf8").match(/^DATA_ENCRYPTION_KEY=(.*)$/m)?.[1]?.trim() || undefined;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const results = [
    ...checkConnectionUrls(databaseUrl, process.env.MIGRATION_DATABASE_URL),
    ...checkEncryptionKey(process.env.DATA_ENCRYPTION_KEY, localKey()),
  ];
  print(results);
  if (results.some((r) => r.level === "fail")) { console.log("\n위 항목을 고친 뒤 다시 실행해 주세요."); process.exit(1); }

  const sql = createSql(databaseUrl!);
  try {
    const db = await checkDatabase(sql);
    print(db);
    const failed = db.some((r) => r.level === "fail");
    console.log(failed ? "\n실패 항목이 있습니다. 배포 전에 해결해 주세요." : "\n점검 통과");
    process.exitCode = failed ? 1 : 0;
  } catch (e) {
    console.error(`✗ DB에 연결하지 못했습니다: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
main().then(() => process.exit(process.exitCode ?? 0));
