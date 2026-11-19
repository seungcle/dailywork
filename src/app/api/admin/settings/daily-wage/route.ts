import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { setDefaultDailyWage } from "@/server/services/settings";

export const PUT = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, z.object({ defaultDailyWage: z.number().int().min(0).max(100_000_000), applyToAll: z.boolean().default(false) }));
  return setDefaultDailyWage(sql, b.defaultDailyWage, admin.id, { applyToAll: b.applyToAll });
});
