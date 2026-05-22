"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface VoteCountdownProps {
  /** ISO-local string (YYYY-MM-DDTHH:MM:SS). NULL = render nothing. */
  deadline: string | null;
  /** banner = sticky card on vote page. inline = single text line for cards/lists. */
  variant: "banner" | "inline";
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
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  if (!deadline) return null;
  // Pre-hydration: render nothing (avoids "flash of stale time"). The useEffect
  // sets remainingMs on the first client tick.
  if (remainingMs === null) return null;

  if (remainingMs <= 0) {
    if (variant === "banner") {
      return (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-center text-sm font-semibold">
          {t("voteClosedLabel")}
        </div>
      );
    }
    return (
      <span className="text-destructive text-sm font-medium">
        {t("voteClosedLabel")}
      </span>
    );
  }

  const ms = remainingMs;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000) % 24;
  const days = Math.floor(ms / 86_400_000);

  let text: string;
  if (days > 0) {
    text = t("voteCountdownDays", { days, hours });
  } else if (hours > 0) {
    text = t("voteCountdownHours", { hours, minutes });
  } else {
    text = t("voteCountdownMinutes", { minutes, seconds });
  }

  const urgent = ms < ONE_HOUR_MS;

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
