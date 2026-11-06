import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { listDevices, registerDevice } from "@/server/services/kioskDevices";

export const GET = adminRoute(async ({ sql }) => ({ devices: await listDevices(sql) }));

export const POST = adminRoute(async ({ req, sql, admin }) => {
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1, "장치 이름을 입력해 주세요.").max(50) }));
  return registerDevice(sql, name, admin.id);
});
