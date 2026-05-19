"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CustomSelect } from "@/components/ui/custom-select";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Input } from "@/components/ui/input";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { BaseModal } from "@/components/shared/base-modal";
import { formatK } from "@/lib/utils";
import { getFundStatus } from "@/lib/fund-core";

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

  const amountNum = parseInt(amount, 10) || 0;
  const canSubmit = memberId !== null && amountNum > 0 && !submitting;

  function handleConfirm() {
    if (!canSubmit || memberId === null) return;
    onSubmit(memberId, amountNum, desc.trim() || undefined);
  }

  return (
    <BaseModal open={open} onClose={onClose}>
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
                    getFundStatus(lockedMember.balance) === "owing"
                      ? "text-destructive shrink-0 text-sm font-bold tabular-nums"
                      : "text-muted-foreground shrink-0 text-sm font-bold tabular-nums"
                  }
                >
                  {getFundStatus(lockedMember.balance) === "owing" ? "−" : ""}
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
          <NumberStepper
            value={amountNum}
            onChange={(v) => setAmount(String(v))}
            step={step}
            disabled={submitting}
            displayFormat="vnd"
            autoFocus={!!lockedMember}
            className="w-full"
          />
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
    </BaseModal>
  );
}
