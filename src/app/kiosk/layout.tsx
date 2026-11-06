import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "출퇴근 키오스크",
  manifest: "/kiosk.webmanifest",
  appleWebApp: { capable: true, title: "출퇴근", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, themeColor: "#0f1f3d" };

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 touch-manipulation select-none overflow-hidden bg-[#0f1f3d] text-white">{children}</div>;
}
