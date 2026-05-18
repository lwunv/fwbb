"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus, Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK, cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { recordContribution, recordRefund } from "@/actions/fund";
import { toast } from "sonner";

type Mode = "add" | "subtract" | "set";

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
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!target) return null;

  function reset() {
    setMode("add");
    setAmount("");
    setNote("");
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    onOpenChange(false);
    // Defer reset to next tick so closing animation finishes cleanly.
    setTimeout(reset, 200);
  }

  function handleSubmit() {
    if (!target) return;
    const raw = parseInt(amount.replace(/\D/g, ""), 10);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast.error("Nhập số tiền hợp lệ");
      return;
    }

    let action: () => Promise<{ error?: string } | { success: boolean }>;
    let successMsg: string;
    const desc = note.trim() || undefined;

    if (mode === "add") {
      const idemKey = `contrib-${crypto.randomUUID()}`;
      action = () => recordContribution(target.memberId, raw, desc, idemKey);
      successMsg = `Đã cộng ${formatK(raw)} vào quỹ ${target.memberNickname || target.memberName}`;
    } else if (mode === "subtract") {
      const idemKey = `refund-${crypto.randomUUID()}`;
      action = () => recordRefund(target.memberId, raw, desc, idemKey);
      successMsg = `Đã trừ ${formatK(raw)} khỏi quỹ ${target.memberNickname || target.memberName}`;
    } else {
      // mode === "set": diff = target - current
      const diff = raw - target.currentBalance;
      if (diff === 0) {
        toast.error("Số tiền hiện đã đúng");
        return;
      }
      if (diff > 0) {
        const idemKey = `set-contrib-${crypto.randomUUID()}`;
        action = () =>
          recordContribution(
            target.memberId,
            diff,
            desc ?? "Sửa balance",
            idemKey,
          );
        successMsg = `Đã sửa balance ${target.memberNickname || target.memberName} → ${formatK(raw)}`;
      } else {
        const idemKey = `set-refund-${crypto.randomUUID()}`;
        action = () =>
          recordRefund(target.memberId, -diff, desc ?? "Sửa balance", idemKey);
        successMsg = `Đã sửa balance ${target.memberNickname || target.memberName} → ${formatK(raw)}`;
      }
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
            {/* Header — member + current balance */}
            <div className="mb-4 flex items-center gap-3">
              <MemberAvatar
                memberId={target.memberId}
                avatarKey={target.memberAvatarKey ?? null}
                avatarUrl={target.memberAvatarUrl ?? null}
                size={40}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold">
                  {target.memberNickname || target.memberName}
                </div>
                <div
                  className={cn("text-sm font-bold tabular-nums", balanceColor)}
                >
                  💰 {formatK(target.currentBalance)}
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground p-1"
                aria-label="Đóng"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Mode tabs */}
            <div className="mb-3 grid grid-cols-3 gap-1.5">
              <ModeButton
                active={mode === "add"}
                onClick={() => setMode("add")}
                icon={Plus}
                label="Cộng quỹ"
                activeClass="border-primary bg-primary text-primary-foreground"
              />
              <ModeButton
                active={mode === "subtract"}
                onClick={() => setMode("subtract")}
                icon={Minus}
                label="Trừ quỹ"
                activeClass="border-rose-500 bg-rose-500 text-white"
              />
              <ModeButton
                active={mode === "set"}
                onClick={() => setMode("set")}
                icon={Pencil}
                label="Sửa balance"
                activeClass="border-blue-500 bg-blue-500 text-white"
              />
            </div>

            {/* Amount input */}
            <Input
              type="text"
              inputMode="numeric"
              autoFocus
              value={amount ? Number(amount).toLocaleString("vi-VN") : ""}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder={
                mode === "set" ? "Số tiền mới (VND)" : "Số tiền (VND)"
              }
              className="mb-2 text-base tabular-nums"
              disabled={submitting}
            />

            {/* Note */}
            <Input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú (không bắt buộc)"
              className="mb-3 text-sm"
              disabled={submitting}
            />

            {/* Preview diff for "set" mode */}
            {mode === "set" &&
              amount &&
              (() => {
                const raw = parseInt(amount, 10);
                if (!Number.isFinite(raw)) return null;
                const diff = raw - target.currentBalance;
                if (diff === 0) {
                  return (
                    <p className="text-muted-foreground mb-3 text-xs">
                      Số tiền hiện đã đúng — không cần điều chỉnh.
                    </p>
                  );
                }
                return (
                  <p className="mb-3 text-xs">
                    {formatK(target.currentBalance)} →{" "}
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {formatK(raw)}
                    </span>{" "}
                    <span
                      className={cn(
                        "font-medium",
                        diff > 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-rose-500 dark:text-rose-400",
                      )}
                    >
                      ({diff > 0 ? "+" : "−"}
                      {formatK(Math.abs(diff))})
                    </span>
                  </p>
                );
              })()}

            {/* Submit */}
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || !amount}
            >
              <Check className="mr-1 h-4 w-4" />
              {submitting ? "Đang lưu..." : "Lưu"}
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
        "inline-flex h-10 items-center justify-center gap-1 rounded-lg border-2 px-2 text-xs font-semibold transition-colors",
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
