import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 전용 라이브러리는 번들하지 않는다.
  serverExternalPackages: ["exceljs", "postgres"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      // Tailwind CSS v4 처리
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    }];
  },
};

export default nextConfig;
