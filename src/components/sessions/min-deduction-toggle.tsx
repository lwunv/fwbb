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
 * member qua icon shield trong AdminVoteManager.
 *
 * Compact 1-line layout — render bên trong AdminVoteManager body. Optimistic
 * UI với prev-prop tracking để không stomp local state khi revalidate trễ.
 */
export function MinDeductionToggle({
  sessionId,
  enabled,
  exemptCount = 0,
  disabled = false,
}: {
  sessionId: number;
  enabled: boolean;
  /** Số member đã được admin miễn (hiển thị inline). */
  exemptCount?: number;
  /** True khi session completed/cancelled — chặn toggle. */
  disabled?: boolean;
}) {
  const [localEnabled, setLocalEnabled] = useState(enabled);
  // Resync local state CHỈ khi server prop đổi (prev-prop tracking).
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
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
        "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
        localEnabled
          ? "border-primary/40 bg-primary/[0.06] hover:bg-primary/[0.1]"
          : "border-border bg-card/60 hover:border-primary/30",
        disabled && "cursor-not-allowed opacity-60",
      )}
      aria-pressed={localEnabled}
      aria-label="Bật/tắt rule tối thiểu 60K cho member thiếu quỹ"
    >
      {localEnabled ? (
        <ShieldCheck className="text-primary h-4 w-4 shrink-0" />
      ) : (
        <Shield className="text-muted-foreground h-4 w-4 shrink-0" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left font-medium",
          localEnabled ? "text-primary" : "text-foreground/80",
        )}
      >
        Tối thiểu 60K khi thiếu quỹ
        {localEnabled && exemptCount > 0 && (
          <span className="text-muted-foreground ml-1 font-normal">
            · miễn {exemptCount}
          </span>
        )}
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          localEnabled ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
            localEnabled ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </span>
    </button>
  );
}
