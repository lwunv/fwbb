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
    // 2-4. Vote (home, khi có buổi đang mở)
    {
      element: '[data-tour="vote-play"]',
      popover: s(t("votePlayTitle"), t("votePlayDesc")),
    },
    {
      element: '[data-tour="vote-partner"]',
      popover: s(t("votePartnerTitle"), t("votePartnerDesc")),
    },
    {
      element: '[data-tour="vote-guest"]',
      popover: s(t("voteGuestTitle"), t("voteGuestDesc")),
    },
    // 5-6. Quỹ (khi banner quỹ hiện)
    {
      element: '[data-tour="fund-banner"]',
      popover: s(t("fundBannerTitle"), t("fundBannerDesc")),
    },
    {
      element: '[data-tour="fund-topup"]',
      popover: s(t("fundTopupTitle"), t("fundTopupDesc")),
    },
    // 7-11. Thanh điều hướng dưới (luôn có)
    {
      element: '[data-tour="nav-home"]',
      popover: s(t("navHomeTitle"), t("navHomeDesc")),
    },
    {
      element: '[data-tour="nav-history"]',
      popover: s(t("navHistoryTitle"), t("navHistoryDesc")),
    },
    {
      element: '[data-tour="nav-fund"]',
      popover: s(t("navFundTitle"), t("navFundDesc")),
    },
    {
      element: '[data-tour="nav-stats"]',
      popover: s(t("navStatsTitle"), t("navStatsDesc")),
    },
    {
      element: '[data-tour="nav-me"]',
      popover: s(t("navMeTitle"), t("navMeDesc")),
    },
    // 12. Nút mở lại tour
    {
      element: '[data-tour="tour-launcher"]',
      popover: s(t("launcherTitle"), t("launcherDesc")),
    },
    // 13. Kết thúc (canh giữa)
    { popover: s(t("doneTitle"), t("doneDesc")) },
  ];
}
