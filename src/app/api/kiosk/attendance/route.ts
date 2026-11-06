import { z } from "zod";
import { kioskRoute, parseBody } from "@/server/http";
import { workerNumber } from "@/server/schemas";
import { clockIn, clockOut } from "@/server/services/attendance";
import { maskName } from "@/lib/format";

// 시각 필드를 받지 않는다. 출퇴근 시각은 항상 서버가 정한다.
const schema = z.object({ workerNumber, action: z.enum(["clock_in", "clock_out"]) });

export const POST = kioskRoute(async ({ req, sql, device }) => {
  const body = await parseBody(req, schema);
  const actor = { kind: "kiosk" as const, deviceId: device.id };
  const r = body.action === "clock_in"
    ? await clockIn(sql, { workerNumber: body.workerNumber, actor })
    : await clockOut(sql, { workerNumber: body.workerNumber, actor });
  return { action: body.action, at: r.at, maskedName: maskName(r.workerName), workerNumber: r.workerNumber };
});
