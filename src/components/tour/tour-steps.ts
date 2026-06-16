import type { DriveStep } from "driver.js";

type T = (key: string) => string;

/**
 * Config 6 bước product tour. Anchor bằng `data-tour=...` gắn element thật.
 * Hook lọc bỏ step không tìm thấy element trước khi chạy (tránh popover trỏ
 * vào hư không khi trang chưa có buổi vote / banner chưa expand).
 */
export function buildTourSteps(t: T): DriveStep[] {
  return [
    {
      element: '[data-tour="vote-play"]',
      popover: { title: t("votePlayTitle"), description: t("votePlayDesc") },
    },
    {
      element: '[data-tour="vote-partner"]',
      popover: {
        title: t("votePartnerTitle"),
        description: t("votePartnerDesc"),
      },
    },
    {
      element: '[data-tour="vote-guest"]',
      popover: { title: t("voteGuestTitle"), description: t("voteGuestDesc") },
    },
    {
      element: '[data-tour="fund-banner"]',
      popover: {
        title: t("fundBannerTitle"),
        description: t("fundBannerDesc"),
      },
    },
    {
      element: '[data-tour="fund-topup"]',
      popover: { title: t("fundTopupTitle"), description: t("fundTopupDesc") },
    },
    {
      element: '[data-tour="nav-fund"]',
      popover: { title: t("navTitle"), description: t("navDesc") },
    },
  ];
}
