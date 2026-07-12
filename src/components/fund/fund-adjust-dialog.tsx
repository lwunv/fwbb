"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK, cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { recordContribution, recordRefund } from "@/actions/fund";
import { toast } from "sonner";

type Mode = "add" | "subtract";

/** Step đơn vị 10K cho NumberStepper trong dialog quỹ. */
const STEP = 10_000;
/** Max VND đủ rộng để xử lý mọi balance thực tế — tránh để Infinity vì
 *  NumberStepper bind vào input type=number không xử lý Infinity tốt. */
const MAX_AMOUNT = 100_000_000;

export interface FundAdjustDialogTarget {
  memberId: number;
  memberName: string;
  memberNickname?: string | null;
  memberAvatarKey?: string | null;
  memberAvatarUrl?: string | null;
  currentBalance: number;
}

export function FundAdjustDialog({
  target,
  open,
  onOpenChange,
}: {
  target: FundAdjustDialogTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("adminMisc");
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState(0);

  if (!target) return null;

  function reset() {
    setMode("add");
    setAmount(0);
    setNote("");
    setSubmitting(false);
    setEditingBalance(false);
    setBalanceDraft(0);
  }

  function handleClose() {
    if (submitting) return;
    onOpenChange(false);
    setTimeout(reset, 200);
  }

  function startEditingBalance() {
    if (!target) return;
    setBalanceDraft(Math.max(0, target.currentBalance));
    setEditingBalance(true);
  }

  function cancelEditingBalance() {
    setEditingBalance(false);
    setBalanceDraft(0);
  }

  function submitBalanceEdit() {
    if (!target) return;
    const diff = balanceDraft - target.currentBalance;
    if (diff === 0) {
      toast.error(t("balanceAlreadyCorrect"));
      return;
    }

    let action: () => Promise<{ error?: string } | { success: boolean }>;
    if (diff > 0) {
      const idemKey = `set-contrib-${crypto.randomUUID()}`;
      action = () =>
        recordContribution(
          target.memberId,
          diff,
          t("editBalanceNote"),
          idemKey,
        );
    } else {
      const idemKey = `set-refund-${crypto.randomUUID()}`;
      action = () =>
        recordRefund(target.memberId, -diff, t("editBalanceNote"), idemKey);
    }

    setSubmitting(true);
    fireAction(action, () => setSubmitting(false), {
      successMsg: t("toastEditBalance", {
        name: target.memberNickname || target.memberName,
        amount: formatK(balanceDraft),
      }),
      onSuccess: () => {
        setSubmitting(false);
        handleClose();
      },
    });
  }

  function handleSubmit() {
    if (!target) return;
    if (amount <= 0) {
      toast.error(t("enterValidAmount"));
      return;
    }

    let action: () => Promise<{ error?: string } | { success: boolean }>;
    let successMsg: string;
    const desc = note.trim() || undefined;
    const memberLabel = target.memberNickname || target.memberName;

    if (mode === "add") {
      const idemKey = `contrib-${crypto.randomUUID()}`;
      action = () => recordContribution(target.memberId, amount, desc, idemKey);
      successMsg = t("toastFundAdd", {
        amount: formatK(amount),
        name: memberLabel,
      });
    } else {
      const idemKey = `refund-${crypto.randomUUID()}`;
      action = () => recordRefund(target.memberId, amount, desc, idemKey);
      successMsg = t("toastFundSubtract", {
        amount: formatK(amount),
        name: memberLabel,
      });
    }

    setSubmitting(true);
    fireAction(action, () => setSubmitting(false), {
      successMsg,
      onSuccess: () => {
        setSubmitting(false);
        handleClose();
      },
    });
  }

  const balanceColor =
    target.currentBalance < 0
      ? "text-rose-500 dark:text-rose-400"
      : target.currentBalance === 0
        ? "text-foreground"
        : target.currentBalance < 50_000
          ? "text-yellow-500 dark:text-yellow-400"
          : "text-blue-600 dark:text-blue-400";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-card w-full max-w-md rounded-t-2xl p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — avatar + name + balance (inline-editable via pencil) */}
            <div className="mb-4 flex items-start gap-3">
              <MemberAvatar
                memberId={target.memberId}
                avatarKey={target.memberAvatarKey ?? null}
                avatarUrl={target.memberAvatarUrl ?? null}
                size={40}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate text-base font-semibold">
                  {target.memberNickname || target.memberName}
                </div>
                {editingBalance ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-2xl">💰</span>
                    <NumberStepper
                      value={balanceDraft}
                      onChange={setBalanceDraft}
                      step={STEP}
                      min={0}
                      max={MAX_AMOUNT}
                      disabled={submitting}
                      displayFormat="vnd"
                      className="min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={submitBalanceEdit}
                      disabled={submitting}
                      aria-label={t("saveBalanceAria")}
                      title={t("save")}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-500 bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditingBalance}
                      disabled={submitting}
                      aria-label={t("cancelEditBalanceAria")}
                      title={t("cancel")}
                      className="border-border text-muted-foreground hover:bg-muted/50 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-60"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-2xl font-bold tabular-nums",
                        balanceColor,
                      )}
                    >
                      💰 {formatK(target.currentBalance)}
                    </span>
                    <button
                      type="button"
                      onClick={startEditingBalance}
                      aria-label={t("editBalanceAria")}
                      title={t("editBalanceAria")}
                      className="border-border text-muted-foreground hover:bg-muted/50 inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground inline-flex h-11 w-11 items-center justify-center rounded-md"
                aria-label={t("close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Mode tabs — Cộng / Trừ; sửa balance inline qua pencil ở header */}
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              <ModeButton
                active={mode === "add"}
                onClick={() => setMode("add")}
                icon={Plus}
                label={t("modeAdd")}
                activeClass="border-primary bg-primary text-primary-foreground"
              />
              <ModeButton
                active={mode === "subtract"}
                onClick={() => setMode("subtract")}
                icon={Minus}
                label={t("modeSubtract")}
                activeClass="border-rose-500 bg-rose-500 text-white"
              />
            </div>

            {/* Amount stepper — dùng NumberStepper chung */}
            <div className="mb-2 flex items-center justify-center">
              <NumberStepper
                value={amount}
                onChange={setAmount}
                step={STEP}
                min={0}
                max={MAX_AMOUNT}
                disabled={submitting || editingBalance}
                displayFormat="vnd"
                className="w-full"
              />
            </div>

            {/* Note */}
            <Input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="mb-3 text-sm"
              disabled={submitting || editingBalance}
            />

            {/* Submit — disabled khi đang sửa balance inline để tránh confusion */}
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || amount <= 0 || editingBalance}
            >
              <Check className="mr-1 h-4 w-4" />
              {submitting ? t("saving") : t("save")}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border-2 px-2 text-sm font-semibold transition-colors",
        active
          ? activeClass
          : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </button>
  );
}
