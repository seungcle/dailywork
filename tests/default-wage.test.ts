import { beforeEach, describe, expect, it } from "vitest";
import { GET as getSettings } from "@/app/api/admin/settings/route";
import { PUT as putWage } from "@/app/api/admin/settings/daily-wage/route";
import { clockIn } from "@/server/services/attendance";
import { adminCookie, kst, noParams, request, resetDb, seedAdmin, seedWorker, sql } from "./helpers";

let admin: { id: string; token: string };
beforeEach(async () => { await resetDb(); admin = await seedAdmin(); });

const save = (body: unknown) => putWage(request("/api/admin/settings/daily-wage", { method: "PUT", body, cookies: adminCookie(admin.token) }), noParams);
const current = async () => (await (await getSettings(request("/api/admin/settings", { cookies: adminCookie(admin.token) }), noParams)).json()).defaultDailyWage;
const wages = async () => (await sql<{ base_daily_wage: number }[]>`SELECT base_daily_wage FROM workers ORDER BY worker_number`).map((w) => w.base_daily_wage);

describe("기본 일당 설정", () => {
  it("정한 적 없으면 0원이고, 저장하면 그 값이 보인다", async () => {
    expect(await current()).toBe(0);
    const res = await save({ defaultDailyWage: 96700 });
    expect(res.status).toBe(200);
    expect(await current()).toBe(96700);
  });

  it("저장만 하면 기존 근무자 일당은 그대로 둔다", async () => {
    await seedWorker(admin.id, { baseDailyWage: 150000 });
    await save({ defaultDailyWage: 96700 });
    expect(await wages()).toEqual([150000]);
  });

  it("모든 근무자에게 적용하면 비활성 근무자까지 바꾸되 이미 찍힌 일당은 그대로 둔다", async () => {
    const a = await seedWorker(admin.id, { baseDailyWage: 150000 });
    const b = await seedWorker(admin.id, { baseDailyWage: 96700 });
    await seedWorker(admin.id, { baseDailyWage: 120000 });
    await sql`UPDATE workers SET is_active = false WHERE id = ${b.id}`;
    await clockIn(sql, { workerNumber: a.worker_number, actor: { kind: "admin", adminId: admin.id }, now: kst("2026-11-19T08:00:00") });
    const before = await sql`SELECT base_wage, actual_wage FROM daily_wages`;
    expect(before).toEqual([{ base_wage: 150000, actual_wage: 150000 }]);

    const res = await save({ defaultDailyWage: 96700, applyToAll: true });
    expect((await res.json()).workersChanged).toBe(2);
    expect(await wages()).toEqual([96700, 96700, 96700]);
    expect(await sql`SELECT base_wage, actual_wage FROM daily_wages`).toEqual(before);
  });

  it("음수나 숫자가 아닌 값은 거절한다", async () => {
    expect((await save({ defaultDailyWage: -1 })).status).toBe(400);
    expect((await save({ defaultDailyWage: "abc" })).status).toBe(400);
    expect(await current()).toBe(0);
  });

  it("로그인하지 않으면 바꿀 수 없다", async () => {
    const res = await putWage(request("/api/admin/settings/daily-wage", { method: "PUT", body: { defaultDailyWage: 1 } }), noParams);
    expect(res.status).toBe(401);
  });
});
