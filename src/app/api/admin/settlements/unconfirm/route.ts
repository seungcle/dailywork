import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { uuid } from "@/server/schemas";
import { unconfirmWages } from "@/server/services/settlement";

const schema = z.object({ recordIds: z.array(uuid).min(1), reason: z.string().trim().min(1, "확정 해제 사유를 입력해 주세요.").max(500) });

export const POST = adminRoute(async ({ req, sql, admin }) => unconfirmWages(sql, { ...(await parseBody(req, schema)), adminId: admin.id }));
