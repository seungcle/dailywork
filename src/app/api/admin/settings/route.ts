import { adminRoute } from "@/server/http";
import { getDefaultDailyWage } from "@/server/services/settings";

export const GET = adminRoute(async ({ sql, admin }) => ({
  admin: { username: admin.username, displayName: admin.displayName },
  defaultDailyWage: await getDefaultDailyWage(sql),
}));
