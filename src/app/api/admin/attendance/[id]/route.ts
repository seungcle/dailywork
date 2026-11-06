import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { isoTime } from "@/server/schemas";
import { correctRecord, deleteRecord } from "@/server/services/attendance";

const patch = z.object({ clockInAt: isoTime.nullable(), clockOutAt: isoTime.nullable(), reason: z.string().trim().min(1, "수정 사유를 입력해 주세요.").max(500) });

export const PATCH = adminRoute(async ({ req, sql, admin, params }) => {
  const b = await parseBody(req, patch);
  await correctRecord(sql, { recordId: params.id, ...b, adminId: admin.id });
  return { ok: true };
});

const del = z.object({ reason: z.string().trim().min(1, "삭제 사유를 입력해 주세요.").max(500) });

export const DELETE = adminRoute(async ({ req, sql, admin, params }) => {
  const b = await parseBody(req, del);
  await deleteRecord(sql, { recordId: params.id, reason: b.reason, adminId: admin.id });
  return { ok: true };
});
