import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, parseBody, publicRoute } from "@/server/http";
import { ADMIN_COOKIE, adminCookieOptions, login } from "@/server/adminAuth";
import { hitRateLimit } from "@/server/rateLimit";

const schema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });

export const POST = publicRoute(async ({ req, sql }) => {
  const body = await parseBody(req, schema);
  await hitRateLimit(sql, `login:${clientIp(req)}`, 30, 15 * 60);
  const { token } = await login(sql, body.username, body.password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
  return res;
});
