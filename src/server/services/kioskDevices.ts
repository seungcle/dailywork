import type { Sql } from "../db";
import { tx } from "../db";
import { hashToken, newPairingCode, newToken, normalizePairingCode } from "../crypto";
import { AppError, notFound } from "../errors";
import { audit } from "../audit";
import { env } from "../env";

export const KIOSK_COOKIE = "dw_kiosk";
const PAIRING_MINUTES = 15;
const SESSION_DAYS = 365;

export const kioskCookieOptions = () => ({
  httpOnly: true, secure: env.secureCookies, sameSite: "strict" as const, path: "/", maxAge: SESSION_DAYS * 86400,
});

export type KioskDevice = { id: string; name: string };

export async function listDevices(sql: Sql) {
  return sql`
    SELECT d.id, d.name, d.created_at, d.paired_at, d.revoked_at, d.last_seen_at, d.pairing_expires_at,
      CASE WHEN d.revoked_at IS NOT NULL THEN 'revoked'
           WHEN EXISTS (SELECT 1 FROM kiosk_sessions s WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()) THEN 'connected'
           ELSE 'waiting' END AS status
    FROM kiosk_devices d ORDER BY d.created_at DESC`;
}

/** 장치 등록과 동시에 일회용 연결 코드를 발급한다. 코드 원문은 이 응답에서만 볼 수 있다. */
export async function registerDevice(sql: Sql, name: string, adminId: string) {
  return tx(sql, async (t) => {
    const code = newPairingCode();
    const [d] = await t<{ id: string; pairing_expires_at: Date }[]>`
      INSERT INTO kiosk_devices (name, pairing_code_hash, pairing_expires_at, created_by)
      VALUES (${name.trim()}, ${hashToken(normalizePairingCode(code))}, clock_timestamp() + make_interval(mins => ${PAIRING_MINUTES}), ${adminId})
      RETURNING id, pairing_expires_at`;
    await audit(t, { administratorId: adminId, action: "kiosk.register", targetType: "kiosk_device", targetId: d.id, after: { name: name.trim() } });
    return { id: d.id, code, expiresAt: d.pairing_expires_at };
  });
}

/** 새 코드 발급. 기존 연결은 끊고, 해제된 장치는 다시 사용할 수 있게 된다. */
export async function reissueCode(sql: Sql, deviceId: string, adminId: string) {
  return tx(sql, async (t) => {
    const code = newPairingCode();
    const [d] = await t<{ id: string; pairing_expires_at: Date }[]>`
      UPDATE kiosk_devices SET pairing_code_hash = ${hashToken(normalizePairingCode(code))},
        pairing_expires_at = clock_timestamp() + make_interval(mins => ${PAIRING_MINUTES}), revoked_at = NULL
      WHERE id = ${deviceId} RETURNING id, pairing_expires_at`;
    if (!d) throw notFound("키오스크 장치를 찾을 수 없습니다.");
    await t`UPDATE kiosk_sessions SET revoked_at = clock_timestamp() WHERE device_id = ${deviceId} AND revoked_at IS NULL`;
    await audit(t, { administratorId: adminId, action: "kiosk.reissue_code", targetType: "kiosk_device", targetId: deviceId });
    return { id: d.id, code, expiresAt: d.pairing_expires_at };
  });
}

export async function revokeDevice(sql: Sql, deviceId: string, adminId: string) {
  await tx(sql, async (t) => {
    const [d] = await t`
      UPDATE kiosk_devices SET revoked_at = clock_timestamp(), pairing_code_hash = NULL, pairing_expires_at = NULL
      WHERE id = ${deviceId} RETURNING id`;
    if (!d) throw notFound("키오스크 장치를 찾을 수 없습니다.");
    await t`UPDATE kiosk_sessions SET revoked_at = clock_timestamp() WHERE device_id = ${deviceId} AND revoked_at IS NULL`;
    await audit(t, { administratorId: adminId, action: "kiosk.revoke", targetType: "kiosk_device", targetId: deviceId });
  });
}

/** 연결 코드를 세션으로 교환한다. UPDATE 한 번으로 코드를 소모해 동시 요청에도 한 번만 성공한다. */
export async function pairDevice(sql: Sql, rawCode: string) {
  return tx(sql, async (t) => {
    const [d] = await t<KioskDevice[]>`
      UPDATE kiosk_devices SET pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = clock_timestamp(), last_seen_at = clock_timestamp()
      WHERE pairing_code_hash = ${hashToken(normalizePairingCode(rawCode))}
        AND pairing_expires_at > clock_timestamp() AND revoked_at IS NULL
      RETURNING id, name`;
    if (!d) throw new AppError(400, "INVALID_PAIRING_CODE", "연결 코드가 올바르지 않거나 만료되었습니다.");
    const token = newToken();
    await t`INSERT INTO kiosk_sessions (device_id, token_hash, expires_at)
            VALUES (${d.id}, ${hashToken(token)}, clock_timestamp() + make_interval(days => ${SESSION_DAYS}))`;
    await audit(t, { action: "kiosk.paired", targetType: "kiosk_device", targetId: d.id });
    return { token, device: d };
  });
}

/** 쿠키의 키오스크 세션을 서버에서 검증한다. 화면과 API가 모두 이 함수를 쓴다. */
export async function validateKioskSession(sql: Sql, token: string | undefined): Promise<KioskDevice | null> {
  if (!token) return null;
  const [d] = await sql<KioskDevice[]>`
    SELECT d.id, d.name FROM kiosk_sessions s JOIN kiosk_devices d ON d.id = s.device_id
    WHERE s.token_hash = ${hashToken(token)} AND s.revoked_at IS NULL
      AND s.expires_at > clock_timestamp() AND d.revoked_at IS NULL`;
  if (!d) return null;
  await sql`UPDATE kiosk_devices SET last_seen_at = clock_timestamp()
            WHERE id = ${d.id} AND (last_seen_at IS NULL OR last_seen_at < clock_timestamp() - interval '1 minute')`;
  return d;
}
