"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { submitVote } from "@/actions/votes";
import { cn } from "@/lib/utils";
import { Volleyball, UtensilsCrossed, Check } from "lucide-react";

interface VoteButtonsProps {
  sessionId: number;
  currentWillPlay: boolean;
  currentWillDine: boolean;
  currentGuestPlayCount: number;
  currentGuestDineCount: number;
  disabled?: boolean;
}

export function VoteButtons({
  sessionId,
  currentWillPlay,
  currentWillDine,
  currentGuestPlayCount,
  currentGuestDineCount,
  disabled = false,
}: VoteButtonsProps) {
  const [willPlay, setWillPlay] = useState(currentWillPlay);
  const [willDine, setWillDine] = useState(currentWillDine);
  const [guestPlayCount, setGuestPlayCount] = useState(currentGuestPlayCount);
  const [guestDineCount, setGuestDineCount] = useState(currentGuestDineCount);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const t = useTranslations("voting");

  function doSubmit(
    play: boolean,
    dine: boolean,
    guestPlay: number,
    guestDine: number,
  ) {
    startTransition(async () => {
      setError("");
      const result = await submitVote(sessionId, play, dine, guestPlay, guestDine);
      if (result.error) {
        setError(result.error);
      }
    });
  }

  function togglePlay() {
    const newPlay = !willPlay;
    setWillPlay(newPlay);
    if (!newPlay) {
      setGuestPlayCount(0);
      doSubmit(newPlay, willDine, 0, guestDineCount);
    } else {
      doSubmit(newPlay, willDine, guestPlayCount, guestDineCount);
    }
  }

  function toggleDine() {
    const newDine = !willDine;
    setWillDine(newDine);
    if (!newDine) {
      setGuestDineCount(0);
      doSubmit(willPlay, newDine, guestPlayCount, 0);
    } else {
      doSubmit(willPlay, newDine, guestPlayCount, guestDineCount);
    }
  }

  return (
    <div className="space-y-3">
      {/* Checkbox card: Play */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled || isPending}
        className={cn(
          "w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all",
          willPlay
            ? "border-primary bg-primary/10"
            : "border-border bg-background hover:bg-accent",
          (disabled || isPending) && "opacity-50 cursor-not-allowed"
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
        <Volleyball className={cn("h-5 w-5 flex-shrink-0", willPlay ? "text-primary" : "text-muted-foreground")} />
        <span className={cn("text-sm font-medium", willPlay ? "text-primary" : "text-muted-foreground")}>
          {t("play")}
        </span>
      </button>

      {/* Guest count for play */}
      {willPlay && (
        <div className="flex items-center gap-2 pl-12 text-sm">
          <label className="text-muted-foreground whitespace-nowrap">
            {t("guestPlay")}:
          </label>
          <select
            value={guestPlayCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setGuestPlayCount(v);
              doSubmit(willPlay, willDine, v, guestDineCount);
            }}
            disabled={disabled || isPending}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      {/* Checkbox card: Dine */}
      <button
        type="button"
        onClick={toggleDine}
        disabled={disabled || isPending}
        className={cn(
          "w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all",
          willDine
            ? "border-orange-500 bg-orange-500/10"
            : "border-border bg-background hover:bg-accent",
          (disabled || isPending) && "opacity-50 cursor-not-allowed"
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
        <UtensilsCrossed className={cn("h-5 w-5 flex-shrink-0", willDine ? "text-orange-600" : "text-muted-foreground")} />
        <span className={cn("text-sm font-medium", willDine ? "text-orange-600" : "text-muted-foreground")}>
          {t("dine")}
        </span>
      </button>

      {/* Guest count for dine */}
      {willDine && (
        <div className="flex items-center gap-2 pl-12 text-sm">
          <label className="text-muted-foreground whitespace-nowrap">
            {t("guestDine")}:
          </label>
          <select
            value={guestDineCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setGuestDineCount(v);
              doSubmit(willPlay, willDine, guestPlayCount, v);
            }}
            disabled={disabled || isPending}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
