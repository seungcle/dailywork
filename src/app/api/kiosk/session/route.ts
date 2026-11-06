import { kioskRoute } from "@/server/http";

export const GET = kioskRoute(async ({ device }) => ({ deviceName: device.name }));
