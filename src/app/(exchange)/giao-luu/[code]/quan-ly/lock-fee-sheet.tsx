"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { lockExchangeFees } from "@/actions/exchange-host";
import type { ManageReg } from "@/actions/exchange-host";
import { ResponsiveSheet } from "@/components/exchange/responsive-sheet";
import { CHARGEABLE_STATUSES } from "@/lib/exchange/constants";
import {
  computeLockedFees,
  type ExchangeFeeConfig,
  type HeadRates,
} from "@/lib/exchange-fee";
import { cn, formatVND } from "@/lib/utils";

const CHARGEABLE = new Set<string>(CHARGEABLE_STATUSES);

type Confirm = { rates: HeadRates; estimate: HeadRates };

/**
 * Chốt phí. Xem trước bằng `computeLockedFees` (cùng hàm với server, nên số
 * hiện ở đây khớp số server ghi). Không lạc quan: server có thể trả
 * `needsConfirm` khi mức mới cao hơn mức đã hiện, nên phải chờ kết quả thật.
 */
export function LockFeeSheet({
  open,
  onOpenChange,
  eventId,
  feeConfig,
  regs,
  onLocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  feeConfig: ExchangeFeeConfig;
  regs: ManageReg[];
  onLocked: () => void;
}) {
  const t = useTranslations("exchange.manage");
  const [waived, setWaived] = useState<Set<number>>(
    () => new Set(regs.filter((r) => r.feeWaived).map((r) => r.id)),
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [sending, setSending] = useState(false);

  const preview = computeLockedFees(
    feeConfig,
    regs.map((r) => ({
      id: r.id,
      status: r.status,
      maleCount: r.maleCount,
      femaleCount: r.femaleCount,
      waived: waived.has(r.id),
    })),
  );
  const feeOf = new Map(preview.fees.map((f) => [f.id, f.amount]));
  const rows = regs.filter((r) => CHARGEABLE.has(r.status));
  const hasPending = regs.some((r) => r.status === "pending");

  function toggle(id: number) {
    setConfirm(null);
    setWaived((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(confirmAboveEstimate: boolean) {
    if (sending) return;
    setSending(true);
    try {
      const r = await lockExchangeFees({
        eventId,
        waivedRegistrationIds: rows
          .filter((x) => waived.has(x.id))
          .map((x) => x.id),
        confirmAboveEstimate,
      });
      if ("error" in r) toast.error(r.error);
      else if ("needsConfirm" in r) setConfirm(r.needsConfirm);
      else {
        onLocked();
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("lockTitle")}
      footer={
        !confirm && (
          <button
            type="button"
            disabled={sending || hasPending || rows.length === 0}
            onClick={() => submit(false)}
            className="bg-primary text-primary-foreground min-h-12 w-full rounded-xl text-base font-semibold disabled:opacity-50"
          >
            {t("lockSubmit")}
          </button>
        )
      }
    >
      <p className="text-muted-foreground text-base">{t("lockHint")}</p>

      <p className="bg-primary/10 text-primary rounded-xl px-3 py-2 text-base font-semibold">
        {t("lockRates", {
          male: formatVND(preview.rates.male),
          female: formatVND(preview.rates.female),
        })}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-base">{t("lockNobody")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isWaived = waived.has(r.id);
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">{r.name}</p>
                  <p
                    className={cn(
                      "text-base tabular-nums",
                      isWaived && "text-muted-foreground line-through",
                    )}
                  >
                    {formatVND(feeOf.get(r.id) ?? 0)}
                  </p>
                </div>
                <label className="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 text-base">
                  <input
                    type="checkbox"
                    aria-label={t("waive")}
                    className="h-5 w-5"
                    checked={isWaived}
                    onChange={() => toggle(r.id)}
                  />
                  {t("waive")}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {hasPending && (
        <p className="text-base text-amber-600 dark:text-amber-400">
          {t("lockPending")}
        </p>
      )}

      {confirm && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-amber-500/60 bg-amber-500/10 p-3"
        >
          <p className="text-base">
            {t("lockAbove", {
              male: formatVND(confirm.rates.male),
              female: formatVND(confirm.rates.female),
              estMale: formatVND(confirm.estimate.male),
              estFemale: formatVND(confirm.estimate.female),
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              className="min-h-11 flex-1 rounded-xl border text-base font-medium"
            >
              {t("lockBack")}
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => submit(true)}
              className="bg-primary text-primary-foreground min-h-11 flex-1 rounded-xl text-base font-semibold disabled:opacity-50"
            >
              {t("lockConfirm")}
            </button>
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}
