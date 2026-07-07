"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { submitVote } from "@/actions/votes";
import type { VoteTotalsPatch } from "@/lib/optimistic-votes";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/** Switch nhỏ (track + knob) tái dùng cho "2 mình" và nút Nhậu. */
function MiniToggle({
  on,
  accent = "primary",
}: {
  on: boolean;
  accent?: "primary" | "orange";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        on
          ? accent === "orange"
            ? "bg-orange-500"
            : "bg-primary"
          : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

interface VoteButtonsProps {
  sessionId: number;
  currentWillPlay: boolean;
  currentWillDine: boolean;
  currentWithPartner: boolean;
  disabled?: boolean;
  /** Đủ 16 người chơi cầu → chặn bật vote cầu MỚI (vẫn cho bỏ nếu đang đi). */
  playFull?: boolean;
  /** Tiêu đề nhỏ phía trên cụm nút. */
  title?: string;
  /** Đồng bộ danh sách/số liệu UI ngay lập tức; revert khi API lỗi */
  optimisticListSync?: {
    apply: (patch: VoteTotalsPatch) => void;
    revert: () => void;
  };
}

/**
 * Cụm vote gọn cho mobile — BẤM CẢ NÚT để toggle:
 *  - "Chơi cầu": nút lớn (chiếm phần lớn width), bấm bất kỳ đâu = bật/tắt đi cầu.
 *    Switch "2 mình" (đi 2 người) nằm gọn bên phải TRONG nút, chỉ hiện khi đã
 *    chọn đi cầu; bấm switch không toggle cầu.
 *  - "Nhậu": switch button gọn bên phải.
 * Khách của member đã bỏ (giờ chỉ admin thêm khách) → không còn stepper khách.
 */
export function VoteButtons({
  sessionId,
  currentWillPlay,
  currentWillDine,
  currentWithPartner,
  disabled = false,
  playFull = false,
  title,
  optimisticListSync,
}: VoteButtonsProps) {
  const [willPlay, setWillPlay] = useState(currentWillPlay);
  const [willDine, setWillDine] = useState(currentWillDine);
  const [withPartner, setWithPartner] = useState(currentWithPartner);
  const t = useTranslations("voting");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- optimistic controls must resync when server props revalidate.
    setWillPlay(currentWillPlay);
    setWillDine(currentWillDine);
    setWithPartner(currentWithPartner);
  }, [currentWillPlay, currentWillDine, currentWithPartner]);

  // Khách member đã bỏ → luôn gửi 0. Chữ ký submitVote giữ nguyên.
  function fireVote(
    play: boolean,
    dine: boolean,
    partner: boolean,
    rollback: () => void,
  ) {
    optimisticListSync?.apply({
      willPlay: play,
      willDine: dine,
      guestPlayCount: 0,
      guestDineCount: 0,
      withPartner: partner,
    });
    fireAction(
      () => submitVote(sessionId, play, dine, 0, 0, partner),
      () => {
        rollback();
        optimisticListSync?.revert();
      },
    );
  }

  // Hết slot: chỉ chặn khi CHƯA đi cầu (bật mới). Đang đi cầu vẫn cho bỏ.
  const playLocked = playFull && !willPlay;

  function togglePlay() {
    if (disabled || playLocked) return;
    const newPlay = !willPlay;
    const prevPlay = willPlay;
    const prevPartner = withPartner;
    setWillPlay(newPlay);
    // Bỏ đi cầu → tắt luôn "2 mình" (không còn nghĩa).
    const nextPartner = newPlay ? withPartner : false;
    if (!newPlay) setWithPartner(false);
    fireVote(newPlay, willDine, nextPartner, () => {
      setWillPlay(prevPlay);
      setWithPartner(prevPartner);
    });
  }

  function toggleDine() {
    if (disabled) return;
    const newDine = !willDine;
    const prevDine = willDine;
    setWillDine(newDine);
    fireVote(willPlay, newDine, withPartner, () => setWillDine(prevDine));
  }

  function togglePartner() {
    if (disabled || !willPlay) return;
    const next = !withPartner;
    const prev = withPartner;
    setWithPartner(next);
    fireVote(willPlay, willDine, next, () => setWithPartner(prev));
  }

  return (
    <div className="space-y-2">
      {title && <h2 className="font-semibold">{title}</h2>}
      {/* flex-row-reverse: Cầu (DOM đầu, flex-1) hiện BÊN PHẢI, nút Bia BÊN TRÁI
          (theo yêu cầu) — giữ tab-order Cầu→Bia. */}
      <div className="flex flex-row-reverse items-stretch gap-2">
        {/* CẦU — nút lớn, bấm cả nút = toggle. role=button (không dùng <button>)
            để switch "2 mình" bên trong là <button> hợp lệ (không lồng button). */}
        <div
          role="button"
          data-tour="vote-play"
          tabIndex={disabled || playLocked ? -1 : 0}
          aria-pressed={willPlay}
          aria-disabled={disabled || playLocked || undefined}
          onClick={togglePlay}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              togglePlay();
            }
          }}
          className={cn(
            "flex flex-1 items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3.5 transition-all outline-none select-none",
            "focus-visible:ring-primary focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
            willPlay
              ? "border-primary bg-primary/[0.08] dark:bg-primary/10"
              : "border-border/90 bg-background/80",
            playLocked
              ? "cursor-not-allowed opacity-55"
              : "hover:border-primary/50 cursor-pointer",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-xl leading-none" aria-hidden>
              🏸
            </span>
            <span
              className={cn(
                "truncate font-semibold",
                willPlay ? "text-primary" : "text-foreground",
              )}
            >
              {playLocked ? t("slotsFull") : t("play")}
            </span>
          </span>

          {/* Bên phải khối: switch "2 mình" (khi đã đi cầu) + checkbox ở GÓC PHẢI. */}
          <span className="flex shrink-0 items-center gap-2">
            {willPlay && (
              <button
                type="button"
                role="switch"
                data-tour="vote-partner"
                aria-checked={withPartner}
                aria-label={t("withPartner")}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePartner();
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1"
              >
                <span className="text-base leading-none" aria-hidden>
                  👫
                </span>
                <span className="text-primary/90 hidden text-xs font-medium sm:inline">
                  {t("partnerShort")}
                </span>
                <MiniToggle on={withPartner} />
              </button>
            )}
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-all",
                willPlay
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40 bg-background",
              )}
            >
              {willPlay && <Check className="h-4 w-4" />}
            </span>
          </span>
        </div>

        {/* NHẬU — switch button gọn (bên trái do flex-row-reverse). */}
        <button
          type="button"
          role="switch"
          data-tour="vote-dine"
          aria-checked={willDine}
          aria-label={t("dine")}
          disabled={disabled}
          onClick={toggleDine}
          className={cn(
            "flex shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 py-2 transition-all",
            willDine
              ? "border-orange-500 bg-orange-500/[0.1] dark:bg-orange-950/25"
              : "border-border/90 bg-background/80 hover:border-orange-500/50",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="text-xl leading-none" aria-hidden>
            🍺
          </span>
          <MiniToggle on={willDine} accent="orange" />
        </button>
      </div>
    </div>
  );
}
