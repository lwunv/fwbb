"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fireAction } from "@/lib/optimistic-action";
import { requestGroupMembership } from "@/actions/member-approval";

/**
 * Nút "Xin vào nhóm" dùng chung (trang /giao-luu và màn của tài khoản giao lưu
 * ở trang nhóm). Optimistic: bấm là đổi ngay sang "Đã gửi"; server từ chối thì
 * `fireAction` trả nút về và báo lỗi.
 */
export function JoinGroupButton({ className }: { className?: string }) {
  const t = useTranslations("exchange");
  const router = useRouter();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p
        role="status"
        className="bg-muted text-muted-foreground flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium"
      >
        <Check className="h-5 w-5" aria-hidden />
        {t("joinGroupSent")}
      </p>
    );
  }

  return (
    <Button
      type="button"
      className={className ?? "min-h-11 w-full text-base"}
      onClick={() => {
        setSent(true);
        fireAction(
          () => requestGroupMembership(),
          () => setSent(false),
          { onSuccess: () => router.refresh() },
        );
      }}
    >
      <UsersRound className="h-5 w-5" aria-hidden />
      {t("joinGroup")}
    </Button>
  );
}
