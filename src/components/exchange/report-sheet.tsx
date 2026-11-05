"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { reportAbuse } from "@/actions/exchange-reports";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { REPORT_REASONS, TS_REPORT } from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
import { cn } from "@/lib/utils";

type Target = "event" | "host";

/**
 * Báo cáo buổi hoặc host. Gửi bằng `fireAction` với `retry: false`: token
 * Turnstile chỉ dùng được một lần nên không được gửi lại cùng closure, và sau
 * mỗi lần gửi (thành công hay lỗi) phải tăng `resetKey` để lấy token mới.
 */
export function ReportSheet({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
}) {
  const t = useTranslations("exchange.event");
  const tReason = useTranslations("notifications.reportReasons");
  const [target, setTarget] = useState<Target>("event");
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>("spam");
  const [note, setNote] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);

  function submit() {
    if (sending || !token) return;
    setSending(true);
    const turnstileToken = token;
    fireAction(
      () =>
        reportAbuse({
          target: { type: target, code },
          reason,
          note: note.trim() || undefined,
          turnstileToken,
        }),
      undefined,
      {
        retry: false,
        onSuccess: () => {
          setSending(false);
          setResetKey((k) => k + 1);
          setNote("");
          toast.success(t("reportSent"));
          onOpenChange(false);
        },
        onError: () => {
          setSending(false);
          setResetKey((k) => k + 1);
        },
      },
    );
  }

  const radio = (active: boolean) =>
    cn(
      "flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border px-3 text-base font-medium",
      active ? "border-primary bg-primary/10 text-primary" : "bg-background",
    );

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("reportTitle")}
    >
      <fieldset className="space-y-2">
        <legend className="text-base font-medium">{t("reportTarget")}</legend>
        <div className="flex gap-2" role="radiogroup">
          {(["event", "host"] as const).map((v) => (
            <label key={v} className={radio(target === v)}>
              <input
                type="radio"
                name="report-target"
                className="sr-only"
                checked={target === v}
                onChange={() => setTarget(v)}
              />
              {t(v === "event" ? "targetEvent" : "targetHost")}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-base font-medium">{t("reportReason")}</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {REPORT_REASONS.map((r) => (
            <label key={r} className={radio(reason === r)}>
              <input
                type="radio"
                name="report-reason"
                className="sr-only"
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              <span className="capitalize">{tReason(r)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-2">
        <span className="text-base font-medium">{t("reportNote")}</span>
        <textarea
          value={note}
          maxLength={500}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="bg-background w-full rounded-xl border p-3 text-base"
        />
      </label>

      <TurnstileWidget
        action={TS_REPORT}
        onToken={setToken}
        resetKey={resetKey}
      />

      <button
        type="button"
        onClick={submit}
        disabled={sending || !token}
        className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-50"
      >
        {sending
          ? t("sending")
          : token
            ? t("reportSubmit")
            : t("captchaWaiting")}
      </button>
    </ResponsiveSheet>
  );
}
