import postgres from "postgres";
import { env } from "./env";

export type Sql = postgres.Sql<Record<string, never>> | postgres.TransactionSql<Record<string, never>>;

const store = globalThis as unknown as { __dailyworkSql?: postgres.Sql<Record<string, never>> };

export function createSql(url: string) {
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  return postgres(url, {
    // Supabase 트랜잭션 풀러와 호환되도록 prepared statement를 쓰지 않는다.
    prepare: false,
    max: process.env.VERCEL ? 3 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : "require",
    onnotice: () => {},
  }) as unknown as postgres.Sql<Record<string, never>>;
}

export function getSql() {
  store.__dailyworkSql ??= createSql(env.databaseUrl);
  return store.__dailyworkSql;
}

/** 풀과 트랜잭션 어느 쪽을 받아도 트랜잭션(또는 세이브포인트)으로 실행한다. */
export function tx<T>(sql: Sql, fn: (t: postgres.TransactionSql<Record<string, never>>) => Promise<T>): Promise<T> {
  return (sql as postgres.Sql<Record<string, never>>).begin((t) => fn(t as postgres.TransactionSql<Record<string, never>>)) as Promise<T>;
}
