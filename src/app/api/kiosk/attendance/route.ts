import { z } from "zod";
import { kioskRoute, parseBody } from "@/server/http";
import { kioskPhone } from "@/server/schemas";
import { clockByPhone } from "@/server/services/attendance";
import { maskName } from "@/lib/format";

// 시각 필드를 받지 않는다. 출퇴근 시각은 항상 서버가 정한다.
const schema = z.object({ phone: kioskPhone, action: z.enum(["clock_in", "clock_out"]) });

export const POST = kioskRoute(async ({ req, sql, device }) => {
  const body = await parseBody(req, schema);
  const r = await clockByPhone(sql, { phone: body.phone, action: body.action, actor: { kind: "kiosk", deviceId: device.id } });
  return { action: body.action, at: r.at, maskedName: maskName(r.workerName) };
});
