import { adminRoute } from "@/server/http";
import { reissueCode } from "@/server/services/kioskDevices";

export const POST = adminRoute(async ({ sql, admin, params }) => reissueCode(sql, params.id, admin.id));
