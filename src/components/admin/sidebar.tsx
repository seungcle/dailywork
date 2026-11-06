"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, FileSpreadsheet, LayoutDashboard, LogOut, Settings, TabletSmartphone, Users, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/attendance", label: "일일 출석부", icon: CalendarCheck },
  { href: "/workers", label: "근무자 관리", icon: Users },
  { href: "/settlements", label: "일당 정산", icon: Wallet },
  { href: "/excel", label: "Excel 관리", icon: FileSpreadsheet },
  { href: "/kiosk-devices", label: "키오스크 관리", icon: TabletSmartphone },
  { href: "/settings", label: "설정", icon: Settings },
];

export function AdminShell({ adminName, children }: { adminName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const current = NAV.find((n) => pathname.startsWith(n.href));
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r bg-sidebar md:flex print:hidden">
        <Link href="/dashboard" className="flex h-13 items-center gap-2 border-b px-4 font-semibold text-primary">
          <span className="flex size-6 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">D</span>
          DailyWork
        </Link>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={cn("flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-foreground/75 hover:bg-muted")}>
                <n.icon className="size-4" />{n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b bg-card px-5 print:hidden">
          <div className="text-sm font-medium">{current?.label}</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{adminName}님</span>
            <Button variant="ghost" size="sm" onClick={async () => {
              await api("/api/auth/logout", { method: "POST" }).catch(() => {});
              router.replace("/login");
              router.refresh();
            }}><LogOut className="size-4" />로그아웃</Button>
          </div>
        </header>
        {/* 좁은 화면용 메뉴 */}
        <nav className="flex gap-1 overflow-x-auto border-b bg-card px-2 py-1.5 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("shrink-0 rounded px-2.5 py-1.5 text-xs", pathname.startsWith(n.href) ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-foreground/70")}>{n.label}</Link>
          ))}
        </nav>
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
