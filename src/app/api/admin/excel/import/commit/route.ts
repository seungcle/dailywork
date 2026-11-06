import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { commitImport, type ImportMapping } from "@/server/services/excel";

const schema = z.object({ rows: z.array(z.array(z.string())).max(5000), mapping: z.record(z.string(), z.number().int().min(0)), duplicatePolicy: z.enum(["skip", "update"]) });

export const POST = adminRoute(async ({ req, sql, admin }) => {
  const b = await parseBody(req, schema);
  return commitImport(sql, { rows: b.rows, mapping: b.mapping as ImportMapping, duplicatePolicy: b.duplicatePolicy, adminId: admin.id });
});
