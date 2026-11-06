import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { dateStr } from "@/server/schemas";
import { copyPreviousDay } from "@/server/services/attendance";

export const POST = adminRoute(async ({ req, sql, admin }) => {
  const { workDate } = await parseBody(req, z.object({ workDate: dateStr }));
  return copyPreviousDay(sql, workDate, admin.id);
});
