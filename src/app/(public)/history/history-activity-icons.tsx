"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type HistoryActivityKind = "play" | "dine";

export interface HistoryDebtLite {
  playAmount: number;
  dineAmount: number;
  totalAmount: number;
  memberConfirmed: boolean;
  adminConfirmed: boolean;
}

interface HistoryActivityIconsProps {
  attendsPlay: boolean;
  attendsDine: boolean;
  onIconClick: (kind: HistoryActivityKind) => void;
}

export function HistoryActivityIcons({
  attendsPlay,
  attendsDine,
  onIconClick,
}: HistoryActivityIconsProps) {
  const t = useTranslations("history");

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onIconClick("play");
        }}
        className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-lg leading-none transition-all hover:opacity-90 active:scale-[0.98]",
          attendsPlay
            ? "border-[var(--color-hist-play-border)] bg-[var(--color-hist-play-icon-bg)] text-[var(--color-hist-play-fg)]"
            : "border-transparent bg-muted/80 text-muted-foreground opacity-45",
        )}
        aria-label={t("ariaPlay")}
      >
        🏸
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onIconClick("dine");
        }}
        className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-lg leading-none transition-all hover:opacity-90 active:scale-[0.98]",
          attendsDine
            ? "border-[var(--color-hist-dine-border)] bg-[var(--color-hist-dine-icon-bg)] text-[var(--color-hist-dine-fg)]"
            : "border-transparent bg-muted/80 text-muted-foreground opacity-45",
        )}
        aria-label={t("ariaDine")}
      >
        🍻
      </button>
    </>
  );
}
