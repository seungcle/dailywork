import { adminRoute, dateParam } from "@/server/http";
import { settlementDetails, settlementReport } from "@/server/services/settlement";

export const GET = adminRoute(async ({ req, sql }) => {
  const from = dateParam(req, "from");
  const to = dateParam(req, "to");
  const workerId = req.nextUrl.searchParams.get("workerId");
  if (workerId) return { rows: await settlementDetails(sql, from, to, workerId) };
  return settlementReport(sql, from, to);
});
