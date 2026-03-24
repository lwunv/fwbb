"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { submitVote } from "@/actions/votes";
import { cn } from "@/lib/utils";
import { Volleyball, UtensilsCrossed } from "lucide-react";

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
    doSubmit(newPlay, willDine, guestPlayCount, guestDineCount);
  }

  function toggleDine() {
    const newDine = !willDine;
    setWillDine(newDine);
    doSubmit(willPlay, newDine, guestPlayCount, guestDineCount);
  }

  return (
    <div className="space-y-4">
      {/* Toggle buttons */}
      <div className="flex gap-3">
        <button
          onClick={togglePlay}
          disabled={disabled || isPending}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 text-sm font-medium transition-all",
            willPlay
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-accent",
            (disabled || isPending) && "opacity-50 cursor-not-allowed"
          )}
        >
          <Volleyball className="h-5 w-5" />
          <span>{willPlay ? t("willPlay") : t("play")}</span>
        </button>

        <button
          onClick={toggleDine}
          disabled={disabled || isPending}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 text-sm font-medium transition-all",
            willDine
              ? "border-orange-500 bg-orange-500/10 text-orange-600"
              : "border-border bg-background text-muted-foreground hover:bg-accent",
            (disabled || isPending) && "opacity-50 cursor-not-allowed"
          )}
        >
          <UtensilsCrossed className="h-5 w-5" />
          <span>{willDine ? t("willDine") : t("dine")}</span>
        </button>
      </div>

      {/* Guest form (inline, only show when playing or dining) */}
      {(willPlay || willDine) && (
        <div className="flex gap-3 text-sm">
          {willPlay && (
            <div className="flex items-center gap-2 flex-1">
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
          {willDine && (
            <div className="flex items-center gap-2 flex-1">
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
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
