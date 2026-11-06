import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { money } from "@/server/schemas";
import { updateWage } from "@/server/services/settlement";

const schema = z.object({ actualWage: money.optional(), extraPay: money.optional(), note: z.string().max(500).optional() });

export const PATCH = adminRoute(async ({ req, sql, admin, params }) => {
  const b = await parseBody(req, schema);
  return updateWage(sql, { recordId: params.id, ...b, adminId: admin.id });
});
