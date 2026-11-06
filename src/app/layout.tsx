import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "DailyWork",
  description: "일용직 출퇴근 키오스크 및 인력 관리 시스템",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <Toaster theme="light" richColors position="top-right" />
      </body>
    </html>
  );
}
