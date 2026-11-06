import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { getMaxShiftHours, setMaxShiftHours } from "@/server/services/settings";
import { env } from "@/server/env";

export const GET = adminRoute(async ({ sql, admin }) => ({
  maxShiftHours: await getMaxShiftHours(sql), rrnEnabled: env.rrnEnabled, admin: { username: admin.username, displayName: admin.displayName },
}));

export const PATCH = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, z.object({ maxShiftHours: z.number().int() }));
  await setMaxShiftHours(sql, b.maxShiftHours, admin.id);
  return { ok: true };
});
