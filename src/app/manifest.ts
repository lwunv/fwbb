import type { MetadataRoute } from "next";

/**
 * Web App Manifest: cái này cho Android/Chrome một icon tử tế khi "Thêm vào màn
 * hình chính", và tên nhãn dưới icon. (iOS lấy icon từ `apple-icon.png` và nhãn
 * từ `apple-mobile-web-app-title` ở layout, không đọc file này.)
 *
 * `display: "standalone"` để Chrome cho "Cài đặt" thành app (không chỉ "Tạo lối
 * tắt"). Trước đây để "browser" vì đăng nhập Google dùng popup, mà popup đứt
 * trong app standalone (cửa sổ bật ra là ngữ cảnh khác, credential postMessage
 * không về được). Nay vá ở tầng đăng nhập: khi chạy standalone, nút Google dùng
 * FedCM (hộp thoại native của trình duyệt, KHÔNG popup) nên credential về thẳng
 * callback. Xem `renderGoogleButton` ở `src/lib/google-sdk.ts`. Trình duyệt
 * thường giữ nguyên popup cũ. Đăng nhập email/mật khẩu là form POST, chạy mọi
 * ngữ cảnh.
 *
 * iOS KHÔNG đọc file này: màn hình chính iOS mở trong Safari (vì layout cố tình
 * không bật `apple-mobile-web-app-capable`), nên iOS vẫn dùng popup và vẫn chạy.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FWBB - Friends with Beer & Badminton",
    short_name: "FWBB",
    description: "Ứng dụng quản lý nhóm cầu lông FWBB",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
