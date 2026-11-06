import { z } from "zod";
import { kioskRoute, parseBody } from "@/server/http";
import { kioskPhone } from "@/server/schemas";
import { lookupForKiosk } from "@/server/services/attendance";

const schema = z.object({ phone: kioskPhone });

export const POST = kioskRoute(async ({ req, sql }) => {
  const body = await parseBody(req, schema);
  return lookupForKiosk(sql, body.phone);
});
