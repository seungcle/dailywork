import postgres from "postgres";
import { migrate } from "../scripts/migrate";

const URL = "postgres://dailywork:dailywork_local_only@127.0.0.1:54329/dailywork_test";

export default async function setup() {
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  try {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
  } catch (e) {
    throw new Error(`테스트 DB에 접속하지 못했습니다. 'npm run db:up'을 먼저 실행해 주세요. (${(e as Error).message})`);
  } finally {
    await sql.end();
  }
  await migrate(URL, () => {});
}
