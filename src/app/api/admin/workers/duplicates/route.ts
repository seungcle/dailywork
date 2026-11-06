import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { findDuplicates } from "@/server/services/workers";
import { normalizePhone } from "@/lib/format";

const schema = z.object({ name: z.string().trim().nullish(), phone: z.string().nullish(), accountNumber: z.string().nullish(), rrn: z.string().nullish(), excludeId: z.string().uuid().optional() });

export const POST = adminRoute(async ({ req, sql }) => {
  const b = await parseBody(req, schema);
  const candidates = await findDuplicates(sql, {
    name: b.name || null, phone: normalizePhone(b.phone), accountNumber: b.accountNumber?.replace(/\D/g, "") || null,
    rrn: b.rrn?.replace(/\D/g, "") || null, excludeId: b.excludeId,
  });
  return { candidates };
});
