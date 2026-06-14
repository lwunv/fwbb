"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { countdownClock } from "@/lib/countdown";

interface VoteCountdownProps {
  /** ISO-local string (YYYY-MM-DDTHH:MM:SS). NULL = render nothing. */
  deadline: string | null;
  /**
   * banner = sticky pill on vote page. inline = single text line for lists.
   * card   = pill đặt BÊN TRONG thẻ buổi chơi (có icon đồng hồ).
   */
  variant: "banner" | "inline" | "card";
  /** Fires once when remaining time hits 0. Use to flip parent's isVotingOpen. */
  onExpired?: () => void;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export function VoteCountdown({
  deadline,
  variant,
  onExpired,
}: VoteCountdownProps) {
  const t = useTranslations("voting");
  // Init `null` (not Date.now()-based) so SSR and client hydration match.
  // First real value comes from the useEffect below, which only runs client-side.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      return;
    }
    let firedExpired = false;
    const update = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      setRemainingMs(ms);
      if (ms <= 0 && !firedExpired) {
        firedExpired = true;
        onExpired?.();
      }
    };
    update();
    // Tick mỗi giây → đồng hồ HH:MM:SS chạy theo giây.
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  if (!deadline) return null;
  // Pre-hydration: render nothing (avoids "flash of stale time"). The useEffect
  // sets remainingMs on the first client tick.
  if (remainingMs === null) return null;

  if (remainingMs <= 0) {
    const label = t("voteClosedLabel");
    if (variant === "inline") {
      return (
        <span className="text-destructive text-sm font-medium">{label}</span>
      );
    }
    if (variant === "card") {
      return (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold">
          <Timer className="h-4 w-4 shrink-0" aria-hidden />
          {label}
        </div>
      );
    }
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-center text-sm font-semibold">
        {label}
      </div>
    );
  }

  const { days, clock } = countdownClock(remainingMs);
  const text =
    days > 0
      ? t("voteCountdownLeftWithDays", { days, clock })
      : t("voteCountdownLeft", { clock });
  const urgent = remainingMs < ONE_HOUR_MS;

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "text-sm font-medium tabular-nums",
          urgent ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {text}
      </span>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold tabular-nums",
          urgent
            ? "border-destructive/30 bg-destructive/10 text-destructive animate-pulse"
            : "border-primary/30 bg-primary/10 text-primary",
        )}
      >
        <Timer className="h-4 w-4 shrink-0" aria-hidden />
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-center text-sm font-semibold tabular-nums backdrop-blur",
        urgent
          ? "border-destructive/30 bg-destructive/10 text-destructive animate-pulse"
          : "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {text}
    </div>
  );
}
