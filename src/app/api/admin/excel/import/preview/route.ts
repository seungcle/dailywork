import { adminRoute } from "@/server/http";
import { badRequest } from "@/server/errors";
import { parseWorkbook } from "@/server/services/excel";

export const POST = adminRoute(async ({ req }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("파일을 선택해 주세요.");
  return parseWorkbook(await file.arrayBuffer());
});
