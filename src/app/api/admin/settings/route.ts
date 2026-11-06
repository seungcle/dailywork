import { adminRoute } from "@/server/http";
import { env } from "@/server/env";

export const GET = adminRoute(async ({ admin }) => ({
  rrnEnabled: env.rrnEnabled, admin: { username: admin.username, displayName: admin.displayName },
}));
