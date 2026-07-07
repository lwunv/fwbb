import type { DriveStep } from "driver.js";

type T = (key: string) => string;

/**
 * Config các bước product tour. Step KHÔNG có `element` = popover canh giữa
 * (welcome / kết thúc). Step có `element` neo bằng `data-tour=...`. Hook lọc bỏ
 * step có element nhưng không tìm thấy trên trang (vd chưa có buổi vote / quỹ
 * đang dương nên banner ẩn) — step canh giữa luôn được giữ.
 */
export function buildTourSteps(t: T): DriveStep[] {
  const s = (title: string, description: string) => ({ title, description });
  return [
    // 1. Welcome (canh giữa)
    { popover: s(t("welcomeTitle"), t("welcomeDesc")) },
    // 2. Menu điều hướng (nút hamburger góc trái). Các mục Lịch sử / Quỹ /
    //    Thống kê / Cá nhân nằm trong ngăn kéo ĐÓNG nên driver không neo được
    //    từng mục — mô tả gộp tại chính nút mở menu.
    {
      element: '[data-tour="nav-menu"]',
      popover: s(t("navMenuTitle"), t("navMenuDesc")),
    },
    // 3. Chip chọn ngày trong tuần (đầu thẻ buổi).
    {
      element: '[data-tour="week-days"]',
      popover: s(t("weekDaysTitle"), t("weekDaysDesc")),
    },
    // 4-6. Vote (khi có buổi đang mở): chơi cầu → nhậu → đi 2 người. Mỗi step
    //    neo đúng ô tương ứng để mô tả rõ thao tác.
    {
      element: '[data-tour="vote-play"]',
      popover: s(t("votePlayTitle"), t("votePlayDesc")),
    },
    {
      element: '[data-tour="vote-dine"]',
      popover: s(t("voteDineTitle"), t("voteDineDesc")),
    },
    {
      element: '[data-tour="vote-partner"]',
      popover: s(t("votePartnerTitle"), t("votePartnerDesc")),
    },
    // 7-8. Quỹ (khi banner quỹ hiện).
    {
      element: '[data-tour="fund-banner"]',
      popover: s(t("fundBannerTitle"), t("fundBannerDesc")),
    },
    {
      element: '[data-tour="fund-topup"]',
      popover: s(t("fundTopupTitle"), t("fundTopupDesc")),
    },
    // Kết thúc (canh giữa)
    { popover: s(t("doneTitle"), t("doneDesc")) },
  ];
}
