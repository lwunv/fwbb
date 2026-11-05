"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { registerForExchange } from "@/actions/exchange-registrations";
import type { ViewerExtras } from "@/actions/exchange-read";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { NumberStepper } from "@/components/ui/number-stepper";
import { registrationFee } from "@/lib/exchange-fee";
import { MAX_COMPANIONS, TS_REGISTER } from "@/lib/exchange/constants";
import type { PublicExchangeEvent } from "@/lib/exchange/public-event";
import type { Gender } from "@/lib/gender";
import { fireAction } from "@/lib/optimistic-action";
import { cn, formatVND } from "@/lib/utils";
import { displayRates } from "./fee-utils";

export type RegisterResult = {
  status: "pending" | "approved" | "waitlist";
  waitlistPos: number | null;
};

/**
 * Sheet đăng ký. Gửi bằng `fireAction(..., { retry: false })`: token Turnstile
 * dùng một lần nên không được gửi lại cùng closure. Cha giữ trạng thái hiển thị:
 * `onOptimistic` đặt "đang gửi", `onRollback` hoàn lại khi lỗi, `onRegistered`
 * nhận trạng thái thật từ server. Sau mỗi lần gửi `resetKey` tăng để lấy token mới.
 */
export function RegisterSheet({
  open,
  onOpenChange,
  event,
  viewer,
  memberGender,
  onOptimistic,
  onRollback,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: PublicExchangeEvent;
  viewer: ViewerExtras;
  memberGender: Gender | null;
  onOptimistic: () => void;
  onRollback: () => void;
  onRegistered: (r: RegisterResult) => void;
}) {
  const t = useTranslations("exchange.event");
  // Chưa khai hoặc LGBT tính là nam, cùng quy ước với server.
  const [self, setSelf] = useState<"male" | "female">(
    memberGender === "female" ? "female" : "male",
  );
  const [extraMale, setExtraMale] = useState(0);
  const [extraFemale, setExtraFemale] = useState(0);
  const [note, setNote] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);

  const showCompanions = event.allowPlusOnes && !viewer.isNewAccount;
  const male = (self === "male" ? 1 : 0) + (showCompanions ? extraMale : 0);
  const female =
    (self === "female" ? 1 : 0) + (showCompanions ? extraFemale : 0);
  const rates = displayRates(event.fee);
  const estimate = registrationFee(rates, {
    maleCount: male,
    femaleCount: female,
  });

  function submit() {
    if (sending || !token) return;
    setSending(true);
    onOptimistic();
    const turnstileToken = token;
    let result = null as RegisterResult | null;
    fireAction(
      async () => {
        const res = await registerForExchange({
          code: event.code,
          maleCount: male,
          femaleCount: female,
          note: note.trim() || undefined,
          turnstileToken,
        });
        if ("success" in res) result = res.data;
        return res;
      },
      onRollback,
      {
        retry: false,
        onSuccess: () => {
          setSending(false);
          setResetKey((k) => k + 1);
          if (result) {
            toast.success(
              t(
                result.status === "approved"
                  ? "registeredApproved"
                  : result.status === "waitlist"
                    ? "registeredWaitlist"
                    : "registeredPending",
              ),
            );
            onRegistered(result);
          }
          onOpenChange(false);
        },
        onError: () => {
          setSending(false);
          setResetKey((k) => k + 1);
        },
      },
    );
  }

  const choice = (active: boolean) =>
    cn(
      "flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border px-3 text-base font-medium",
      active ? "border-primary bg-primary/10 text-primary" : "bg-background",
    );

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("registerTitle")}
    >
      <fieldset className="space-y-2">
        <legend className="text-base font-medium">{t("you")}</legend>
        <div className="flex gap-2" role="radiogroup">
          {(["male", "female"] as const).map((g) => (
            <label key={g} className={choice(self === g)}>
              <input
                type="radio"
                name="register-self"
                className="sr-only"
                checked={self === g}
                onChange={() => setSelf(g)}
              />
              {t(g)}
            </label>
          ))}
        </div>
      </fieldset>

      {showCompanions && (
        <fieldset className="space-y-2">
          <legend className="text-base font-medium">{t("companions")}</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-muted-foreground block text-sm">
                {t("companionsMale")}
              </span>
              <NumberStepper
                value={extraMale}
                onChange={setExtraMale}
                min={0}
                max={MAX_COMPANIONS - extraFemale}
                inputAriaLabel={t("companionsMale")}
              />
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground block text-sm">
                {t("companionsFemale")}
              </span>
              <NumberStepper
                value={extraFemale}
                onChange={setExtraFemale}
                min={0}
                max={MAX_COMPANIONS - extraMale}
                inputAriaLabel={t("companionsFemale")}
              />
            </div>
          </div>
        </fieldset>
      )}

      <label className="block space-y-2">
        <span className="text-base font-medium">{t("note")}</span>
        <textarea
          value={note}
          maxLength={300}
          rows={2}
          placeholder={t("notePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
          className="bg-background w-full rounded-xl border p-3 text-base"
        />
      </label>

      {viewer.skillWarning && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-base text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t(viewer.skillWarning === "below" ? "skillBelow" : "skillAbove")}
        </p>
      )}

      <div className="bg-muted flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-base">
        <span>
          {t("feeEstimate")} ({t("headsCount", { count: male + female })})
        </span>
        <span className="font-semibold">{formatVND(estimate)}</span>
      </div>

      <TurnstileWidget
        action={TS_REGISTER}
        onToken={setToken}
        resetKey={resetKey}
      />

      <button
        type="button"
        onClick={submit}
        disabled={sending || !token}
        className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-50"
      >
        {sending ? t("sending") : token ? t("submit") : t("captchaWaiting")}
      </button>
    </ResponsiveSheet>
  );
}
