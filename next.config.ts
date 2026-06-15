import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "graph.facebook.com" },
      { protocol: "https", hostname: "platform-lookaside.fbsbx.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Cho phép Google Identity Services + Facebook SDK postMessage
          // từ popup về parent (mặc định browser block postMessage khi
          // parent có COOP same-origin). Same-origin-allow-popups = an
          // toàn (vẫn isolate cross-origin attackers) nhưng cho phép
          // popup do mình tạo ra giao tiếp lại.
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          // Chống clickjacking — app có nhiều state-changing action (vote,
          // confirm payment) chạy bằng click; cấm nhúng iframe. (In-app browser
          // Zalo/Messenger là webview, không phải iframe → không ảnh hưởng.)
          { key: "X-Frame-Options", value: "DENY" },
          // Ép HTTPS (Vercel đã TLS); chặn SSL-strip ở custom domain.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // App không dùng camera/mic/định vị → tắt hẳn.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // NOTE: Content-Security-Policy cố ý CHƯA thêm — cần chạy Report-Only
          // để tune cho Google Identity (accounts.google.com) + Facebook SDK
          // (connect.facebook.net) + Next inline script trước khi enforce.
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
