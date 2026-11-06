import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { dateStr, uuid } from "@/server/schemas";
import { confirmWages } from "@/server/services/settlement";

const schema = z.object({ from: dateStr, to: dateStr, workerIds: z.array(uuid).optional(), recordIds: z.array(uuid).optional() });

export const POST = adminRoute(async ({ req, sql, admin }) => confirmWages(sql, { ...(await parseBody(req, schema)), adminId: admin.id }));
