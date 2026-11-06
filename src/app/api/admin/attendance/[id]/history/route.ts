import { adminRoute } from "@/server/http";
import { recordHistory } from "@/server/services/attendance";

export const GET = adminRoute(async ({ sql, params }) => ({ logs: await recordHistory(sql, params.id) }));
