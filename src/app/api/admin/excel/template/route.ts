import { adminRoute } from "@/server/http";
import { buildTemplate } from "@/server/services/excel";
import { xlsxResponse } from "@/server/xlsxResponse";

export const GET = adminRoute(async () => xlsxResponse(await buildTemplate(), "근무자_등록_양식.xlsx"));
