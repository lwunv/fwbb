"use client";

import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import type { ManageReg } from "@/actions/exchange-host";
import { nameSeed } from "@/components/exchange/exchange-card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { cn, formatVND } from "@/lib/utils";

export type RowContext = {
  depositAmount: number;
  /** Sự kiện đã chốt phí hoặc đã xong: đây là lúc đánh dấu "Đã trả". */
  canMarkPaid: boolean;
  /** Buổi còn mở/đầy: duyệt, từ chối được. */
  open: boolean;
  checkInOpen: boolean;
  started: boolean;
};

export type RowHandlers = {
  onDecide: (r: ManageReg, decision: "approve" | "reject") => void;
  onDeposit: (r: ManageReg, received: boolean) => void;
  onCheckIn: (r: ManageReg, checkedIn: boolean) => void;
  onNoShow: (r: ManageReg) => void;
  onPaid: (r: ManageReg, paid: boolean) => void;
  onMore: (r: ManageReg) => void;
};

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-base font-medium disabled:opacity-50";
const CHIP = "rounded-full px-2.5 py-1 text-sm font-medium";

/** Nút bật/tắt dạng công tắc: `aria-pressed` cho người dùng đọc màn hình và cho test. */
function Toggle({
  label,
  pressed,
  disabled,
  onClick,
  title,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        BTN,
        pressed && "border-primary bg-primary/10 text-primary",
      )}
    >
      {label}
    </button>
  );
}

/** Thẻ một đăng ký: thông tin người, tiền (đọc từ server) và nút theo trạng thái. */
export function RegistrationRow({
  reg,
  ctx,
  blocked,
  handlers,
}: {
  reg: ManageReg;
  ctx: RowContext;
  blocked: boolean;
  handlers: RowHandlers;
}) {
  const t = useTranslations("exchange.manage");
  const h = handlers;
  const money = (n: number) => formatVND(n);
  const hasDeposit = ctx.depositAmount > 0;
  const received = reg.paid ? (reg.paidAmount ?? 0) : null;
  const hasFee = reg.feeAmount !== null;
  const showMoney = hasFee || reg.depositPaid || reg.paid || reg.refundDue > 0;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="bg-card/80 space-y-3 rounded-2xl border p-3 backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <MemberAvatar
          memberId={nameSeed(reg.name)}
          avatarUrl={reg.avatarUrl}
          avatarKey={reg.avatarKey}
          size={44}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-base font-semibold">{reg.name}</p>
          <p className="text-muted-foreground text-base">
            {t("headsLine", { male: reg.maleCount, female: reg.femaleCount })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {reg.isNewAccount && (
              <span className={cn(CHIP, "bg-primary/10 text-primary")}>
                {t("badgeNew")}
              </span>
            )}
            {reg.skillOutOfRange && (
              <span
                className={cn(
                  CHIP,
                  "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                )}
              >
                {t("badgeSkill")}
              </span>
            )}
            {reg.accountLocked && (
              <span className={cn(CHIP, "bg-destructive/10 text-destructive")}>
                {t("badgeLocked")}
              </span>
            )}
            {blocked && (
              <span className={cn(CHIP, "bg-muted text-muted-foreground")}>
                {t("badgeBlocked")}
              </span>
            )}
          </div>
          {reg.waitlistPos !== null && reg.status === "waitlist" && (
            <p className="text-muted-foreground text-base">
              {t("waitPos", { pos: reg.waitlistPos })}
            </p>
          )}
          {reg.note && (
            <p className="text-base break-words whitespace-pre-line">
              {reg.note}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t("more")}
          onClick={() => h.onMore(reg)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {showMoney && (
        <div className="space-y-0.5 text-base tabular-nums">
          {hasFee && (
            <p>{t("feeLine", { amount: money(reg.feeAmount ?? 0) })}</p>
          )}
          {hasDeposit && reg.depositPaid && (
            <p>{t("depositLine", { amount: money(ctx.depositAmount) })}</p>
          )}
          {received !== null && (
            <p>{t("paidLine", { amount: money(received) })}</p>
          )}
          {reg.remaining > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              {reg.paid
                ? t("diffMore", { amount: money(reg.remaining) })
                : t("remainingLine", { amount: money(reg.remaining) })}
            </p>
          )}
          {reg.refundDue > 0 && (
            <>
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                {t("refundLine", { amount: money(reg.refundDue) })}
              </p>
              {reg.paid && (
                <p className="text-muted-foreground">
                  {t("diffLess", { amount: money(reg.refundDue) })}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {reg.status === "pending" && (
          <>
            <button
              type="button"
              disabled={!ctx.open || (hasDeposit && !reg.depositPaid)}
              title={
                hasDeposit && !reg.depositPaid ? t("depositNeeded") : undefined
              }
              onClick={() => h.onDecide(reg, "approve")}
              className={cn(
                BTN,
                "border-primary bg-primary text-primary-foreground",
              )}
            >
              {t("approve")}
            </button>
            <button
              type="button"
              disabled={!ctx.open}
              onClick={() => h.onDecide(reg, "reject")}
              className={BTN}
            >
              {t("reject")}
            </button>
          </>
        )}
        {hasDeposit &&
          (reg.status === "pending" || reg.status === "approved") && (
            <Toggle
              label={t("depositReceived")}
              pressed={reg.depositPaid}
              disabled={!ctx.open}
              onClick={() => h.onDeposit(reg, !reg.depositPaid)}
            />
          )}
        {(reg.status === "approved" || reg.status === "no_show") && (
          <Toggle
            label={t("checkIn")}
            pressed={reg.checkedIn}
            disabled={!ctx.checkInOpen}
            title={!ctx.checkInOpen ? t("checkInClosed") : undefined}
            onClick={() => h.onCheckIn(reg, !reg.checkedIn)}
          />
        )}
        {reg.status === "approved" && !reg.checkedIn && ctx.started && (
          <button type="button" onClick={() => h.onNoShow(reg)} className={BTN}>
            {t("noShow")}
          </button>
        )}
        {reg.status === "approved" && ctx.open && (
          <button
            type="button"
            onClick={() => h.onDecide(reg, "reject")}
            className={BTN}
          >
            {t("reject")}
          </button>
        )}
        {ctx.canMarkPaid && reg.feeAmount !== null && (
          <Toggle
            label={t("paid")}
            pressed={reg.paid}
            onClick={() => h.onPaid(reg, !reg.paid)}
          />
        )}
      </div>
    </motion.li>
  );
}
