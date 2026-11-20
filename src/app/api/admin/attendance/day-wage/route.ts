import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { dateStr, money } from "@/server/schemas";
import { setDayWage } from "@/server/services/attendance";

export const PUT = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, z.object({ workDate: dateStr, wage: money }));
  return setDayWage(sql, { ...b, adminId: admin.id });
});
