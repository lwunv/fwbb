"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setSessionMaxPlayers } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { Users } from "lucide-react";

/**
 * Admin toggle sức chứa chơi cầu tối đa của buổi: 16 (mặc định) ⇄ 8. Optimistic
 * + rollback. Đặt cùng hàng với "Đặt deadline". Cap thực thi ở submitVote.
 */
export function MaxPlayersToggle({
  sessionId,
  current,
}: {
  sessionId: number;
  current: number;
}) {
  const t = useTranslations("voting");
  const [max, setMax] = useState(current);

  // Sync khi server revalidate (giống VoteDeadlineEdit).
  useEffect(() => {
    setMax(current);
  }, [current]);

  function toggle() {
    const next = max === 8 ? 16 : 8;
    const prev = max;
    setMax(next);
    fireAction(
      () => setSessionMaxPlayers(sessionId, next),
      () => setMax(prev),
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-pressed={max === 8}
      title={t("maxPlayersHint")}
      className="min-h-11 gap-1.5"
    >
      <Users className="h-4 w-4" />
      {t("maxPlayersLabel", { max })}
    </Button>
  );
}
