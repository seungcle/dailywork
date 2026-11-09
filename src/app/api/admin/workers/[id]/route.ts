import { adminRoute, parseBody } from "@/server/http";
import { deleteWorker, getWorker, updateWorker, workerHistory, workerInputSchema } from "@/server/services/workers";

export const GET = adminRoute(async ({ sql, params }) => {
  const worker = await getWorker(sql, params.id);
  const history = await workerHistory(sql, params.id);
  return { worker, ...history };
});

export const PATCH = adminRoute(async ({ req, sql, admin, params }) => {
  await updateWorker(sql, params.id, await parseBody(req, workerInputSchema), admin.id);
  return { ok: true };
});

export const DELETE = adminRoute(async ({ sql, admin, params }) => {
  await deleteWorker(sql, params.id, admin.id);
  return { ok: true };
});
