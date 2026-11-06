import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { createWorker, listWorkers, workerInputSchema } from "@/server/services/workers";

export const GET = adminRoute(async ({ req, sql }) => {
  const p = req.nextUrl.searchParams;
  return listWorkers(sql, {
    q: p.get("q") ?? undefined,
    status: (["active", "inactive", "all"].includes(p.get("status") ?? "") ? p.get("status") : "active") as "active" | "inactive" | "all",
    sort: p.get("sort") ?? undefined,
    dir: p.get("dir") === "desc" ? "desc" : "asc",
    page: Number(p.get("page") ?? 1) || 1,
    pageSize: Number(p.get("pageSize") ?? 30) || 30,
  });
});

const schema = z.object({ worker: workerInputSchema, allowDuplicate: z.boolean().default(false) });

export const POST = adminRoute(async ({ req, sql, admin }) => {
  const body = await parseBody(req, schema);
  return createWorker(sql, body.worker, admin.id, { allowDuplicate: body.allowDuplicate });
});
