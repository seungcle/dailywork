import { z } from "zod";
import { kioskRoute, parseBody } from "@/server/http";
import { kioskPhone } from "@/server/schemas";
import { clockByPhone } from "@/server/services/attendance";

// 시각 필드를 받지 않는다. 출퇴근 시각은 항상 서버가 정한다.
// 평소 퇴근은 18:00에 자동으로 들어가고, 키오스크에서는 출근과 야근 퇴근만 찍는다.
const schema = z.object({ phone: kioskPhone, action: z.enum(["clock_in", "overtime"]) });

export const POST = kioskRoute(async ({ req, sql, device }) => {
  const body = await parseBody(req, schema);
  const r = await clockByPhone(sql, { phone: body.phone, action: body.action, actor: { kind: "kiosk", deviceId: device.id } });
  return { action: body.action, at: r.at, name: r.workerName, maskedName: r.workerName };
});
