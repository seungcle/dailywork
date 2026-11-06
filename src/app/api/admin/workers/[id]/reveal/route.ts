import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { revealSensitive } from "@/server/services/workers";

export const POST = adminRoute(async ({ req, sql, admin, params }) => {
  const { field } = await parseBody(req, z.object({ field: z.enum(["account", "rrn"]) }));
  return { value: await revealSensitive(sql, params.id, field, admin.id) };
});
