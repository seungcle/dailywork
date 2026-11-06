import { z } from "zod";
import { kioskRoute, parseBody } from "@/server/http";
import { workerNumber } from "@/server/schemas";
import { lookupForKiosk } from "@/server/services/attendance";

const schema = z.object({ workerNumber });

export const POST = kioskRoute(async ({ req, sql }) => {
  const body = await parseBody(req, schema);
  return lookupForKiosk(sql, body.workerNumber);
});
