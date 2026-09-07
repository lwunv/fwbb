"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lockVoteNow, setVoteDeadline } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { parseVoteDeadline } from "@/lib/vote-deadline";

interface VoteLockButtonProps {
  sessionId: number;
  /**
   * Hạn vote hiện tại (ISO-local giờ VN). `null` = không có hạn, vote mở tới
   * khi admin tự khóa.
   */
  deadline: string | null;
}

/**
 * Toggle khóa/mở vote cho một buổi.
 *
 * - Vote đang mở → "Khóa vote": đặt hạn = bây giờ, đóng NGAY.
 * - Vote đang đóng → "Mở vote": XÓA hạn (`null`), vote mở lại vô hạn cho tới
 *   khi admin bấm khóa. Admin muốn có hạn mới thì dùng "Đặt deadline".
 *
 * Trước đây chỉ có chiều khóa, còn chiều mở nằm ẩn trong dialog "Đặt deadline"
 * → "Bỏ deadline", nên buổi quá hạn trông như không mở lại được.
 *
 * Nhãn flip NGAY khi bấm (optimistic, AGENTS.md bắt buộc): không chờ server thì
 * admin mạng chậm không bấm lần 2 vì tưởng chưa ăn — cú bấm thứ hai trên toggle
 * chạy chiều ngược, khóa xong lại tự mở. Server về (prop `deadline` đổi qua
 * revalidate) hoặc action lỗi thì bỏ override, quay lại sự thật từ server.
 *
 * Chỉ render ở buổi status voting/confirmed (buổi đã chốt sổ/hủy phải bấm "Mở
 * lại" trước để reverse giao dịch tài chính cũ); `setVoteDeadline` và
 * `lockVoteNow` đều còn guard `assertEditable` ở server.
 */
export function VoteLockButton({ sessionId, deadline }: VoteLockButtonProps) {
  const t = useTranslations("voting");
  // Init `false` (coi như đang mở) để SSR khớp lần hydrate đầu — cùng cách
  // VoteCountdown và AdminSessionCard làm. Effect chỉ chạy ở client mới flip.
  // Tick 1s để nhãn tự đổi sang "Mở vote" ngay lúc hạn qua, không cần reload.
  const [closed, setClosed] = useState(false);
  // Optimistic override sau cú bấm; `null` = theo `closed` tính từ prop.
  const [pendingClosed, setPendingClosed] = useState<boolean | null>(null);

  useEffect(() => {
    // Gộp vào hàm rồi gọi gián tiếp: eslint react-hooks/set-state-in-effect
    // chặn setState đặt thẳng trong thân effect.
    const sync = () =>
      setClosed(
        !!deadline && parseVoteDeadline(deadline).getTime() - Date.now() <= 0,
      );
    // Prop deadline đổi = server đã trả lời → bỏ override optimistic.
    const settle = () => setPendingClosed(null);
    settle();
    sync();
    if (!deadline) return;
    const id = setInterval(sync, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const displayClosed = pendingClosed ?? closed;

  const handleClick = () => {
    setPendingClosed(!displayClosed);
    // Rollback khi action lỗi (hết retry): bỏ override, nhãn quay về theo prop.
    const rollback = () => setPendingClosed(null);
    if (displayClosed) {
      fireAction(() => setVoteDeadline(sessionId, null), rollback, {
        successMsg: t("voteUnlockedToast"),
      });
      return;
    }
    fireAction(() => lockVoteNow(sessionId), rollback, {
      successMsg: t("voteLockedToast"),
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 gap-1.5"
      onClick={handleClick}
    >
      {displayClosed ? (
        <LockOpen className="h-4 w-4" />
      ) : (
        <Lock className="h-4 w-4" />
      )}
      {displayClosed ? t("voteUnlockNow") : t("voteLockNow")}
    </Button>
  );
}
