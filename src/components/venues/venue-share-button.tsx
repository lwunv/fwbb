"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Share2 } from "lucide-react";
import { shareOrCopy } from "@/lib/share-link";

/**
 * Nút chia sẻ link trang sân, cùng cách báo như thẻ xem nhanh. Dưới `md:` chỉ
 * có icon 44px (thanh dính đáy), từ `md:` hiện thêm chữ (hàng nút); chữ luôn
 * nằm trong DOM nên tên của nút vẫn là "Chia sẻ".
 */
export function VenueShareButton({
  venueId,
  name,
}: {
  venueId: number;
  name: string;
}) {
  const t = useTranslations("venues");

  async function handleShare() {
    const result = await shareOrCopy({
      title: name,
      url: `${window.location.origin}/venues/${venueId}`,
    });
    if (result === "copied") toast.success(t("shareCopied"));
    else if (result === "failed") toast.error(t("shareFailed"));
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="bg-secondary text-secondary-foreground inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-xl text-base font-medium active:scale-95 md:w-auto md:px-4"
    >
      <Share2 className="size-5" aria-hidden />
      <span className="sr-only md:not-sr-only">{t("share")}</span>
    </button>
  );
}
