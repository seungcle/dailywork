import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, parseBody, publicRoute } from "@/server/http";
import { hitRateLimit } from "@/server/rateLimit";
import { KIOSK_COOKIE, kioskCookieOptions, pairDevice } from "@/server/services/kioskDevices";

const schema = z.object({ code: z.string().min(1, "연결 코드를 입력해 주세요.").max(20) });

// 인증 전 단계라 유일하게 공개된 키오스크 API다. 일회용 코드와 시도 제한으로 보호한다.
export const POST = publicRoute(async ({ req, sql }) => {
  const { code } = await parseBody(req, schema);
  await hitRateLimit(sql, `kiosk-setup:${clientIp(req)}`, 10, 15 * 60);
  const { token, device } = await pairDevice(sql, code);
  const res = NextResponse.json({ ok: true, deviceName: device.name });
  res.cookies.set(KIOSK_COOKIE, token, kioskCookieOptions());
  return res;
});
