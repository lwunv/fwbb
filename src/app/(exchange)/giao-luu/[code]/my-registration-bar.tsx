"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelMyRegistration } from "@/actions/exchange-registrations";
import type { ViewerExtras } from "@/actions/exchange-read";
import { ConfirmSheet } from "@/components/exchange/confirm-sheet";
import type { PublicExchangeEvent } from "@/lib/exchange/public-event";
import { fireAction } from "@/lib/optimistic-action";

/** Trạng thái đăng ký đang hiển thị (đã gồm bước lạc quan "sending"). */
export type RegState = { status: string; waitlistPos: number | null };

const ACTIVE = ["pending", "approved", "waitlist"];

/**
 * Thanh dính đáy: một nút chính theo vai trò và trạng thái. Hủy trước hạn đi
 * thẳng, sau hạn hỏi lại vì vẫn bị tính phí. Hủy là lạc quan: đổi ngay, lỗi
 * thì hoàn lại và `fireAction` hiện toast.
 */
export function MyRegistrationBar({
  event,
  viewer,
  reg,
  onChange,
  onRegister,
}: {
  event: PublicExchangeEvent;
  viewer: ViewerExtras;
  reg: RegState | null;
  onChange: (next: RegState | null) => void;
  onRegister: () => void;
}) {
  const t = useTranslations("exchange.event");
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Chụp giờ một lần lúc mount: bar chỉ là gợi ý hiển thị, server mới là nơi chặn.
  const [now] = useState(() => Date.now());
  const late = now > new Date(event.cancelDeadline).getTime();

  function cancel() {
    const prev = reg;
    onChange({ status: "cancelled", waitlistPos: null });
    fireAction(
      () => cancelMyRegistration({ code: event.code }),
      () => onChange(prev),
      { retry: false, onSuccess: () => router.refresh() },
    );
  }

  const shell =
    "bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0";
  const primary =
    "bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center rounded-xl px-6 text-base font-semibold disabled:opacity-60 sm:w-auto";
  const note = "text-muted-foreground flex min-h-12 items-center text-base";

  let body: React.ReactNode;
  const closedKey =
    event.status === "locked"
      ? "closedLocked"
      : event.status === "done"
        ? "closedDone"
        : event.status === "cancelled"
          ? "closedCancelled"
          : null;

  if (viewer.role === "host") {
    body = (
      <Link href={`/giao-luu/${event.code}/quan-ly`} className={primary}>
        {t("manage")}
      </Link>
    );
  } else if (viewer.role === "guest") {
    body = (
      <Link
        href={`/giao-luu/dang-nhap?next=${encodeURIComponent(`/giao-luu/${event.code}`)}`}
        className={primary}
      >
        {t("loginCta")}
      </Link>
    );
  } else if (reg?.status === "sending") {
    body = (
      <button type="button" disabled className={primary}>
        {t("sending")}
      </button>
    );
  } else if (reg && ACTIVE.includes(reg.status)) {
    const label =
      reg.status === "approved"
        ? t("statusApproved")
        : reg.status === "waitlist"
          ? t("statusWaitlist", { pos: reg.waitlistPos ?? "?" })
          : t("statusPending");
    const canCancel = event.status !== "done" && event.status !== "cancelled";
    body = (
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-base font-semibold">{label}</p>
        {canCancel && (
          <button
            type="button"
            onClick={() => (late ? setConfirmOpen(true) : cancel())}
            className="border-destructive/40 text-destructive min-h-12 shrink-0 rounded-xl border px-5 text-base font-medium"
          >
            {t("cancelReg")}
          </button>
        )}
      </div>
    );
  } else if (closedKey) {
    body = <p className={note}>{t(closedKey)}</p>;
  } else if (reg && reg.status !== "cancelled") {
    const key =
      reg.status === "rejected"
        ? "statusRejected"
        : reg.status === "late_cancelled"
          ? "statusLateCancelled"
          : "statusNoShow";
    body = <p className={note}>{t(key)}</p>;
  } else if (viewer.blocked) {
    body = <p className={note}>{t("blockedNote")}</p>;
  } else if (now > new Date(event.registerDeadline).getTime()) {
    body = <p className={note}>{t("closedDeadline")}</p>;
  } else {
    body = (
      <button type="button" onClick={onRegister} className={primary}>
        {t("register")}
      </button>
    );
  }

  return (
    <>
      <div className={shell}>{body}</div>
      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("cancelConfirmTitle")}
        description={t("cancelConfirmBody")}
        confirmLabel={t("cancelConfirm")}
        cancelLabel={t("cancelKeep")}
        onConfirm={cancel}
      />
    </>
  );
}
