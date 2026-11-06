import { adminRoute } from "@/server/http";
import { revokeDevice } from "@/server/services/kioskDevices";

export const DELETE = adminRoute(async ({ sql, admin, params }) => {
  await revokeDevice(sql, params.id, admin.id);
  return { ok: true };
});
