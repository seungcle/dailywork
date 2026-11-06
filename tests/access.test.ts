import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as setup } from "@/app/api/kiosk/setup/route";
import { GET as session } from "@/app/api/kiosk/session/route";
import { POST as lookup } from "@/app/api/kiosk/lookup/route";
import { POST as attendance } from "@/app/api/kiosk/attendance/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as adminWorkers } from "@/app/api/admin/workers/route";
import { POST as adminAttendance } from "@/app/api/admin/attendance/route";
import { GET as dashboard } from "@/app/api/admin/dashboard/route";
import { registerDevice, reissueCode, revokeDevice, KIOSK_COOKIE, listDevices } from "@/server/services/kioskDevices";
import { ADMIN_COOKIE, changePassword, createAdministrator, login, validateAdminSession } from "@/server/adminAuth";
import { adminCookie, kioskCookie, noParams, request, resetDb, seedAdmin, seedKiosk, seedWorker, sql, TEST_PASSWORD } from "./helpers";

const PHONE = "01055550000";
let adminId: string, adminToken: string;
beforeEach(async () => {
  await resetDb();
  const a = await seedAdmin();
  adminId = a.id; adminToken = a.token;
  await seedWorker(adminId, { phone: PHONE });
});

const kioskCalls = (cookies?: Record<string, string>) => [
  () => session(request("/api/kiosk/session", { cookies }), noParams),
  () => lookup(request("/api/kiosk/lookup", { method: "POST", body: { phone: PHONE }, cookies }), noParams),
  () => attendance(request("/api/kiosk/attendance", { method: "POST", body: { phone: PHONE, action: "clock_in" }, cookies }), noParams),
];

async function expectAllBlocked(cookies?: Record<string, string>) {
  for (const call of kioskCalls(cookies)) {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("KIOSK_NOT_REGISTERED");
  }
  expect(await sql`SELECT id FROM work_records`).toHaveLength(0);
}

describe("비등록 키오스크 차단", () => {
  it("쿠키가 없으면 모든 키오스크 API를 막고 기록을 남기지 않는다", () => expectAllBlocked());
  it("위조한 토큰을 막는다", () => expectAllBlocked(kioskCookie("forged-token")));
  it("로그인한 관리자 세션이어도 등록된 기기가 아니면 막는다", () => expectAllBlocked({ [ADMIN_COOKIE]: adminToken, [KIOSK_COOKIE]: adminToken }));

  it("등록된 기기는 출퇴근할 수 있다", async () => {
    const k = await seedKiosk(adminId);
    const res = await attendance(request("/api/kiosk/attendance", { method: "POST", body: { phone: PHONE, action: "clock_in" }, cookies: kioskCookie(k.token) }), noParams);
    expect(res.status).toBe(200);
    expect(await sql`SELECT clock_in_device_id FROM work_records WHERE clock_in_device_id = ${k.id}`).toHaveLength(1);
  });

  it("연결 해제하면 기존 태블릿이 즉시 차단된다", async () => {
    const k = await seedKiosk(adminId);
    await revokeDevice(sql, k.id, adminId);
    await expectAllBlocked(kioskCookie(k.token));
    expect((await listDevices(sql)).find((d) => d.id === k.id)?.status).toBe("revoked");
  });

  it("만료된 세션을 막는다", async () => {
    const k = await seedKiosk(adminId);
    await sql`UPDATE kiosk_sessions SET expires_at = now() - interval '1 second' WHERE device_id = ${k.id}`;
    await expectAllBlocked(kioskCookie(k.token));
  });

  it("클라이언트가 시각을 보내도 무시하고 서버 시각을 쓴다", async () => {
    const k = await seedKiosk(adminId);
    const before = Date.now();
    await attendance(request("/api/kiosk/attendance", { method: "POST", body: { phone: PHONE, action: "clock_in", at: "2020-01-01T00:00:00Z", now: "2020-01-01T00:00:00Z" }, cookies: kioskCookie(k.token) }), noParams);
    const [r] = await sql<{ clock_in_at: Date }[]>`SELECT clock_in_at FROM work_records`;
    expect(r.clock_in_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("다른 사이트에서 온 요청을 막는다", async () => {
    const k = await seedKiosk(adminId);
    const res = await attendance(request("/api/kiosk/attendance", { method: "POST", body: { phone: PHONE, action: "clock_in" }, cookies: kioskCookie(k.token), headers: { origin: "https://evil.example" } }), noParams);
    expect(res.status).toBe(403);
  });

  it("응답에 전체 이름·전화번호·계좌 정보를 포함하지 않는다", async () => {
    const k = await seedKiosk(adminId);
    await sql`UPDATE workers SET name = '홍길동' WHERE phone = ${PHONE}`;
    const res = await lookup(request("/api/kiosk/lookup", { method: "POST", body: { phone: PHONE }, cookies: kioskCookie(k.token) }), noParams);
    const text = await res.text();
    expect(text).not.toContain("홍길동");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["maskedName", "state"]);
  });

  it("휴대폰 번호로 조회·출근하고 고유번호는 응답에 내주지 않는다", async () => {
    const k = await seedKiosk(adminId);
    const cookies = kioskCookie(k.token);
    const found = await lookup(request("/api/kiosk/lookup", { method: "POST", body: { phone: PHONE }, cookies }), noParams);
    expect(found.status).toBe(200);
    const res = await attendance(request("/api/kiosk/attendance", { method: "POST", body: { phone: PHONE, action: "clock_in" }, cookies }), noParams);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["action", "at", "maskedName"]);
    expect(await sql`SELECT 1 FROM work_records`).toHaveLength(1);
  });

  it("등록되지 않은 번호는 거절하고 거절 이력을 남긴다", async () => {
    const k = await seedKiosk(adminId);
    const cookies = kioskCookie(k.token);
    const body = { phone: "01099998888" };
    expect((await lookup(request("/api/kiosk/lookup", { method: "POST", body, cookies }), noParams)).status).toBe(404);
    expect((await attendance(request("/api/kiosk/attendance", { method: "POST", body: { ...body, action: "clock_in" }, cookies }), noParams)).status).toBe(404);
    const [e] = await sql<{ reject_code: string; worker_id: string | null }[]>`SELECT reject_code, worker_id FROM attendance_events`;
    expect(e).toEqual({ reject_code: "WORKER_NOT_FOUND", worker_id: null });
    expect(JSON.stringify(e)).not.toContain(body.phone);
  });

  it("8자리를 다 채우지 않은 번호는 조회하지 않는다", async () => {
    const k = await seedKiosk(adminId);
    for (const phone of ["0105555", "5555000", "02012345678", "010-5555-0000"]) {
      const res = await lookup(request("/api/kiosk/lookup", { method: "POST", body: { phone }, cookies: kioskCookie(k.token) }), noParams);
      expect(res.status).toBe(400);
    }
  });
});

describe("연결 코드", () => {
  const pair = (code: string, ip = "1.1.1.1") => setup(request("/api/kiosk/setup", { method: "POST", body: { code }, headers: { "x-forwarded-for": ip } }), noParams);

  it("코드로 연결하면 HttpOnly 쿠키를 발급하고 코드는 다시 쓸 수 없다", async () => {
    const { code } = await registerDevice(sql, "A", adminId);
    const res = await pair(code);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect((await pair(code)).status).toBe(400);
  });

  it("동시에 같은 코드를 보내도 한 기기만 연결된다", async () => {
    const { code } = await registerDevice(sql, "A", adminId);
    const rs = await Promise.all(Array.from({ length: 5 }, () => pair(code)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("만료된 코드, 잘못된 코드를 거절한다", async () => {
    const { code, id } = await registerDevice(sql, "A", adminId);
    await sql`UPDATE kiosk_devices SET pairing_expires_at = now() - interval '1 second' WHERE id = ${id}`;
    expect((await pair(code)).status).toBe(400);
    expect((await pair("AAAA-BBBB")).status).toBe(400);
  });

  it("입력 형식은 대소문자·하이픈을 구분하지 않는다", async () => {
    const { code } = await registerDevice(sql, "A", adminId);
    expect((await pair(code.replace("-", "").toLowerCase())).status).toBe(200);
  });

  it("코드 원문은 DB에 저장하지 않는다", async () => {
    const { code, id } = await registerDevice(sql, "A", adminId);
    const [d] = await sql<{ pairing_code_hash: string }[]>`SELECT pairing_code_hash FROM kiosk_devices WHERE id = ${id}`;
    expect(d.pairing_code_hash).not.toContain(code.replace("-", ""));
  });

  it("코드 추측 시도를 제한한다", async () => {
    const results = [];
    for (let i = 0; i < 11; i++) results.push((await pair(`WRON-G${String(i).padStart(3, "2")}`, "9.9.9.9")).status);
    expect(results.at(-1)).toBe(429);
  });

  it("새 코드를 발급하면 기존 연결이 끊긴다", async () => {
    const k = await seedKiosk(adminId);
    await reissueCode(sql, k.id, adminId);
    await expectAllBlocked(kioskCookie(k.token));
  });
});

describe("관리자 인증", () => {
  it("관리자 API는 로그인 없이 호출할 수 없다", async () => {
    expect((await adminWorkers(request("/api/admin/workers"), noParams)).status).toBe(401);
    expect((await dashboard(request("/api/admin/dashboard"), noParams)).status).toBe(401);
    expect((await adminAttendance(request("/api/admin/attendance", { method: "POST", body: {} }), noParams)).status).toBe(401);
  });

  it("키오스크 세션으로는 관리자 API를 호출할 수 없다", async () => {
    const k = await seedKiosk(adminId);
    const res = await adminWorkers(request("/api/admin/workers", { cookies: { ...kioskCookie(k.token), [ADMIN_COOKIE]: k.token } }), noParams);
    expect(res.status).toBe(401);
  });

  it("로그인 세션으로 호출할 수 있다", async () => {
    expect((await adminWorkers(request("/api/admin/workers", { cookies: adminCookie(adminToken) }), noParams)).status).toBe(200);
  });

  it("비밀번호는 해시로 저장하고, 로그인 성공 시 HttpOnly 쿠키를 준다", async () => {
    const [a] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM administrators WHERE id = ${adminId}`;
    expect(a.password_hash.startsWith("scrypt$")).toBe(true);
    expect(a.password_hash).not.toContain(TEST_PASSWORD);
    const res = await loginRoute(request("/api/auth/login", { method: "POST", body: { username: "ADMIN", password: TEST_PASSWORD } }), noParams);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("없는 계정과 틀린 비밀번호에 같은 메시지를 준다", async () => {
    const m = async (username: string) => (await (await loginRoute(request("/api/auth/login", { method: "POST", body: { username, password: "wrong-password" } }), noParams)).json()).error.message;
    expect(await m("admin")).toBe(await m("nobody"));
  });

  it("5회 실패하면 올바른 비밀번호도 잠시 거절한다", async () => {
    for (let i = 0; i < 5; i++) await login(sql, "admin", "wrong").catch(() => {});
    await expect(login(sql, "admin", TEST_PASSWORD)).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("만료된 세션을 거절한다", async () => {
    await sql`UPDATE admin_sessions SET expires_at = now() - interval '1 second'`;
    expect(await validateAdminSession(sql, adminToken)).toBeNull();
  });

  it("비밀번호를 바꾸면 다른 세션이 끊기고 현재 세션은 유지된다", async () => {
    const other = (await login(sql, "admin", TEST_PASSWORD)).token;
    const me = (await validateAdminSession(sql, adminToken))!;
    await changePassword(sql, me, TEST_PASSWORD, "new-password-5678");
    expect(await validateAdminSession(sql, other)).toBeNull();
    expect(await validateAdminSession(sql, adminToken)).not.toBeNull();
  });
});

describe("라우트 구조", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
  });
  const api = join(process.cwd(), "src/app/api");
  const exported = (src: string) => [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = (\w+)\(/g)];

  it("/api/admin 아래 모든 핸들러가 관리자 인증 래퍼를 쓴다", () => {
    const files = walk(join(api, "admin"));
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const handlers = exported(src);
      expect(handlers.length, relative(api, f)).toBeGreaterThan(0);
      expect(/export (async )?function/.test(src), relative(api, f)).toBe(false);
      handlers.forEach((m) => expect(m[2], `${relative(api, f)} ${m[1]}`).toBe("adminRoute"));
    }
  });

  it("/api/kiosk는 setup만 공개이고 나머지는 키오스크 인증 래퍼를 쓴다", () => {
    for (const f of walk(join(api, "kiosk"))) {
      const expectedWrapper = relative(api, f).startsWith("kiosk/setup") ? "publicRoute" : "kioskRoute";
      exported(readFileSync(f, "utf8")).forEach((m) => expect(m[2], relative(api, f)).toBe(expectedWrapper));
    }
  });

  it("Supabase 공개 API가 접근 못 하도록 모든 테이블에 RLS가 켜져 있다", async () => {
    const rows = await sql<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});

describe("관리자 비밀번호 길이", () => {
  it("4자는 허용하고 3자는 거절한다", async () => {
    await expect(createAdministrator(sql, { username: "len4", displayName: "t", password: "abcd" })).resolves.toBeTruthy();
    await expect(login(sql, "len4", "abcd")).resolves.toBeTruthy();
    await expect(createAdministrator(sql, { username: "len3", displayName: "t", password: "abc" })).rejects.toThrow("4자 이상");
  });
});
