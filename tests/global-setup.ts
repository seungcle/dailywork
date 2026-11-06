import postgres from "postgres";
import { migrate } from "../scripts/migrate";

const URL = "postgres://dailywork:dailywork_local_only@127.0.0.1:54329/dailywork_test";

export default async function setup() {
  const sql = postgres(URL, { max: 1, onnotice: () => {} });
  try {
    await sql`DROP SCHEMA public CASCADE`;
    await sql`CREATE SCHEMA public`;
    // Supabase 기본 상태를 재현한다: 공개 API 역할과, 새 테이블에 자동으로 붙는 권한.
    await sql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
    `);
  } catch (e) {
    throw new Error(`테스트 DB에 접속하지 못했습니다. 'npm run db:up'을 먼저 실행해 주세요. (${(e as Error).message})`);
  } finally {
    await sql.end();
  }
  await migrate(URL, () => {});
}
