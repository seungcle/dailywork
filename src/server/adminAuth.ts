import type { Sql } from "./db";
import { hashPassword, hashToken, newToken, verifyPassword } from "./crypto";
import { AppError, badRequest } from "./errors";
import { audit } from "./audit";
import { env } from "./env";

export const ADMIN_COOKIE = "dw_admin";
const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 4;

export type AdminUser = { id: string; username: string; displayName: string; sessionId: string };

export const adminCookieOptions = () => ({
  httpOnly: true, secure: env.secureCookies, sameSite: "lax" as const, path: "/", maxAge: SESSION_HOURS * 3600,
});

// 없는 계정도 같은 시간이 걸리도록 비교에 쓰는 더미 해시
let dummyHash: Promise<string> | undefined;

export async function login(sql: Sql, username: string, password: string) {
  const invalid = new AppError(401, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.");
  const [admin] = await sql<{ id: string; password_hash: string; is_active: boolean; locked: boolean }[]>`
    SELECT id, password_hash, is_active, COALESCE(locked_until > clock_timestamp(), false) AS locked
    FROM administrators WHERE lower(username) = lower(${username})`;
  if (!admin) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    throw invalid;
  }
  if (admin.locked) throw new AppError(423, "ACCOUNT_LOCKED", `로그인 실패가 반복되어 잠겼습니다. ${LOCK_MINUTES}분 후 다시 시도해 주세요.`);
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok || !admin.is_active) {
    await sql`
      UPDATE administrators SET
        failed_login_count = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED} THEN 0 ELSE failed_login_count + 1 END,
        locked_until = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED}
                            THEN clock_timestamp() + make_interval(mins => ${LOCK_MINUTES}) ELSE locked_until END
      WHERE id = ${admin.id}`;
    throw invalid;
  }
  const token = newToken();
  await sql`DELETE FROM admin_sessions WHERE expires_at < clock_timestamp()`;
  await sql`INSERT INTO admin_sessions (administrator_id, token_hash, expires_at)
            VALUES (${admin.id}, ${hashToken(token)}, clock_timestamp() + make_interval(hours => ${SESSION_HOURS}))`;
  await sql`UPDATE administrators SET failed_login_count = 0, locked_until = NULL, last_login_at = clock_timestamp() WHERE id = ${admin.id}`;
  return { token };
}

export async function validateAdminSession(sql: Sql, token: string | undefined): Promise<AdminUser | null> {
  if (!token) return null;
  const [row] = await sql<{ id: string; username: string; display_name: string; session_id: string }[]>`
    SELECT a.id, a.username, a.display_name, s.id AS session_id
    FROM admin_sessions s JOIN administrators a ON a.id = s.administrator_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > clock_timestamp() AND a.is_active`;
  return row ? { id: row.id, username: row.username, displayName: row.display_name, sessionId: row.session_id } : null;
}

export async function logout(sql: Sql, token: string | undefined) {
  if (token) await sql`DELETE FROM admin_sessions WHERE token_hash = ${hashToken(token)}`;
}

export async function changePassword(sql: Sql, admin: AdminUser, current: string, next: string) {
  if (next.length < MIN_PASSWORD_LENGTH) throw badRequest(`새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  const [row] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM administrators WHERE id = ${admin.id}`;
  if (!(await verifyPassword(current, row.password_hash))) throw badRequest("현재 비밀번호가 올바르지 않습니다.");
  const hash = await hashPassword(next);
  await sql`UPDATE administrators SET password_hash = ${hash} WHERE id = ${admin.id}`;
  // 다른 기기의 로그인은 모두 끊는다.
  await sql`DELETE FROM admin_sessions WHERE administrator_id = ${admin.id} AND id <> ${admin.sessionId}`;
  await audit(sql, { administratorId: admin.id, action: "admin.password_change", targetType: "administrator", targetId: admin.id });
}

export async function createAdministrator(sql: Sql, input: { username: string; displayName: string; password: string }) {
  if (input.password.length < MIN_PASSWORD_LENGTH) throw badRequest(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
  const hash = await hashPassword(input.password);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO administrators (username, display_name, password_hash)
    VALUES (${input.username}, ${input.displayName}, ${hash}) RETURNING id`;
  return row.id;
}
