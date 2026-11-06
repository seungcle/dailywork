import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { setWorkerActive } from "@/server/services/workers";

export const POST = adminRoute(async ({ req, sql, admin, params }) => {
  const { active } = await parseBody(req, z.object({ active: z.boolean() }));
  await setWorkerActive(sql, params.id, active, admin.id);
  return { ok: true };
});
