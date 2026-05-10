"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpCircle, ArrowDownCircle, RotateCcw, X } from "lucide-react";
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
  | "bank_payment_received";

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
};

function fmtDateTime(iso: string, locale: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale === "en" ? "en-US" : locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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

  // Ẩn `debt_created` mặc định — nó là audit-only entry (record-keeping), không
  // ảnh hưởng balance member. Mỗi `debt_created` luôn có 1 `fund_deduction`
  // đối ứng đã thể hiện đầy đủ impact → để cả 2 nhìn như duplicate. Reconcile
  // script vẫn truy DB trực tiếp được, admin UI không cần show.
  const visibleTransactions = useMemo(
    () => transactions.filter((tx) => tx.type !== "debt_created"),
    [transactions],
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
                  <TxCard tx={tx} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TxCard({ tx }: { tx: FinancialTransactionRow }) {
  const t = useTranslations("fundAdmin");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reversing, setReversing] = useState(false);
  const meta = TX_TYPE_META[tx.type] ?? {
    labelKey: "txLabelManualAdjustment",
    icon: RotateCcw,
    iconClass: "text-muted-foreground",
  };
  const label = t(meta.labelKey as Parameters<typeof t>[0]);
  const Icon = meta.icon;
  const isAuto = tx.paymentNotificationId !== null;
  const sign = tx.direction === "in" ? "+" : tx.direction === "out" ? "−" : "";
  const amountColor =
    tx.direction === "in"
      ? "text-blue-600 dark:text-blue-400"
      : tx.direction === "out"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";

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
    setReversing(true);
    const idemKey = `reverse-tx-${tx.id}-${
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now()
    }`;
    fireAction(
      () => reverseFinancialTransaction(tx.id, idemKey),
      () => setReversing(false),
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
          "transition-opacity",
          (tx.isReversal || tx.isReversed) && "opacity-60",
        )}
      >
        <CardContent className="flex items-center gap-3 p-3">
          {tx.memberId !== null ? (
            <MemberAvatar
              memberId={tx.memberId}
              avatarKey={tx.memberAvatarKey}
              avatarUrl={tx.memberAvatarUrl}
              size={40}
            />
          ) : (
            <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Icon className={`h-5 w-5 ${meta.iconClass}`} />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Icon className={`h-4 w-4 shrink-0 ${meta.iconClass}`} />
              <span
                className={cn(
                  "truncate text-base font-semibold",
                  tx.isReversed && "line-through",
                )}
              >
                {tx.memberName ?? t("logSystem")}
              </span>
              <span className="text-muted-foreground shrink-0 text-sm">
                · {label}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                  isAuto
                    ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                }`}
              >
                {isAuto ? "QR" : "Admin"}
              </span>
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
            {tx.description && (
              <p
                className={cn(
                  "text-foreground truncate text-sm font-medium",
                  tx.isReversed && "line-through",
                )}
              >
                {tx.description}
              </p>
            )}
            <div className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
              <span>{fmtDateTime(tx.createdAt, locale)}</span>
              {tx.sessionDate && (
                <span>· {t("logSession", { date: tx.sessionDate })}</span>
              )}
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 text-lg font-bold tabular-nums",
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
              disabled={reversing}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-50"
              aria-label={t("ariaUndoTransaction")}
              title={t("ariaUndoTransaction")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
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
