import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { getSql, type Sql } from "./db";
import { AppError, badRequest, pgCode } from "./errors";
import { ADMIN_COOKIE, validateAdminSession, type AdminUser } from "./adminAuth";
import { KIOSK_COOKIE, validateKioskSession, type KioskDevice } from "./services/kioskDevices";

type RouteCtx = { params: Promise<Record<string, string | string[] | undefined>> };

function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status, headers: NO_STORE });
  }
  // 잘못된 UUID·날짜 형식은 400으로 돌려준다.
  if (["22P02", "22007", "22008"].includes(pgCode(e) ?? "")) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "요청 형식이 올바르지 않습니다." } }, { status: 400, headers: NO_STORE });
  }
  console.error("[api] 처리되지 않은 오류", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." } }, { status: 500, headers: NO_STORE });
}

const NO_STORE = { "Cache-Control": "no-store" };

/** 다른 사이트에서 보낸 변경 요청(CSRF)을 막는다. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // 브라우저는 변경 요청에 항상 Origin을 보낸다. 쿠키 없는 도구는 인증에서 걸러진다.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try { originHost = new URL(origin).host; } catch { /* 형식 오류는 거절 */ }
  if (!host || originHost !== host) throw new AppError(403, "FORBIDDEN_ORIGIN", "허용되지 않은 요청입니다.");
}

function respond(result: unknown) {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true }, { headers: NO_STORE });
}

type Base = { req: NextRequest; sql: Sql; params: Record<string, string> };

export function publicRoute(handler: (c: Base) => Promise<unknown>) {
  return async (req: NextRequest, ctx: RouteCtx) => {
    try {
      assertSameOrigin(req);
      return respond(await handler({ req, sql: getSql(), params: (await ctx.params) as Record<string, string> }));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** 관리자 API. /api/admin 아래의 모든 라우트는 이 래퍼를 거쳐야 한다(테스트로 강제). */
export function adminRoute(handler: (c: Base & { admin: AdminUser }) => Promise<unknown>) {
  return async (req: NextRequest, ctx: RouteCtx) => {
    try {
      assertSameOrigin(req);
      const sql = getSql();
      const admin = await validateAdminSession(sql, req.cookies.get(ADMIN_COOKIE)?.value);
      if (!admin) throw new AppError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
      return respond(await handler({ req, sql, admin, params: (await ctx.params) as Record<string, string> }));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** 키오스크 API. 등록된 장치의 세션만 통과한다. 관리자 쿠키로는 통과할 수 없다. */
export function kioskRoute(handler: (c: Base & { device: KioskDevice }) => Promise<unknown>) {
  return async (req: NextRequest, ctx: RouteCtx) => {
    try {
      assertSameOrigin(req);
      const sql = getSql();
      const device = await validateKioskSession(sql, req.cookies.get(KIOSK_COOKIE)?.value);
      if (!device) throw new AppError(401, "KIOSK_NOT_REGISTERED", "등록되지 않은 기기입니다.");
      return respond(await handler({ req, sql, device, params: (await ctx.params) as Record<string, string> }));
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try { body = await req.json(); } catch { throw badRequest("요청 본문이 올바르지 않습니다."); }
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.", r.error.issues);
  return r.data;
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function dateParam(req: NextRequest, name: string) {
  const v = req.nextUrl.searchParams.get(name);
  if (!v || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw badRequest("날짜 형식이 올바르지 않습니다.");
  return v;
}
