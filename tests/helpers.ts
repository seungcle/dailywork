import { NextRequest } from "next/server";
import { getSql } from "@/server/db";
import { createAdministrator, login, ADMIN_COOKIE } from "@/server/adminAuth";
import { registerDevice, pairDevice, KIOSK_COOKIE } from "@/server/services/kioskDevices";
import { createWorker, workerInputSchema } from "@/server/services/workers";

export const sql = getSql();

export async function resetDb() {
  await sql`TRUNCATE administrators, admin_sessions, workers, worker_payment_accounts, kiosk_devices, kiosk_sessions,
            work_records, daily_wages, attendance_events, audit_logs, rate_limits CASCADE`;
  await sql`UPDATE app_settings SET value = '24' WHERE key = 'max_shift_hours'`;
}

export const TEST_PASSWORD = "test-password-1234";

export async function seedAdmin(username = "admin") {
  const id = await createAdministrator(sql, { username, displayName: "테스트 관리자", password: TEST_PASSWORD });
  const { token } = await login(sql, username, TEST_PASSWORD);
  return { id, token };
}

export async function seedKiosk(adminId: string, name = "현장 태블릿") {
  const { id, code } = await registerDevice(sql, name, adminId);
  const { token } = await pairDevice(sql, code);
  return { id, token };
}

let seq = 0;
export async function seedWorker(adminId: string, over: Record<string, unknown> = {}) {
  seq++;
  const input = workerInputSchema.parse({ name: `근무자${seq}`, phone: `0109${String(seq).padStart(7, "0")}`, baseDailyWage: 150000, ...over });
  return createWorker(sql, input, adminId, { allowDuplicate: true });
}

/** 한국 시간 문자열 → Date */
export const kst = (s: string) => new Date(`${s}+09:00`);

export function request(path: string, init: { method?: string; body?: unknown; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(init.headers ?? {}) };
  if (init.cookies) headers.cookie = Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
export const noParams = { params: Promise.resolve({}) };
export const adminCookie = (token: string) => ({ [ADMIN_COOKIE]: token });
export const kioskCookie = (token: string) => ({ [KIOSK_COOKIE]: token });
