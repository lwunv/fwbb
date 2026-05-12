"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";

export interface RecordContributionMember {
  id: number;
  name: string;
  nickname?: string | null;
  /** Optional balance shown next to label/locked card. */
  balance?: number;
  avatarKey?: string | null;
  avatarUrl?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    memberId: number,
    amount: number,
    description: string | undefined,
  ) => void;
  /** Locked target — when set, no member select is shown; member is fixed. */
  lockedMember?: RecordContributionMember | null;
  /** When no lockedMember, members are picked from this list (searchable). */
  selectableMembers?: RecordContributionMember[];
  /** Default amount (VND). Defaults to 500000. */
  defaultAmount?: number;
  /** Stepper delta for +/− buttons. Defaults to 100000 (100k). */
  step?: number;
  /** Disable the Confirm button while a submit is in flight. */
  submitting?: boolean;
}

/**
 * Shared "Ghi nhận đóng quỹ" popup. Used by:
 *  - /admin/fund top-bar button (member selectable)
 *  - /admin/dashboard "Nộp quỹ" per-debtor row (lockedMember)
 *
 * Owns its own form state internally — parent just toggles `open` and
 * receives the resolved values via `onSubmit`. Stepper +/− adjusts the
 * amount in `step` increments while still allowing free typing.
 */
export function RecordContributionDialog({
  open,
  onClose,
  onSubmit,
  lockedMember,
  selectableMembers,
  defaultAmount = 500000,
  step = 100000,
  submitting,
}: Props) {
  const t = useTranslations("fundAdmin");
  const tCommon = useTranslations("common");
  const [memberId, setMemberId] = useState<number | null>(
    lockedMember?.id ?? null,
  );
  const [amount, setAmount] = useState(String(defaultAmount));
  const [desc, setDesc] = useState("");

  // "Adjusting state on prop change" pattern (React docs) thay vì useEffect
  // → tránh cascading-render lint error. Theo dõi `open` + `lockedMember.id`,
  // nếu thay đổi thì reset form ngay trong render. React sẽ throw away render
  // hiện tại và re-render với state mới — kết quả tương đương useEffect
  // nhưng đồng bộ, không trigger cascading.
  const trackingKey = `${open ? 1 : 0}|${lockedMember?.id ?? "none"}|${defaultAmount}`;
  const [prevTrackingKey, setPrevTrackingKey] = useState(trackingKey);
  if (trackingKey !== prevTrackingKey) {
    setPrevTrackingKey(trackingKey);
    if (open) {
      setMemberId(lockedMember?.id ?? null);
      setAmount(String(defaultAmount));
      setDesc("");
    }
  }

  const formattedAmount = amount ? Number(amount).toLocaleString("vi-VN") : "";
  const amountNum = parseInt(amount, 10) || 0;
  const canSubmit = memberId !== null && amountNum > 0 && !submitting;

  function bump(delta: number) {
    setAmount(String(Math.max(0, amountNum + delta)));
  }

  function handleConfirm() {
    if (!canSubmit || memberId === null) return;
    onSubmit(memberId, amountNum, desc.trim() || undefined);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-card w-full max-w-md rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-bold">{t("modalRecordTitle")}</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("memberLabel")}
                </label>
                {lockedMember ? (
                  <div className="bg-muted/40 border-border flex items-center gap-2 rounded-xl border px-3 py-2.5">
                    <MemberAvatar
                      memberId={lockedMember.id}
                      avatarKey={lockedMember.avatarKey ?? null}
                      avatarUrl={lockedMember.avatarUrl ?? null}
                      size={28}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {lockedMember.nickname || lockedMember.name}
                    </span>
                    {typeof lockedMember.balance === "number" && (
                      <span
                        className={
                          lockedMember.balance < 0
                            ? "text-destructive shrink-0 text-sm font-bold tabular-nums"
                            : "text-muted-foreground shrink-0 text-sm font-bold tabular-nums"
                        }
                      >
                        {lockedMember.balance < 0 ? "−" : ""}
                        {formatK(Math.abs(lockedMember.balance))}
                      </span>
                    )}
                  </div>
                ) : (
                  <CustomSelect
                    value={memberId !== null ? String(memberId) : ""}
                    onChange={(v) => setMemberId(v ? Number(v) : null)}
                    placeholder={t("selectMember")}
                    searchable
                    searchPlaceholder="Tìm thành viên..."
                    options={(selectableMembers ?? []).map((m) => ({
                      value: String(m.id),
                      label: `${m.nickname || m.name}${
                        typeof m.balance === "number"
                          ? ` (${formatK(m.balance)})`
                          : ""
                      }`,
                    }))}
                  />
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("amountVnd")}
                </label>
                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => bump(-step)}
                    disabled={submitting || amountNum <= 0}
                    className="bg-card hover:bg-muted/50 inline-flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border-2 transition-colors disabled:opacity-40"
                    aria-label={`Giảm ${formatK(step)}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={formattedAmount}
                    onChange={(e) =>
                      setAmount(e.target.value.replace(/\D/g, ""))
                    }
                    placeholder={t("amountExample")}
                    className="text-center tabular-nums"
                    disabled={submitting}
                    autoFocus={!!lockedMember}
                  />
                  <button
                    type="button"
                    onClick={() => bump(step)}
                    disabled={submitting}
                    className="bg-card hover:bg-muted/50 inline-flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border-2 transition-colors disabled:opacity-40"
                    aria-label={`Tăng ${formatK(step)}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("noteLabel")}
                </label>
                <Input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder={t("notePlaceholder")}
                  disabled={submitting}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="hover:bg-accent flex-1 rounded-xl border py-3 font-medium transition-colors disabled:opacity-50"
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!canSubmit}
                  className="bg-primary text-primary-foreground flex-1 rounded-xl py-3 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {tCommon("confirm")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
