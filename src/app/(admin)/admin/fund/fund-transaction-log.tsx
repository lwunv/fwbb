"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  X,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { CustomSelect } from "@/components/ui/custom-select";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { TabSegment } from "@/components/shared/tab-segment";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/search-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { fireAction } from "@/lib/optimistic-action";
import { reverseFinancialTransaction } from "@/actions/fund";
import { formatK, cn } from "@/lib/utils";

type FinancialTxType =
  | "fund_contribution"
  | "fund_deduction"
  | "fund_refund"
  | "debt_created"
  | "debt_member_confirmed"
  | "debt_admin_confirmed"
  | "debt_undo"
  | "inventory_purchase"
  | "court_rent_payment"
  | "manual_adjustment"
  | "bank_payment_received"
  | "session_guest_income";

export interface FinancialTransactionRow {
  id: number;
  memberId: number | null;
  memberName: string | null;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  type: FinancialTxType;
  direction: "in" | "out" | "neutral";
  amount: number;
  description: string | null;
  sessionDate: string | null;
  paymentNotificationId: number | null;
  createdAt: string;
  /** Row IS a reversal entry (reversalOfId !== null on DB). */
  isReversal?: boolean;
  /** Row đã bị 1 reversal trỏ về (đã hủy). */
  isReversed?: boolean;
}

const REVERSIBLE_TYPES = new Set<FinancialTxType>([
  "fund_contribution",
  "fund_refund",
]);

const TX_TYPE_META: Record<
  FinancialTxType,
  { labelKey: string; icon: typeof ArrowUpCircle; iconClass: string }
> = {
  fund_contribution: {
    labelKey: "txLabelContribution",
    icon: ArrowUpCircle,
    iconClass: "text-green-500",
  },
  fund_deduction: {
    labelKey: "txLabelDeduction",
    icon: ArrowDownCircle,
    iconClass: "text-orange-500",
  },
  fund_refund: {
    labelKey: "txLabelRefund",
    icon: RotateCcw,
    iconClass: "text-red-500",
  },
  debt_created: {
    labelKey: "txLabelDebtCreated",
    icon: ArrowDownCircle,
    iconClass: "text-amber-500",
  },
  debt_member_confirmed: {
    labelKey: "txLabelMemberPaid",
    icon: ArrowUpCircle,
    iconClass: "text-blue-500",
  },
  debt_admin_confirmed: {
    labelKey: "txLabelAdminConfirmed",
    icon: ArrowUpCircle,
    iconClass: "text-emerald-500",
  },
  debt_undo: {
    labelKey: "txLabelDebtUndo",
    icon: RotateCcw,
    iconClass: "text-muted-foreground",
  },
  inventory_purchase: {
    labelKey: "txLabelInventoryPurchase",
    icon: ArrowDownCircle,
    iconClass: "text-orange-500",
  },
  court_rent_payment: {
    labelKey: "txLabelCourtRent",
    icon: ArrowDownCircle,
    iconClass: "text-orange-500",
  },
  manual_adjustment: {
    labelKey: "txLabelManualAdjustment",
    icon: RotateCcw,
    iconClass: "text-muted-foreground",
  },
  bank_payment_received: {
    labelKey: "txLabelBankReceived",
    icon: ArrowUpCircle,
    iconClass: "text-green-500",
  },
  session_guest_income: {
    labelKey: "txLabelGuestIncome",
    icon: ArrowUpCircle,
    iconClass: "text-green-500",
  },
};

// "HH:MM · DD/MM/YYYY" — time first, then date (per mockup). Ordering within
// each part still respects locale (vi-VN → DD/MM/YYYY, 24h).
function fmtDateTime(iso: string, locale: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const loc = locale === "en" ? "en-US" : locale;
    const time = d.toLocaleTimeString(loc, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const date = d.toLocaleDateString(loc, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return `${time} · ${date}`;
  } catch {
    return iso;
  }
}

interface Props {
  transactions: FinancialTransactionRow[];
}

export function FundTransactionLog({ transactions }: Props) {
  const t = useTranslations("fundAdmin");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "auto" | "admin">(
    "all",
  );
  const [directionFilter, setDirectionFilter] = useState<"all" | "in" | "out">(
    "all",
  );

  // Mirror server prop vào local state để undo có thể patch `isReversed` ngay
  // lập tức; resync khi prop đổi (sau revalidate / rollback) theo pattern
  // "adjust state on prop change".
  const [txs, setTxs] = useState(transactions);
  const [prevTxs, setPrevTxs] = useState(transactions);
  if (transactions !== prevTxs) {
    setPrevTxs(transactions);
    setTxs(transactions);
  }

  // Optimistic: đánh dấu row là đã hủy (line-through + badge "Đã hủy" +
  // opacity-60, đồng thời ẩn nút hủy vì canReverse thành false).
  const markReversed = (id: number, value: boolean) =>
    setTxs((cur) =>
      cur.map((tx) => (tx.id === id ? { ...tx, isReversed: value } : tx)),
    );

  // Ẩn `debt_created` mặc định — nó là audit-only entry (record-keeping), không
  // ảnh hưởng balance member. Mỗi `debt_created` luôn có 1 `fund_deduction`
  // đối ứng đã thể hiện đầy đủ impact → để cả 2 nhìn như duplicate. Reconcile
  // script vẫn truy DB trực tiếp được, admin UI không cần show.
  const visibleTransactions = useMemo(
    () => txs.filter((tx) => tx.type !== "debt_created"),
    [txs],
  );

  const counts = useMemo(() => {
    let auto = 0;
    let admin = 0;
    for (const tx of visibleTransactions) {
      if (tx.paymentNotificationId !== null) auto++;
      else admin++;
    }
    return { all: visibleTransactions.length, auto, admin };
  }, [visibleTransactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleTransactions.filter((tx) => {
      const isAuto = tx.paymentNotificationId !== null;
      if (sourceFilter === "auto" && !isAuto) return false;
      if (sourceFilter === "admin" && isAuto) return false;
      if (directionFilter === "in" && tx.direction !== "in") return false;
      if (directionFilter === "out" && tx.direction !== "out") return false;
      if (q) {
        const name = (tx.memberName ?? "").toLowerCase();
        const desc = (tx.description ?? "").toLowerCase();
        if (!name.includes(q) && !desc.includes(q)) return false;
      }
      return true;
    });
  }, [visibleTransactions, search, sourceFilter, directionFilter]);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="text-lg font-bold">{t("logTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("logSubtitle")}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_minmax(180px,220px)]">
          <SearchInput
            placeholder={t("logSearchPlaceholder")}
            value={search}
            onChange={setSearch}
          />
          <CustomSelect
            value={directionFilter}
            onChange={(v) => setDirectionFilter(v as "all" | "in" | "out")}
            options={[
              { value: "all", label: t("logFilterAllDirections") },
              { value: "in", label: t("logFilterIn") },
              { value: "out", label: t("logFilterOut") },
            ]}
          />
        </div>

        <TabSegment<"all" | "auto" | "admin">
          variant="pills"
          value={sourceFilter}
          onChange={(v) => setSourceFilter(v)}
          options={[
            { value: "all", label: t("logSourceAll"), badge: counts.all },
            { value: "auto", label: t("logSourceAuto"), badge: counts.auto },
            { value: "admin", label: t("logSourceAdmin"), badge: counts.admin },
          ]}
        />

        {filtered.length === 0 ? (
          <EmptyState
            variant="inline"
            title={
              visibleTransactions.length === 0
                ? t("logEmptyAll")
                : t("logEmptyFiltered")
            }
          />
        ) : (
          <ul className="space-y-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((tx) => (
                <motion.li
                  key={tx.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                >
                  <TxCard
                    tx={tx}
                    onReverse={(id) => markReversed(id, true)}
                    onReverseRollback={(id) => markReversed(id, false)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TxCard({
  tx,
  onReverse,
  onReverseRollback,
}: {
  tx: FinancialTransactionRow;
  onReverse: (id: number) => void;
  onReverseRollback: (id: number) => void;
}) {
  const t = useTranslations("fundAdmin");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const meta = TX_TYPE_META[tx.type] ?? {
    labelKey: "txLabelManualAdjustment",
    icon: RotateCcw,
    iconClass: "text-muted-foreground",
  };
  const label = t(meta.labelKey as Parameters<typeof t>[0]);
  const Icon = meta.icon;
  const isAuto = tx.paymentNotificationId !== null;
  const sign = tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : "";
  // Green = money in, rose = money out (per mockup). Neutral keeps foreground.
  const amountColor =
    tx.direction === "in"
      ? "text-green-600 dark:text-green-400"
      : tx.direction === "out"
        ? "text-rose-600 dark:text-rose-400"
        : "text-foreground";
  // Left accent stripe mirrors the amount color.
  const accentClass =
    tx.direction === "in"
      ? "border-l-green-500"
      : tx.direction === "out"
        ? "border-l-rose-500"
        : "border-l-border";

  // Cancel button chỉ hiện khi:
  //   - type ∈ {fund_contribution, fund_refund} (chuẩn fintech: không cho
  //     hủy deduction allocation, debt, group expense — đã có flow riêng).
  //   - Không phải auto từ QR webhook (tiền đã thật vào ngân hàng → không
  //     thể hủy bằng admin click; cần xử lý qua refund kênh khác).
  //   - Row chưa bị reversal nào trỏ về.
  //   - Row chính nó không phải là reversal.
  const canReverse =
    !isAuto &&
    !tx.isReversal &&
    !tx.isReversed &&
    REVERSIBLE_TYPES.has(tx.type);

  function handleConfirm() {
    setConfirmOpen(false);
    // Optimistic: đánh dấu row đã hủy ngay (line-through + badge + ẩn nút).
    onReverse(tx.id);
    const idemKey = `reverse-tx-${tx.id}-${
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now()
    }`;
    fireAction(
      () => reverseFinancialTransaction(tx.id, idemKey),
      () => onReverseRollback(tx.id),
      {
        successMsg: t("toastUndoTransaction"),
      },
    );
  }

  return (
    <>
      <Card
        size="sm"
        className={cn(
          "border-l-4 transition-opacity",
          accentClass,
          (tx.isReversal || tx.isReversed) && "opacity-60",
        )}
      >
        <CardContent className="flex items-center gap-3 p-3">
          {/* Avatar + direction badge overlay (↑ green in / ↓ rose out) */}
          <div className="relative shrink-0">
            {tx.memberId !== null ? (
              <MemberAvatar
                memberId={tx.memberId}
                avatarKey={tx.memberAvatarKey}
                avatarUrl={tx.memberAvatarUrl}
                size={40}
              />
            ) : (
              <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
                <Icon className={cn("h-5 w-5", meta.iconClass)} />
              </div>
            )}
            {tx.direction !== "neutral" && (
              <span
                aria-hidden
                className={cn(
                  "ring-card absolute -right-0.5 -bottom-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full ring-2",
                  tx.direction === "in" ? "bg-green-500" : "bg-rose-500",
                )}
              >
                {tx.direction === "in" ? (
                  <ArrowUp className="h-3 w-3 text-white" strokeWidth={3} />
                ) : (
                  <ArrowDown className="h-3 w-3 text-white" strokeWidth={3} />
                )}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            {/* Name + ADMIN badge (admin/system tx only) + reversal badges */}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-base font-semibold",
                  tx.isReversed && "line-through",
                )}
              >
                {tx.memberName ?? t("logSystem")}
              </span>
              {!isAuto && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 uppercase dark:text-amber-400">
                  Admin
                </span>
              )}
              {tx.isReversal && (
                <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-700 uppercase dark:text-rose-300">
                  Reversal
                </span>
              )}
              {tx.isReversed && (
                <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase">
                  Đã hủy
                </span>
              )}
            </div>

            {/* Transaction type label */}
            <div className="flex items-center gap-1.5">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.iconClass)} />
              <span
                className={cn(
                  "text-muted-foreground truncate text-sm",
                  tx.isReversed && "line-through",
                )}
              >
                {label}
              </span>
            </div>

            {tx.description && (
              <p
                className={cn(
                  "text-muted-foreground truncate text-sm",
                  tx.isReversed && "line-through",
                )}
              >
                {tx.description}
              </p>
            )}

            {/* Time · date (+ optional session) */}
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-sm">
              <span>{fmtDateTime(tx.createdAt, locale)}</span>
              {tx.sessionDate && (
                <span>· {t("logSession", { date: tx.sessionDate })}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "text-lg font-bold tabular-nums",
                amountColor,
                tx.isReversed && "line-through",
              )}
            >
              {sign}
              {formatK(tx.amount)}
            </span>
            {canReverse && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="border-destructive/30 text-destructive hover:bg-destructive/10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
                aria-label={t("ariaUndoTransaction")}
                title={t("ariaUndoTransaction")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("undoConfirmTitle")}
        description={`Sẽ tạo 1 entry reversal trong ledger (${sign}${formatK(
          tx.amount,
        )} → đảo dấu). Row gốc vẫn được giữ làm audit trail. Tiếp tục?`}
        confirmLabel="Hủy giao dịch"
        cancelLabel={tCommon("cancel")}
        variant="destructive"
        onConfirm={handleConfirm}
      />
    </>
  );
}
