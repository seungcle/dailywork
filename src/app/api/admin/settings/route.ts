import { adminRoute } from "@/server/http";

export const GET = adminRoute(async ({ admin }) => ({
  admin: { username: admin.username, displayName: admin.displayName },
}));
