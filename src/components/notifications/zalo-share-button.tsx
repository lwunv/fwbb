"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Soạn tin nhắc cho nhóm Zalo. Zalo không có API gửi tin vào nhóm, nên nút này
 * chỉ đưa sẵn nội dung: mở bảng chia sẻ của máy nếu có, không thì chép vào
 * clipboard rồi mở link nhóm (nếu admin đã cài) để dán.
 *
 * Link nhóm mở NGAY trong lượt bấm, trước mọi `await`: Safari và trình duyệt
 * trong Zalo/Messenger chặn `window.open` chạy sau một await (mất "user
 * gesture"). Lệnh chép được khởi động trước `window.open` để vẫn chạy khi
 * trang còn focus.
 */
export function ZaloShareButton({
  text,
  zaloGroupUrl,
  className,
}: {
  text: string;
  zaloGroupUrl: string;
  className?: string;
}) {
  const t = useTranslations("notifications.share");
  const [done, setDone] = useState(false);

  // Dấu tích chỉ báo vừa chép xong, sau 2 giây trả lại icon chia sẻ.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(id);
  }, [done]);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        setDone(true);
      } catch (err) {
        // Người dùng đóng bảng chia sẻ là hành vi bình thường, không phải lỗi.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          toast.error(t("copyFailed"));
        }
      }
      return;
    }
    let copied: Promise<void>;
    try {
      copied = navigator.clipboard.writeText(text);
    } catch {
      toast.error(t("copyFailed"));
      return;
    }
    if (zaloGroupUrl)
      window.open(zaloGroupUrl, "_blank", "noopener,noreferrer");
    try {
      await copied;
    } catch {
      toast.error(t("copyFailed"));
      return;
    }
    setDone(true);
    toast.success(t("copied"));
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void share()}
      className={className ?? "min-h-11"}
    >
      {done ? (
        <Check className="mr-1.5 h-4 w-4" aria-hidden />
      ) : (
        <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
      )}
      {t("label")}
    </Button>
  );
}
