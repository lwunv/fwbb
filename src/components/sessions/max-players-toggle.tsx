"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { setSessionMaxPlayers } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";

/**
 * Admin chọn sức chứa chơi cầu tối đa của buổi từ danh sách mức (setting
 * `maxPlayersOptions`). Optimistic + rollback. Cap thực thi ở submitVote.
 */
export function MaxPlayersToggle({
  sessionId,
  current,
  options = [8, 12, 16, 20],
}: {
  sessionId: number;
  current: number;
  /** Các mức bấm nhanh (setting `maxPlayersOptions`). Mặc định khớp registry
   *  khi nơi gọi chưa truyền xuống. */
  options?: number[];
}) {
  const t = useTranslations("voting");
  const [max, setMax] = useState(current);

  // Sync khi server revalidate.
  useEffect(() => {
    setMax(current);
  }, [current]);

  function pick(next: number) {
    if (next === max) return;
    const prev = max;
    setMax(next);
    fireAction(
      () => setSessionMaxPlayers(sessionId, next),
      () => setMax(prev),
    );
  }

  // Mức hiện tại có thể không nằm trong danh sách gợi ý → vẫn hiện nó để chọn lại.
  const shown = options.includes(max)
    ? options
    : [...options, max].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap gap-1.5" title={t("maxPlayersHint")}>
      {shown.map((n) => (
        <Button
          key={n}
          type="button"
          variant={n === max ? "default" : "outline"}
          size="sm"
          onClick={() => pick(n)}
          aria-pressed={n === max}
          className="min-h-11 min-w-11"
        >
          {n}
        </Button>
      ))}
    </div>
  );
}
