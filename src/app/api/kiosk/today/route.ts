import { kioskRoute } from "@/server/http";
import { todayClockInCount } from "@/server/services/attendance";

export const GET = kioskRoute(async ({ sql }) => todayClockInCount(sql));
