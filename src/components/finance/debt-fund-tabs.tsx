"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PaymentQR } from "@/components/payment/payment-qr";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatK, cn } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { Banknote, PiggyBank, CheckCircle, Wallet } from "lucide-react";
import { claimFundContribution } from "@/actions/auto-fund";

interface DebtFundTabsProps {
  /** Member id của user hiện tại — dùng cho memo QR */
  memberId: number;
  /** Tổng nợ chưa thanh toán */
  outstandingTotal: number;
  /** Số dư quỹ hiện tại của user, null nếu chưa join quỹ */
  fundBalance: number | null;
  /** Optional: text gợi ý phía trên tabs */
  warningText?: string;
  /** Force tab mặc định, override default heuristic */
  defaultTab?: "fund" | "debt";
}

/**
 * 2-tab card: "Đóng quỹ" và "Thanh toán nợ".
 *
 * - Border đỏ khi `fundBalance = 0` (cần nạp gấp).
 * - Border primary khi `fundBalance > 0`.
 * - Default tab: "Đóng quỹ" nếu user còn nợ + quỹ hết, không thì "Thanh toán nợ".
 *
 * Memo prefix: 2 tab dùng 2 prefix khác nhau để webhook bank-matcher
 * classify đúng intent:
 *   - tab "fund" → `FWBB QUY <memberId>` (matchFundContribution)
 *   - tab "debt" → `FWBB NO <memberId>` (matchAllDebts — trả tất nợ)
 *
 * Empty state: nếu user vừa không phải fund member vừa không có nợ
 * (`!isFundMember && !hasDebt`), không tab nào có content → render
 * placeholder thay vì card trống.
 *
 * Optimistic UI: handleClaimFund dùng `fireAction` (auto retry + rollback).
 */
export function DebtFundTabs({
  memberId,
  outstandingTotal,
  fundBalance,
  warningText,
  defaultTab,
}: DebtFundTabsProps) {
  const tFinance = useTranslations("finance");
  const tDashboard = useTranslations("dashboard");

  const isFundMember = fundBalance !== null;
  const hasFund = (fundBalance ?? 0) > 0;
  const hasDebt = outstandingTotal > 0;

  // Default tab: prop override > heuristic. Heuristic: hết quỹ + còn nợ → "fund"; ngược lại → "debt"
  const initialTab: "fund" | "debt" =
    defaultTab ?? (!hasFund && isFundMember && hasDebt ? "fund" : "debt");
  const [tab, setTab] = useState<"fund" | "debt">(initialTab);

  // Initial amount default: matching the initial tab.
  const [fundAmount, setFundAmount] = useState<string>(() => {
    if (initialTab === "debt" && hasDebt) return String(outstandingTotal);
    return "500000";
  });

  function pickTab(next: "fund" | "debt") {
    setTab(next);
    // Switch the amount default when the user picks a tab — same as a radio
    // group's "selected option default value".
    if (next === "fund") setFundAmount("500000");
    else if (next === "debt" && hasDebt)
      setFundAmount(String(outstandingTotal));
  }
  const [fundClaimed, setFundClaimed] = useState(false);
  const [pending, setPending] = useState(false);

  function handleClaimFund() {
    const amount = Math.max(0, parseInt(fundAmount, 10) || 0);
    if (amount <= 0) {
      toast.error(tDashboard("invalidAmount"));
      return;
    }
    // Idempotency key per submit — chống double-click / retry. fireAction
    // reuses the same key on its built-in retry so the server treats both
    // attempts as one logical claim.
    const idemKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `claim-${memberId}-${amount}-${Date.now()}`;

    // Optimistic: flip claim state immediately, rollback on error.
    setPending(true);
    setFundClaimed(true);
    fireAction(
      async () => {
        const r = await claimFundContribution(amount, idemKey);
        if ("error" in r) return { error: r.error };
        toast.success(
          r.replayed
            ? tDashboard("claimReplayed")
            : tDashboard("claimReceived"),
        );
        return { success: true };
      },
      () => {
        setFundClaimed(false);
      },
      {
        retry: true,
        onSuccess: () => setPending(false),
      },
    );
    // pending will be reset on success via onSuccess; on failure rollback
    // toggles fundClaimed back and we also clear pending here as a fallback.
    setTimeout(() => setPending(false), 8_000);
  }

  // Empty state — nothing to show in either tab.
  if (!isFundMember && !hasDebt) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
            <Wallet className="text-muted-foreground h-6 w-6" />
          </div>
          <p className="text-muted-foreground text-sm">
            {tDashboard("noPendingActions")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Border tùy theo trạng thái quỹ
  const borderClass =
    isFundMember && !hasFund
      ? "border-destructive/50 ring-1 ring-destructive/30"
      : "border-primary/40 ring-1 ring-primary/20";

  // Memo prefix per tab — webhook matcher dispatches by prefix:
  //   "FWBB QUY <id>" → matchFundContribution (nạp quỹ)
  //   "FWBB NO <id>"  → matchAllDebts (trả tất nợ)
  const fundMemo = `FWBB QUY ${memberId}`;
  const debtMemo = `FWBB NO ${memberId}`;

  return (
    <Card className={cn("overflow-hidden", borderClass)}>
      <CardContent className="space-y-3 p-3 sm:p-4">
        {warningText && (
          <p className="text-muted-foreground text-center text-sm">
            {warningText}
          </p>
        )}

        {/* Tab headers */}
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {isFundMember && (
            <button
              type="button"
              onClick={() => pickTab("fund")}
              aria-pressed={tab === "fund"}
              className={cn(
                "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-base font-semibold transition-colors",
                tab === "fund"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <PiggyBank className="h-5 w-5" />
              {tDashboard("tabFund")}
              {fundBalance !== null && (
                <span
                  className={cn(
                    "ml-1 text-lg font-bold tabular-nums",
                    hasFund ? "text-primary" : "text-destructive",
                  )}
                >
                  {formatK(fundBalance)}
                </span>
              )}
            </button>
          )}
          {hasDebt && (
            <button
              type="button"
              onClick={() => pickTab("debt")}
              aria-pressed={tab === "debt"}
              className={cn(
                "flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-base font-semibold transition-colors",
                tab === "debt"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Banknote className="h-5 w-5" />
              {tDashboard("tabDebt")}
              <span className="text-destructive ml-1 text-lg font-bold tabular-nums">
                {formatK(outstandingTotal)}
              </span>
            </button>
          )}
        </div>

        {/* Tab content — fund */}
        {tab === "fund" && isFundMember && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                min={1000}
                step={1000}
                placeholder={tDashboard("fundAmountLabel")}
                disabled={fundClaimed}
                className="bg-background min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-base disabled:opacity-60"
                aria-label={tDashboard("fundAmountLabel")}
              />
              {fundClaimed && (
                <StatusBadge variant="needsConfirm">
                  {tFinance("needsConfirm")}
                </StatusBadge>
              )}
            </div>
            <QuickAmountChips
              disabled={fundClaimed}
              current={fundAmount}
              onPick={(v) => setFundAmount(String(v))}
            />
            <PaymentQR
              amount={Math.max(0, parseInt(fundAmount, 10) || 0)}
              memo={fundMemo}
              onPaymentReceived={() => setFundClaimed(false)}
            />
            <Button
              type="button"
              size="sm"
              variant={fundClaimed ? "outline" : "default"}
              onClick={handleClaimFund}
              disabled={pending || fundClaimed}
              className="w-full"
            >
              <CheckCircle className="mr-1 h-4 w-4" />
              {fundClaimed ? tFinance("memberReported") : tFinance("paid")}
            </Button>
          </div>
        )}

        {/* Tab content — debt */}
        {tab === "debt" && hasDebt && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                min={1000}
                step={1000}
                placeholder={tDashboard("debtAmountLabel")}
                disabled={fundClaimed}
                className="bg-background min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-base disabled:opacity-60"
                aria-label={tDashboard("debtAmountLabel")}
              />
              {fundClaimed && (
                <StatusBadge variant="needsConfirm">
                  {tFinance("needsConfirm")}
                </StatusBadge>
              )}
            </div>
            <PaymentQR
              amount={Math.max(0, parseInt(fundAmount, 10) || 0)}
              memo={debtMemo}
              onPaymentReceived={() => setFundClaimed(false)}
            />
            <Button
              type="button"
              size="sm"
              variant={fundClaimed ? "outline" : "default"}
              onClick={handleClaimFund}
              disabled={pending || fundClaimed}
              className="w-full"
            >
              <CheckCircle className="mr-1 h-4 w-4" />
              {fundClaimed ? tFinance("memberReported") : tFinance("paid")}
            </Button>
            <Link
              href="/my-fund"
              className="text-muted-foreground hover:text-foreground block text-center text-xs"
            >
              {tFinance("detail")} →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Quick-amount chips so user không phải gõ keyboard mobile.
 * Bấm chip → set amount. `aria-pressed` cho screen-reader biết chip nào active.
 * Touch target `min-h-11` (44px) khớp guideline.
 */
const QUICK_AMOUNTS = [200_000, 500_000, 1_000_000, 2_000_000];

function QuickAmountChips({
  current,
  onPick,
  disabled,
}: {
  current: string;
  onPick: (v: number) => void;
  disabled?: boolean;
}) {
  const currentN = parseInt(current, 10) || 0;
  return (
    <div className="flex flex-wrap gap-1.5">
      {QUICK_AMOUNTS.map((v) => {
        const active = currentN === v;
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(v)}
            className={cn(
              "min-h-11 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors disabled:opacity-50",
              active
                ? "border-primary bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {formatK(v)}
          </button>
        );
      })}
    </div>
  );
}
