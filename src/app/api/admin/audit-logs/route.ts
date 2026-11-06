import { adminRoute } from "@/server/http";

export const GET = adminRoute(async ({ req, sql }) => {
  const page = Math.max(Number(req.nextUrl.searchParams.get("page") ?? 1) || 1, 1);
  const logs = await sql`
    SELECT l.id, l.action, l.target_type, l.target_id, l.before, l.after, l.reason, l.created_at, a.display_name AS admin_name
    FROM audit_logs l LEFT JOIN administrators a ON a.id = l.administrator_id
    ORDER BY l.created_at DESC, l.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`;
  return { logs, page };
});
