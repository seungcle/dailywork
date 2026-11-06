import { NextResponse } from "next/server";
import { publicRoute } from "@/server/http";
import { ADMIN_COOKIE, logout } from "@/server/adminAuth";

export const POST = publicRoute(async ({ req, sql }) => {
  await logout(sql, req.cookies.get(ADMIN_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
});
