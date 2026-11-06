import type { Sql } from "./db";
import { AppError } from "./errors";

/** 고정 윈도 시도 제한. 제한을 넘으면 429 오류. */
export async function hitRateLimit(sql: Sql, key: string, limit: number, windowSeconds: number) {
  const [row] = await sql<{ count: number }[]>`
    INSERT INTO rate_limits (key, count, window_started_at) VALUES (${key}, 1, clock_timestamp())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_started_at < clock_timestamp() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_started_at = CASE WHEN rate_limits.window_started_at < clock_timestamp() - make_interval(secs => ${windowSeconds})
                   THEN clock_timestamp() ELSE rate_limits.window_started_at END
    RETURNING count`;
  if (row.count > limit) throw new AppError(429, "RATE_LIMITED", "시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
}
export async function clearRateLimit(sql: Sql, key: string) {
  await sql`DELETE FROM rate_limits WHERE key = ${key}`;
}
