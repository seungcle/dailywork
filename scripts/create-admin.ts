// 관리자 계정 발급: npm run admin:create -- <아이디> "<표시 이름>"
// 비밀번호는 터미널 기록에 남지 않도록 입력 프롬프트로 받는다.
import { createInterface } from "node:readline/promises";
import { createAdministrator } from "@/server/adminAuth";
import { createSql } from "@/server/db";

async function main() {
  const [username, displayName] = process.argv.slice(2);
  if (!username) throw new Error('사용법: npm run admin:create -- <아이디> "<표시 이름>"');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = process.env.ADMIN_PASSWORD ?? (await rl.question("비밀번호(10자 이상): "));
  rl.close();
  const sql = createSql(process.env.DATABASE_URL!);
  try {
    await createAdministrator(sql, { username, displayName: displayName || username, password });
    console.log(`관리자 ${username} 계정을 만들었습니다.`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
