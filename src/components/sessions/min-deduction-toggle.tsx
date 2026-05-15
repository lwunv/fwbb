"use client";

import { useState } from "react";
import { Shield, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { setSessionUseMinDeduction } from "@/actions/sessions";

/**
 * Toggle per-session bật rule "min 60K khi member thiếu quỹ".
 *
 * Khi ON, `finalizeSession` sẽ override `playAmount` của member nào balance
 * không đủ trả share AND share < 60K → trừ 60K. Admin có thể miễn từng
 * member trong AdminVoteManager.
 *
 * Optimistic UI: bấm xong update local state ngay, rollback nếu server fail.
 * Toggle disabled khi session không editable (completed/cancelled).
 */
export function MinDeductionToggle({
  sessionId,
  enabled,
  exemptCount = 0,
  disabled = false,
}: {
  sessionId: number;
  enabled: boolean;
  /** Số member đã được admin miễn (hiển thị badge). */
  exemptCount?: number;
  /** True khi session completed/cancelled — chặn toggle. */
  disabled?: boolean;
}) {
  const [localEnabled, setLocalEnabled] = useState(enabled);
  // Resync từ server khi prop đổi (post-revalidate).
  if (enabled !== localEnabled) {
    // pattern "adjust state on prop change" — tránh useEffect cascading
    setLocalEnabled(enabled);
  }

  function handleToggle() {
    if (disabled) return;
    const next = !localEnabled;
    const prev = localEnabled;
    setLocalEnabled(next);
    fireAction(
      () => setSessionUseMinDeduction(sessionId, next),
      () => setLocalEnabled(prev),
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-colors",
        localEnabled
          ? "border-primary/50 bg-primary/[0.06] hover:bg-primary/[0.1]"
          : "border-border bg-card hover:border-primary/30",
        disabled && "cursor-not-allowed opacity-60",
      )}
      aria-pressed={localEnabled}
      aria-label="Bật/tắt rule tối thiểu 60K cho member thiếu quỹ"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {localEnabled ? (
          <ShieldCheck className="text-primary h-5 w-5 shrink-0" />
        ) : (
          <Shield className="text-muted-foreground h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0">
          <div
            className={cn(
              "font-semibold",
              localEnabled ? "text-primary" : "text-foreground",
            )}
          >
            Tối thiểu 60K khi thiếu quỹ
          </div>
          <div className="text-muted-foreground text-xs">
            {localEnabled
              ? exemptCount > 0
                ? `Đang áp dụng · ${exemptCount} người được miễn`
                : "Đang áp dụng cho tất cả member"
              : "Tắt — chia per-head bình thường"}
          </div>
        </div>
      </div>
      <span
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
          localEnabled ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            localEnabled ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
