import { z } from "zod";
import { adminRoute, parseBody } from "@/server/http";
import { validateImport, type ImportMapping } from "@/server/services/excel";

const schema = z.object({ rows: z.array(z.array(z.string())).max(5000), mapping: z.record(z.string(), z.number().int().min(0)) });

export const POST = adminRoute(async ({ req, sql }) => {
  const b = await parseBody(req, schema);
  return validateImport(sql, b.rows, b.mapping as ImportMapping);
});
