import { adminRoute, parseBody } from "@/server/http";
import { getWorker, updateWorker, workerHistory, workerInputSchema } from "@/server/services/workers";
import { env } from "@/server/env";

export const GET = adminRoute(async ({ sql, params }) => {
  const worker = await getWorker(sql, params.id);
  const history = await workerHistory(sql, params.id);
  return { worker, ...history, rrnEnabled: env.rrnEnabled };
});

export const PATCH = adminRoute(async ({ req, sql, admin, params }) => {
  await updateWorker(sql, params.id, await parseBody(req, workerInputSchema), admin.id);
  return { ok: true };
});
