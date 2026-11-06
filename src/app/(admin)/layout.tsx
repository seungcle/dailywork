import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/sidebar";
import { currentAdmin } from "@/server/pageAuth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  if (!admin) redirect("/login");
  return <AdminShell adminName={admin.displayName}>{children}</AdminShell>;
}
