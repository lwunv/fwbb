"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lockVoteNow } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";

/**
 * Nút "Khóa vote": đặt hạn vote = bây giờ → đóng vote NGAY. Reversible qua
 * VoteDeadlineEdit (đặt lại hạn tương lai / clear). Không confirm vì "ngay lập
 * tức" + hoàn tác được; báo toast khi xong.
 */
export function VoteLockButton({ sessionId }: { sessionId: number }) {
  const t = useTranslations("voting");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 gap-1.5"
      onClick={() =>
        fireAction(() => lockVoteNow(sessionId), undefined, {
          successMsg: t("voteLockedToast"),
        })
      }
    >
      <Lock className="h-4 w-4" />
      {t("voteLockNow")}
    </Button>
  );
}
