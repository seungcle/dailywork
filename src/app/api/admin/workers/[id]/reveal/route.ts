import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { revealSensitive } from "@/server/services/workers";

// 주민등록번호는 상세 화면에 바로 보이므로 계좌번호만 따로 조회한다.
export const POST = adminRoute(async ({ req, sql, admin, params }) => {
  const { field } = await parseBody(req, z.object({ field: z.enum(["account"]) }));
  return { value: await revealSensitive(sql, params.id, field, admin.id) };
});
