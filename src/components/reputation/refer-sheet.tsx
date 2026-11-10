"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Check, ShieldCheck } from "lucide-react";
import { referMember } from "@/actions/referrals";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { fireAction } from "@/lib/optimistic-action";
import {
  REFERRAL_BLOCK_DAYS,
  REFERRAL_STRIKES,
  REFERRAL_WATCH_DAYS,
  TS_REFERRAL,
} from "@/lib/reputation/constants";

/**
 * Sheet "Giới thiệu người này" (quyết định 39-44). Gửi lạc quan: đóng sheet và
 * báo `onReferred(true)` ngay để hồ sơ hiện chip "Được giới thiệu"; server từ
 * chối thì `onReferred(false)` và `fireAction` hiện lời của server. Token
 * Turnstile dùng một lần nên không tự thử lại, và mỗi lần gửi xong (dù được
 * hay lỗi) đều xin token mới qua `resetKey`.
 */
export function ReferSheet({
  open,
  onOpenChange,
  code,
  name,
  remaining,
  onReferred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mã hồ sơ của người được giới thiệu. */
  code: string;
  name: string;
  /** Số lượt còn lại trong tháng (giờ Việt Nam) của người xem. */
  remaining: number;
  /** Bật/tắt chip "Được giới thiệu" trên hồ sơ (lạc quan và hoàn lại). */
  onReferred: (referred: boolean) => void;
}) {
  const t = useTranslations("exchange.reputation.referral");
  const tEvent = useTranslations("exchange.event");
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  // Chặn chạm hai lần trước khi React kịp vẽ lại với `sending = true`.
  const inFlight = useRef(false);

  function submit() {
    if (inFlight.current || !token) return;
    inFlight.current = true;
    const turnstileToken = token;
    setToken(null);
    setSending(true);
    onReferred(true);
    onOpenChange(false);
    const done = () => {
      inFlight.current = false;
      setSending(false);
      setResetKey((k) => k + 1);
    };
    fireAction(
      () => referMember({ code, turnstileToken }),
      () => onReferred(false),
      {
        retry: false,
        successMsg: t("done"),
        onSuccess: () => {
          done();
          router.refresh();
        },
        onError: done,
      },
    );
  }

  const label = sending
    ? t("sentState")
    : token
      ? t("confirm")
      : tEvent("captchaWaiting");

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("button")}
      footer={
        <div className="space-y-2">
          <TurnstileWidget
            action={TS_REFERRAL}
            onToken={setToken}
            resetKey={resetKey}
          />
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={submit}
            disabled={sending || !token}
            className="bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-50"
          >
            {sending && <Check className="h-5 w-5" aria-hidden />}
            {label}
          </motion.button>
        </div>
      }
    >
      <section className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur">
        <p className="text-lg font-semibold break-words">{name}</p>
        <p className="flex gap-2 text-base">
          <ShieldCheck
            className="text-primary mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <span>
            {t("rule", {
              strikes: REFERRAL_STRIKES,
              watchDays: REFERRAL_WATCH_DAYS,
              blockDays: REFERRAL_BLOCK_DAYS,
            })}
          </span>
        </p>
      </section>
      <p className="text-muted-foreground text-base">
        {t("remaining", { n: remaining })}
      </p>
    </ResponsiveSheet>
  );
}
