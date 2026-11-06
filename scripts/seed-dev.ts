// 로컬 개발 전용 샘플 데이터. 로컬 DB가 아니면 실행을 거부한다.
import { createAdministrator } from "@/server/adminAuth";
import { createSql } from "@/server/db";
import { createWorker, workerInputSchema } from "@/server/services/workers";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("로컬 DB에서만 실행할 수 있습니다.");
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!password) throw new Error(".env.local에 DEV_ADMIN_PASSWORD를 설정해 주세요.");
  const sql = createSql(url);
  try {
    const [exists] = await sql<{ id: string }[]>`SELECT id FROM administrators WHERE username = 'admin'`;
    const adminId = exists?.id ?? (await createAdministrator(sql, { username: "admin", displayName: "관리자", password }));
    const samples = [
      { name: "김민수", phone: "010-1111-0001", baseDailyWage: 150000, bankName: "국민은행", accountNumber: "11111100001", accountHolder: "김민수" },
      { name: "이서준", phone: "010-1111-0002", baseDailyWage: 160000, bankName: "신한은행", accountNumber: "11111100002", accountHolder: "이서준" },
      { name: "박지훈", phone: "010-1111-0003", baseDailyWage: 150000, bankName: "우리은행", accountNumber: "11111100003", accountHolder: "박지훈" },
      { name: "최영호", phone: "010-1111-0004", baseDailyWage: 170000 },
    ];
    for (const s of samples) {
      try { await createWorker(sql, workerInputSchema.parse(s), adminId); } catch { /* 이미 있으면 건너뜀 */ }
    }
    console.log("샘플 데이터 준비 완료 (아이디: admin)");
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
