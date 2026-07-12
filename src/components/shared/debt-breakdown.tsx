"use client";

import { useTranslations } from "next-intl";
import { formatK } from "@/lib/utils";
import { cn } from "@/lib/utils";

export interface DebtBreakdownAmounts {
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  guestDineAmount: number;
}

interface DebtBreakdownProps {
  amounts: DebtBreakdownAmounts;
  /**
   * "vertical" — stacked rows, no emoji, neutral colors (default, suits
   *   preview cards in finalize-session wizard).
   * "inline" — flex-wrap, emoji + accent colors (suits compact debt-card
   *   expansion).
   */
  variant?: "vertical" | "inline";
  className?: string;
}

/**
 * Renders the 4 sub-amounts of a session debt (play / dine / guest-play /
 * guest-dine). Hides any line whose amount is 0 so the layout stays compact.
 *
 * Centralises the conditional rendering + label/i18n + format-K logic that
 * was duplicated in finalize-session preview and debt-card expansion. Adding
 * a new sub-amount only needs touching this file.
 */
export function DebtBreakdown({
  amounts,
  variant = "vertical",
  className,
}: DebtBreakdownProps) {
  const t = useTranslations("finalize");
  const { playAmount, dineAmount, guestPlayAmount, guestDineAmount } = amounts;
  const playClass = "text-primary";
  const dineClass = "text-orange-500 dark:text-orange-400";

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm",
          className,
        )}
      >
        {playAmount > 0 && (
          <span>
            🏸 {t("play")}:{" "}
            <strong className={playClass}>{formatK(playAmount)}</strong>
          </span>
        )}
        {dineAmount > 0 && (
          <span>
            🍻 {t("dine")}:{" "}
            <strong className={dineClass}>{formatK(dineAmount)}</strong>
          </span>
        )}
        {guestPlayAmount > 0 && (
          <span>
            🏸👤 {t("guestPlay")}:{" "}
            <strong className={playClass}>{formatK(guestPlayAmount)}</strong>
          </span>
        )}
        {guestDineAmount > 0 && (
          <span>
            🍻👤 {t("guestDine")}:{" "}
            <strong className={dineClass}>{formatK(guestDineAmount)}</strong>
          </span>
        )}
      </div>
    );
  }

  // vertical
  return (
    <div className={cn("text-muted-foreground space-y-0.5 text-sm", className)}>
      {playAmount > 0 && (
        <div>
          {t("play")}: {formatK(playAmount)}
        </div>
      )}
      {dineAmount > 0 && (
        <div>
          {t("dine")}: {formatK(dineAmount)}
        </div>
      )}
      {guestPlayAmount > 0 && (
        <div>
          {t("guestPlay")}: {formatK(guestPlayAmount)}
        </div>
      )}
      {guestDineAmount > 0 && (
        <div>
          {t("guestDine")}: {formatK(guestDineAmount)}
        </div>
      )}
    </div>
  );
}
