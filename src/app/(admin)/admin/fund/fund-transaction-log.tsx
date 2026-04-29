"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { CustomSelect } from "@/components/ui/custom-select";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";

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
}

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

  const counts = useMemo(() => {
    let auto = 0;
    let admin = 0;
    for (const tx of transactions) {
      if (tx.paymentNotificationId !== null) auto++;
      else admin++;
    }
    return { all: transactions.length, auto, admin };
  }, [transactions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
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
  }, [transactions, search, sourceFilter, directionFilter]);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h2 className="text-lg font-bold">{t("logTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("logSubtitle")}</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_minmax(180px,220px)]">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t("logSearchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background dark:bg-background focus:ring-primary h-12 w-full rounded-xl border pr-4 pl-11 text-base outline-none focus:ring-1"
            />
          </div>
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

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              {
                key: "all" as const,
                label: t("logSourceAll"),
                count: counts.all,
              },
              {
                key: "auto" as const,
                label: t("logSourceAuto"),
                count: counts.auto,
              },
              {
                key: "admin" as const,
                label: t("logSourceAdmin"),
                count: counts.admin,
              },
            ] as const
          ).map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSourceFilter(key)}
              className={`min-h-11 rounded-xl px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
                sourceFilter === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {label}
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                  sourceFilter === key
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-background/60 text-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            {transactions.length === 0
              ? t("logEmptyAll")
              : t("logEmptyFiltered")}
          </div>
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
  const locale = useLocale();
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
      ? "text-green-600 dark:text-green-400"
      : tx.direction === "out"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";

  return (
    <Card size="sm">
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
            <span className="truncate text-base font-semibold">
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
          </div>
          {/* Description đứng trước, đậm hơn để admin scan info nhanh */}
          {tx.description && (
            <p className="text-foreground truncate text-sm font-medium">
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
          className={`shrink-0 text-lg font-bold tabular-nums ${amountColor}`}
        >
          {sign}
          {formatK(tx.amount)}
        </span>
      </CardContent>
    </Card>
  );
}
