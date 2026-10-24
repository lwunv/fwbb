"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Tự tải lại dữ liệu trang bằng `router.refresh()` theo nhịp.
 *
 * Hai điều quan trọng, cả hai đều là bài học từ sự cố 24/10/2026 (hạn mức đọc
 * của Turso cháy, cả web sập):
 *
 * 1. **Tab bị ẩn thì DỪNG HẲN.** Đây mới là thứ đốt hạn mức: một tab quản lý
 *    mở rồi quên, nằm dưới cùng cả ngày, vẫn gọi server đều đặn. Người không
 *    nhìn thì không có gì để làm mới. Lúc quay lại tab, làm mới NGAY một lần
 *    rồi mới chạy nhịp tiếp, nên nhìn vào vẫn thấy số mới.
 *
 * 2. **Nhịp mặc định 30 giây, không phải 5.** Mỗi lần làm mới là server dựng
 *    lại trang và đọc lại database; màn quản lý thành viên tốn hơn 1.400 dòng
 *    một lượt. 5 giây một lần là hơn một triệu dòng mỗi giờ cho MỘT tab. Thao
 *    tác của chính người dùng vốn đã cập nhật tức thì (optimistic), nhịp này
 *    chỉ để thấy việc NGƯỜI KHÁC vừa làm, 30 giây là quá đủ cho một nhóm cầu
 *    lông.
 *
 * @param intervalMs nhịp làm mới, mặc định 30000ms.
 */
export function usePolling(intervalMs = 30_000) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer === null) {
        timer = setInterval(() => router.refresh(), intervalMs);
      }
    };

    const sync = () => {
      // `document` có thể chưa có ở lần chạy đầu trên môi trường lạ; coi như
      // đang hiện để không vô tình tắt hẳn tính năng.
      const hidden =
        typeof document !== "undefined" &&
        document.visibilityState === "hidden";
      if (hidden) {
        stop();
        return;
      }
      start();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Quay lại tab: làm mới ngay, đừng bắt chờ hết một nhịp.
        router.refresh();
      }
      sync();
    };

    sync();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs]);
}
