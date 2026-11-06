import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// ── 민감정보 저장 보호 (AES-256-GCM) ───────────────────
function subKey(info: string) {
  return Buffer.from(hkdfSync("sha256", env.encryptionKey, Buffer.alloc(0), info, 32));
}

export function encryptField(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subKey("dailywork/field-encryption/v1"), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}
export function decryptField(stored: string) {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1") throw new Error("지원하지 않는 암호화 형식입니다.");
  const d = createDecipheriv("aes-256-gcm", subKey("dailywork/field-encryption/v1"), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
/** 원문 없이 중복을 찾기 위한 키 기반 해시 */
export function blindIndex(value: string) {
  return createHmac("sha256", subKey("dailywork/blind-index/v1")).update(value).digest("hex");
}

// ── 세션 토큰 ──────────────────────────────────────────
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** 태블릿 입력용 일회용 코드. 헷갈리는 문자(0/O, 1/I)를 뺀다. 예: 7KQM-3XPA */
export function newPairingCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
export const normalizePairingCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");

// ── 비밀번호 해시 (scrypt) ─────────────────────────────
const N = 32768, R = 8, P = 1, LEN = 32;
function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, len, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), +n, +r, +p, expected.length);
  return timingSafeEqual(actual, expected);
}
