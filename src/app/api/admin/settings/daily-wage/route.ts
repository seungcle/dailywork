import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { money } from "@/server/schemas";
import { setDefaultDailyWage } from "@/server/services/settings";

export const PUT = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, z.object({ defaultDailyWage: money, applyToAll: z.boolean().default(false) }));
  return setDefaultDailyWage(sql, b.defaultDailyWage, admin.id, { applyToAll: b.applyToAll });
});
