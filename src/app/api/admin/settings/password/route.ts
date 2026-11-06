import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { changePassword } from "@/server/adminAuth";

export const POST = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }));
  await changePassword(sql, admin, b.current, b.next);
  return { ok: true };
});
