import { z } from "zod";
import { adminRoute, dateParam, parseBody } from "@/server/http";
import { dateStr, isoTime, uuid } from "@/server/schemas";
import { addManualRecords, getDaily } from "@/server/services/attendance";

export const GET = adminRoute(async ({ req, sql }) => getDaily(sql, dateParam(req, "date")));

const schema = z.object({
  workerIds: z.array(uuid).min(1, "근무자를 선택해 주세요.").max(500),
  workDate: dateStr,
  clockInAt: isoTime.nullish(),
  clockOutAt: isoTime.nullish(),
});

export const POST = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, schema);
  return addManualRecords(sql, { ...b, adminId: admin.id });
});
