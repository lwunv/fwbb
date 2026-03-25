"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { submitVote } from "@/actions/votes";
import type { VoteTotalsPatch } from "@/lib/optimistic-votes";
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
    <div className="flex items-center gap-1.5 shrink-0">
      <span className={cn("text-xs whitespace-nowrap", labelCls)}>{label}</span>
      <div className={cn("inline-flex h-8 items-stretch overflow-hidden rounded-lg border bg-background", borderOuter)}>
        <button
          type="button"
          id={`${id}-dec`}
          aria-label="Giảm"
          disabled={disabled || value <= 0}
          onClick={(e) => {
            e.stopPropagation();
            set(value - 1);
          }}
          className={cn(
            "flex w-8 items-center justify-center border-r transition-colors disabled:opacity-40",
            borderSeg,
            stepBtn
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
            "w-9 min-w-0 border-0 bg-transparent py-0 text-center text-sm tabular-nums outline-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            inputCls
          )}
        />
        <button
          type="button"
          id={`${id}-inc`}
          aria-label="Tăng"
          disabled={disabled || value >= GUEST_MAX}
          onClick={(e) => {
            e.stopPropagation();
            set(value + 1);
          }}
          className={cn(
            "flex w-8 items-center justify-center border-l transition-colors disabled:opacity-40",
            borderSeg,
            stepBtn
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
  disabled = false,
  optimisticListSync,
}: VoteButtonsProps) {
  const [willPlay, setWillPlay] = useState(currentWillPlay);
  const [willDine, setWillDine] = useState(currentWillDine);
  const [guestPlayCount, setGuestPlayCount] = useState(currentGuestPlayCount);
  const [guestDineCount, setGuestDineCount] = useState(currentGuestDineCount);
  const [error, setError] = useState("");
  const t = useTranslations("voting");

  useEffect(() => {
    setWillPlay(currentWillPlay);
    setWillDine(currentWillDine);
    setGuestPlayCount(currentGuestPlayCount);
    setGuestDineCount(currentGuestDineCount);
  }, [currentWillPlay, currentWillDine, currentGuestPlayCount, currentGuestDineCount]);

  function fireVote(
    play: boolean,
    dine: boolean,
    guestPlay: number,
    guestDine: number,
    rollback: () => void,
  ) {
    optimisticListSync?.apply({
      willPlay: play,
      willDine: dine,
      guestPlayCount: guestPlay,
      guestDineCount: guestDine,
    });
    setError("");
    void submitVote(sessionId, play, dine, guestPlay, guestDine)
      .then((result) => {
        if (result.error) {
          rollback();
          optimisticListSync?.revert();
          setError(result.error);
        }
      })
      .catch(() => {
        rollback();
        optimisticListSync?.revert();
        setError("Không lưu được. Thử lại.");
      });
  }

  function togglePlay() {
    const newPlay = !willPlay;
    const prevPlay = willPlay;
    const prevGuestPlay = guestPlayCount;

    setWillPlay(newPlay);
    if (!newPlay) {
      setGuestPlayCount(0);
      fireVote(
        false,
        willDine,
        0,
        guestDineCount,
        () => {
          setWillPlay(prevPlay);
          setGuestPlayCount(prevGuestPlay);
        },
      );
    } else {
      fireVote(
        true,
        willDine,
        guestPlayCount,
        guestDineCount,
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
      fireVote(
        willPlay,
        false,
        guestPlayCount,
        0,
        () => {
          setWillDine(prevDine);
          setGuestDineCount(prevGuestDine);
        },
      );
    } else {
      fireVote(
        willPlay,
        true,
        guestPlayCount,
        guestDineCount,
        () => {
          setWillDine(prevDine);
          setGuestDineCount(prevGuestDine);
        },
      );
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/80 bg-muted/45 p-3 dark:bg-muted/25">
      {/* Card: Play */}
      <div
        className={cn(
          "rounded-xl border-2 overflow-hidden transition-[border-color,box-shadow,background-color] duration-150",
          willPlay
            ? "border-primary bg-primary/[0.07] dark:bg-primary/10"
            : "border-border/90 bg-background/80 hover:border-primary/45 hover:bg-primary/[0.04] dark:hover:border-primary/40 dark:hover:bg-primary/[0.06]"
        )}
      >
        <div
          className={cn(
            "flex flex-nowrap items-stretch min-w-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            disabled && "opacity-50"
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
              "flex min-w-0 flex-1 items-center gap-2 px-3.5 py-3.5 pr-2 text-left transition-all self-stretch rounded-none outline-none select-none",
              "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              !disabled && "cursor-pointer",
              disabled && "cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-all",
                willPlay
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40 bg-background"
              )}
            >
              {willPlay && <Check className="h-3.5 w-3.5" />}
            </div>
            <span className="text-xl leading-none shrink-0 select-none" aria-hidden>
              🏸
            </span>
            <span
              className={cn(
                "text-sm font-medium truncate",
                willPlay ? "text-primary" : "text-muted-foreground"
              )}
            >
              {t("play")}
            </span>
          </div>
          <div
            className="flex shrink-0 items-center py-3.5 pr-3.5 pl-1"
            data-guest-stepper
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
                fireVote(true, willDine, v, guestDineCount, () => setGuestPlayCount(prev));
              }}
            />
          </div>
        </div>
      </div>

      {/* Nhậu (Tăng 2): luôn theme cam — không dùng primary */}
      <div
        className={cn(
          "rounded-xl border-2 overflow-hidden transition-[border-color,box-shadow,background-color] duration-150",
          willDine
            ? "border-orange-500 bg-orange-500/[0.08] dark:bg-orange-950/25"
            : "border-border/90 bg-background/80 hover:border-orange-500/45 hover:bg-orange-500/[0.04] dark:hover:border-orange-400/35 dark:hover:bg-orange-500/[0.06]"
        )}
      >
        <div
          className={cn(
            "flex flex-nowrap items-stretch min-w-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            disabled && "opacity-50"
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
              "flex min-w-0 flex-1 items-center gap-2 px-3.5 py-3.5 pr-2 text-left transition-all self-stretch rounded-none outline-none select-none",
              "focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              !disabled && "cursor-pointer",
              disabled && "cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-all",
                willDine
                  ? "border-orange-500 bg-orange-500 text-white"
                  : "border-muted-foreground/40 bg-background"
              )}
            >
              {willDine && <Check className="h-3.5 w-3.5" />}
            </div>
            <span className="text-xl leading-none shrink-0 select-none" aria-hidden>
              🍺
            </span>
            <span
              className={cn(
                "text-sm font-medium truncate",
                willDine ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"
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
                fireVote(willPlay, true, guestPlayCount, v, () => setGuestDineCount(prev));
              }}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive pt-0.5">{error}</p>
      )}
    </div>
  );
}
