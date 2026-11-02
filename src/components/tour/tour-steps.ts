import type { Popover } from "driver.js";

type T = (key: string) => string;

/**
 * 1 bước tour. Hook (`use-product-tour`) quyết định neo vào đâu:
 *   - không có `element` → popover canh giữa (welcome / kết thúc).
 *   - `element` có trên trang → neo vào đó; không có → thử lần lượt `fallback`.
 *   - vẫn không có: `centerIfMissing` → hiện canh giữa (mô tả vẫn đọc hiểu được
 *     khi không có gì để chỉ), ngược lại bỏ step.
 *   - `inDrawer` → element nằm trong ngăn kéo menu ĐANG ĐÓNG: luôn giữ step,
 *     hook mở ngăn kéo trước khi tới step đó.
 */
export interface TourStep {
  element?: string;
  fallback?: string[];
  centerIfMissing?: boolean;
  inDrawer?: boolean;
  popover: Popover;
}

const sel = (key: string) => `[data-tour="${key}"]`;

export function buildTourSteps(t: T): TourStep[] {
  const s = (title: string, description: string) => ({ title, description });
  return [
    { popover: s(t("welcomeTitle"), t("welcomeDesc")) },
    // Buổi chơi: chọn ngày → sân/chỉ đường.
    {
      element: sel("week-days"),
      popover: s(t("weekDaysTitle"), t("weekDaysDesc")),
    },
    {
      element: sel("session-court"),
      popover: s(t("sessionCourtTitle"), t("sessionCourtDesc")),
    },
    // Vote. Người mới vào lần đầu chưa tick chơi cầu nên switch 👫 chưa hiện →
    // neo tạm vào ô cầu; chưa có buổi mở vote thì vẫn giải thích canh giữa.
    {
      element: sel("vote-play"),
      centerIfMissing: true,
      popover: s(t("votePlayTitle"), t("votePlayDesc")),
    },
    {
      element: sel("vote-partner"),
      fallback: [sel("vote-play")],
      centerIfMissing: true,
      popover: s(t("votePartnerTitle"), t("votePartnerDesc")),
    },
    {
      element: sel("vote-dine"),
      centerIfMissing: true,
      popover: s(t("voteDineTitle"), t("voteDineDesc")),
    },
    {
      element: sel("vote-list"),
      popover: s(t("voteListTitle"), t("voteListDesc")),
    },
    // Quỹ (banner chỉ hiện khi hết quỹ / đang nợ; khung QR chỉ có khi mở banner).
    {
      element: sel("fund-banner"),
      popover: s(t("fundBannerTitle"), t("fundBannerDesc")),
    },
    {
      element: sel("fund-topup"),
      popover: s(t("fundTopupTitle"), t("fundTopupDesc")),
    },
    // Header: ngôn ngữ + giao diện, rồi nút menu.
    {
      element: sel("header-prefs"),
      popover: s(t("headerPrefsTitle"), t("headerPrefsDesc")),
    },
    {
      element: sel("nav-menu"),
      popover: s(t("navMenuTitle"), t("navMenuDesc")),
    },
    // Từng mục trong ngăn kéo menu (tour tự mở ngăn kéo).
    {
      element: sel("nav-history"),
      inDrawer: true,
      popover: s(t("navHistoryTitle"), t("navHistoryDesc")),
    },
    {
      element: sel("nav-fund"),
      inDrawer: true,
      popover: s(t("navFundTitle"), t("navFundDesc")),
    },
    {
      element: sel("nav-stats"),
      inDrawer: true,
      popover: s(t("navStatsTitle"), t("navStatsDesc")),
    },
    {
      element: sel("nav-me"),
      inDrawer: true,
      popover: s(t("navMeTitle"), t("navMeDesc")),
    },
    {
      element: sel("nav-guide"),
      inDrawer: true,
      popover: s(t("navGuideTitle"), t("navGuideDesc")),
    },
    { popover: s(t("doneTitle"), t("doneDesc")) },
  ];
}
