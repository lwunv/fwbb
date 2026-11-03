import type { MetadataRoute } from "next";

/**
 * Web App Manifest: cái này cho Android/Chrome một icon tử tế khi "Thêm vào màn
 * hình chính", và tên nhãn dưới icon. (iOS lấy icon từ `apple-icon.png` và nhãn
 * từ `apple-mobile-web-app-title` ở layout, không đọc file này.)
 *
 * `display: "browser"` là CỐ Ý, không phải "standalone". Lý do giống chỗ layout
 * cố tình không bật `appleWebApp`: app đăng nhập bằng Facebook/Google, mà mở ở
 * chế độ standalone (không có thanh trình duyệt) hay làm đứt phiên OAuth vì cửa
 * sổ bật ra là một ngữ cảnh khác. "browser" nghĩa là bấm icon mở ra trình duyệt
 * bình thường, nhưng icon trên màn hình chính vẫn là logo. Đổi behavior chỉ để
 * có khung standalone là không đáng.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FWBB - Friends with Beer & Badminton",
    short_name: "FWBB",
    description: "Ứng dụng quản lý nhóm cầu lông FWBB",
    start_url: "/",
    scope: "/",
    display: "browser",
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
