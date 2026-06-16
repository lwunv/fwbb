"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { submitVote } from "@/actions/votes";
import type { VoteTotalsPatch } from "@/lib/optimistic-votes";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";
import { Check, Minus, Plus } from "lucide-react";

const GUEST_MAX = 5;

function GuestStepper({
  id,
  label,
  value,
  disabled,
  onCommit,
  accent,
}: {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (next: number) => void;
  accent: "primary" | "orange";
}) {
  const tc = useTranslations("common");
  const isPrimary = accent === "primary";
  const labelCls = isPrimary
    ? "text-primary/85"
    : "text-orange-600/90 dark:text-orange-400/90";
  const stepBtn = isPrimary
    ? "text-primary hover:bg-primary/10"
    : "text-orange-600 hover:bg-orange-500/10 dark:text-orange-400";
  const borderOuter = isPrimary ? "border-primary/25" : "border-orange-500/35";
  const borderSeg = isPrimary ? "border-primary/20" : "border-orange-500/25";
  const inputCls = isPrimary
    ? "text-primary"
    : "text-orange-600 dark:text-orange-400";

  function set(next: number) {
    const v = Math.max(0, Math.min(GUEST_MAX, next));
    if (v !== value) onCommit(v);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className={cn("text-sm whitespace-nowrap", labelCls)}>{label}</span>
      <div
        className={cn(
          "bg-background inline-flex h-11 items-stretch overflow-hidden rounded-xl border",
          borderOuter,
        )}
      >
        <button
          type="button"
          id={`${id}-dec`}
          aria-label={tc("decrease")}
          disabled={disabled || value <= 0}
          onClick={(e) => {
            e.stopPropagation();
            set(value - 1);
          }}
          className={cn(
            "flex w-11 items-center justify-center border-r transition-colors disabled:opacity-40",
            borderSeg,
            stepBtn,
          )}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id={id}
          type="number"
          min={0}
          max={GUEST_MAX}
          value={value}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            if (Number.isNaN(raw)) return;
            set(raw);
          }}
          className={cn(
            "w-11 min-w-0 [appearance:textfield] border-0 bg-transparent py-0 text-center text-base font-semibold tabular-nums outline-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            inputCls,
          )}
        />
        <button
          type="button"
          id={`${id}-inc`}
          aria-label={tc("increase")}
          disabled={disabled || value >= GUEST_MAX}
          onClick={(e) => {
            e.stopPropagation();
            set(value + 1);
          }}
          className={cn(
            "flex w-11 items-center justify-center border-l transition-colors disabled:opacity-40",
            borderSeg,
            stepBtn,
          )}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

interface VoteButtonsProps {
  sessionId: number;
  currentWillPlay: boolean;
  currentWillDine: boolean;
  currentGuestPlayCount: number;
  currentGuestDineCount: number;
  currentWithPartner: boolean;
  disabled?: boolean;
  /** Đồng bộ danh sách/số liệu UI ngay lập tức; revert khi API lỗi */
  optimisticListSync?: {
    apply: (patch: VoteTotalsPatch) => void;
    revert: () => void;
  };
}

export function VoteButtons({
  sessionId,
  currentWillPlay,
  currentWillDine,
  currentGuestPlayCount,
  currentGuestDineCount,
  currentWithPartner,
  disabled = false,
  optimisticListSync,
}: VoteButtonsProps) {
  const [willPlay, setWillPlay] = useState(currentWillPlay);
  const [willDine, setWillDine] = useState(currentWillDine);
  const [guestPlayCount, setGuestPlayCount] = useState(currentGuestPlayCount);
  const [guestDineCount, setGuestDineCount] = useState(currentGuestDineCount);
  const [withPartner, setWithPartner] = useState(currentWithPartner);
  const t = useTranslations("voting");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic controls must resync when server props revalidate.
    setWillPlay(currentWillPlay);
    setWillDine(currentWillDine);
    setGuestPlayCount(currentGuestPlayCount);
    setGuestDineCount(currentGuestDineCount);
    setWithPartner(currentWithPartner);
  }, [
    currentWillPlay,
    currentWillDine,
    currentGuestPlayCount,
    currentGuestDineCount,
    currentWithPartner,
  ]);

  function fireVote(
    play: boolean,
    dine: boolean,
    guestPlay: number,
    guestDine: number,
    partner: boolean,
    rollback: () => void,
  ) {
    optimisticListSync?.apply({
      willPlay: play,
      willDine: dine,
      guestPlayCount: guestPlay,
      guestDineCount: guestDine,
      withPartner: partner,
    });
    // Canonical optimistic helper: auto-retry once, then roll back BOTH the
    // local controls and the mirrored list + toast.error (project rule). The
    // server's localized error message is surfaced via the toast.
    fireAction(
      () => submitVote(sessionId, play, dine, guestPlay, guestDine, partner),
      () => {
        rollback();
        optimisticListSync?.revert();
      },
    );
  }

  function togglePlay() {
    const newPlay = !willPlay;
    const prevPlay = willPlay;
    const prevGuestPlay = guestPlayCount;

    setWillPlay(newPlay);
    if (!newPlay) {
      setGuestPlayCount(0);
      fireVote(false, willDine, 0, guestDineCount, withPartner, () => {
        setWillPlay(prevPlay);
        setGuestPlayCount(prevGuestPlay);
      });
    } else {
      fireVote(
        true,
        willDine,
        guestPlayCount,
        guestDineCount,
        withPartner,
        () => {
          setWillPlay(prevPlay);
          setGuestPlayCount(prevGuestPlay);
        },
      );
    }
  }

  function toggleDine() {
    const newDine = !willDine;
    const prevDine = willDine;
    const prevGuestDine = guestDineCount;

    setWillDine(newDine);
    if (!newDine) {
      setGuestDineCount(0);
      fireVote(willPlay, false, guestPlayCount, 0, withPartner, () => {
        setWillDine(prevDine);
        setGuestDineCount(prevGuestDine);
      });
    } else {
      fireVote(
        willPlay,
        true,
        guestPlayCount,
        guestDineCount,
        withPartner,
        () => {
          setWillDine(prevDine);
          setGuestDineCount(prevGuestDine);
        },
      );
    }
  }

  function togglePartner() {
    const next = !withPartner;
    const prev = withPartner;
    setWithPartner(next);
    fireVote(willPlay, willDine, guestPlayCount, guestDineCount, next, () =>
      setWithPartner(prev),
    );
  }

  return (
    // Bỏ wrapper card-in-card (trước đây bao thêm 1 lớp border + bg-muted)
    // → giảm visual clutter (3 lớp border xuống còn 2: Card ngoài + viền item).
    <div className="space-y-3">
      <button
        type="button"
        data-tour="vote-partner"
        onClick={togglePartner}
        aria-pressed={withPartner}
        className={cn(
          "flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border-2 px-3.5 py-3 text-left transition-colors",
          withPartner
            ? "border-primary bg-primary/[0.07]"
            : "border-border/90 bg-background/80 hover:border-primary/45",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="text-xl leading-none" aria-hidden>
            👫
          </span>
          <span
            className={cn(
              "text-sm font-medium",
              withPartner ? "text-primary" : "text-muted-foreground",
            )}
          >
            {t("withPartner")}
          </span>
        </span>
        <span
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
            withPartner ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
              withPartner ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </span>
      </button>

      {/* Card: Play */}
      <div
        data-tour="vote-play"
        className={cn(
          "overflow-hidden rounded-xl border-2 transition-[border-color,box-shadow,background-color] duration-150",
          willPlay
            ? "border-primary bg-primary/[0.07] dark:bg-primary/10"
            : "border-border/90 bg-background/80 hover:border-primary/45 hover:bg-primary/[0.04] dark:hover:border-primary/40 dark:hover:bg-primary/[0.06]",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-nowrap items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            disabled && "opacity-50",
          )}
        >
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-pressed={willPlay}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) togglePlay();
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                togglePlay();
              }
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-none px-3.5 py-3.5 pr-2 text-left transition-all outline-none select-none",
              "focus-visible:ring-primary focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
              !disabled && "cursor-pointer",
              disabled && "cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all",
                willPlay
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40 bg-background",
              )}
            >
              {willPlay && <Check className="h-4 w-4" />}
            </div>
            <span
              className="shrink-0 text-xl leading-none select-none"
              aria-hidden
            >
              🏸
            </span>
            <span
              className={cn(
                "truncate text-sm font-medium",
                willPlay ? "text-primary" : "text-muted-foreground",
              )}
            >
              {t("play")}
            </span>
          </div>
          <div
            className="flex shrink-0 items-center py-3.5 pr-3.5 pl-1"
            data-guest-stepper
            data-tour="vote-guest"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <GuestStepper
              id={`guest-play-${sessionId}`}
              label={t("guestPlay")}
              value={willPlay ? guestPlayCount : 0}
              disabled={disabled || !willPlay}
              accent="primary"
              onCommit={(v) => {
                if (!willPlay) return;
                const prev = guestPlayCount;
                setGuestPlayCount(v);
                fireVote(true, willDine, v, guestDineCount, withPartner, () =>
                  setGuestPlayCount(prev),
                );
              }}
            />
          </div>
        </div>
      </div>

      {/* Nhậu (Tăng 2): luôn theme cam — không dùng primary */}
      <div
        className={cn(
          "overflow-hidden rounded-xl border-2 transition-[border-color,box-shadow,background-color] duration-150",
          willDine
            ? "border-orange-500 bg-orange-500/[0.08] dark:bg-orange-950/25"
            : "border-border/90 bg-background/80 hover:border-orange-500/45 hover:bg-orange-500/[0.04] dark:hover:border-orange-400/35 dark:hover:bg-orange-500/[0.06]",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-nowrap items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            disabled && "opacity-50",
          )}
        >
          <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-pressed={willDine}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) toggleDine();
            }}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleDine();
              }
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-none px-3.5 py-3.5 pr-2 text-left transition-all outline-none select-none",
              "focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2",
              !disabled && "cursor-pointer",
              disabled && "cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all",
                willDine
                  ? "border-orange-500 bg-orange-500 text-white"
                  : "border-muted-foreground/40 bg-background",
              )}
            >
              {willDine && <Check className="h-4 w-4" />}
            </div>
            <span
              className="shrink-0 text-xl leading-none select-none"
              aria-hidden
            >
              🍺
            </span>
            <span
              className={cn(
                "truncate text-sm font-medium",
                willDine
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-muted-foreground",
              )}
            >
              {t("dine")}
            </span>
          </div>
          <div
            className="flex shrink-0 items-center py-3.5 pr-3.5 pl-1"
            data-guest-stepper
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <GuestStepper
              id={`guest-dine-${sessionId}`}
              label={t("guestDine")}
              value={willDine ? guestDineCount : 0}
              disabled={disabled || !willDine}
              accent="orange"
              onCommit={(v) => {
                if (!willDine) return;
                const prev = guestDineCount;
                setGuestDineCount(v);
                fireVote(willPlay, true, guestPlayCount, v, withPartner, () =>
                  setGuestDineCount(prev),
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
