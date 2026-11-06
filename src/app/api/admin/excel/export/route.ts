import { adminRoute } from "@/server/http";
import { badRequest } from "@/server/errors";
import { buildExport, type ExportType } from "@/server/services/excel";
import { xlsxResponse } from "@/server/xlsxResponse";

const TYPES: ExportType[] = ["workers", "attendance", "records", "wage-summary", "payment"];

export const GET = adminRoute(async ({ req, sql, admin }) => {
  const p = req.nextUrl.searchParams;
  const type = p.get("type") as ExportType;
  if (!TYPES.includes(type)) throw badRequest("내보내기 종류가 올바르지 않습니다.");
  const { buffer, filename } = await buildExport(sql, {
    type, date: p.get("date") ?? undefined, from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, adminId: admin.id,
  });
  return xlsxResponse(buffer, filename);
});
