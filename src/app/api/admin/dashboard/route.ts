import { adminRoute } from "@/server/http";
import { getDashboard } from "@/server/services/dashboard";

export const GET = adminRoute(async ({ sql }) => getDashboard(sql));
