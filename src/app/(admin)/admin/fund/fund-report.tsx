"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  ChevronDown,
  Wallet,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatVND, cn } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";
import type { FundBalance } from "@/lib/fund-calculator";

type Member = InferSelectModel<typeof membersTable>;

interface FundMemberWithBalance {
  id: number;
  memberId: number;
  isActive: boolean | null;
  joinedAt: string | null;
  leftAt: string | null;
  member: Member;
  balance: FundBalance;
}

interface FundTransaction {
  id: number;
  memberId: number;
  type: "fund_contribution" | "fund_deduction" | "fund_refund";
  amount: number;
  sessionId: number | null;
  description: string | null;
  createdAt: string | null;
  member: Member;
  session: { id: number; date: string } | null;
}

type FilterKey = "hasFund" | "depleted" | "owing";

interface Props {
  fundMembers: FundMemberWithBalance[];
  transactions: FundTransaction[];
}

function bucket(balance: number): FilterKey {
  if (balance < 0) return "owing";
  if (balance > 0) return "hasFund";
  return "depleted";
}

function statusFor(
  b: FilterKey,
  t: (key: "filterHasFund" | "filterOwing" | "filterDepleted") => string,
): {
  variant: "paid" | "unpaid" | "neutral";
  label: string;
} {
  if (b === "hasFund") return { variant: "paid", label: t("filterHasFund") };
  if (b === "owing") return { variant: "unpaid", label: t("filterOwing") };
  return { variant: "neutral", label: t("filterDepleted") };
}

export function FundReport({ fundMembers, transactions }: Props) {
  const t = useTranslations("fundAdmin");
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const counts = useMemo(() => {
    const c = { hasFund: 0, depleted: 0, owing: 0 } as Record<
      FilterKey,
      number
    >;
    for (const fm of fundMembers) c[bucket(fm.balance.balance)] += 1;
    return c;
  }, [fundMembers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...fundMembers]
      .filter((fm) => {
        if (filter && bucket(fm.balance.balance) !== filter) return false;
        if (q) {
          const name = (
            fm.member.nickname ||
            fm.member.name ||
            ""
          ).toLowerCase();
          if (!name.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.balance.balance - a.balance.balance);
  }, [fundMembers, filter, search]);

  const txByMember = useMemo(() => {
    const map = new Map<number, FundTransaction[]>();
    for (const tx of transactions) {
      const arr = map.get(tx.memberId) ?? [];
      arr.push(tx);
      map.set(tx.memberId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    }
    return map;
  }, [transactions]);

  const FILTERS: Array<{ key: FilterKey; label: string }> = [
    { key: "hasFund", label: t("filterHasFund") },
    { key: "depleted", label: t("filterDepleted") },
    { key: "owing", label: t("filterOwing") },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("searchMemberPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-background dark:bg-background pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter((prev) => (prev === f.key ? null : f.key));
                  setExpandedId(null);
                }}
                className={cn(
                  "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground hover:bg-muted/80",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "ml-2 rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums",
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm">
            <Wallet className="h-8 w-8 opacity-40" />
            {search.trim()
              ? "Không tìm thấy thành viên nào"
              : filter
                ? "Không có thành viên nào ở trạng thái này"
                : "Chưa có thành viên trong quỹ"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((fm) => {
              const isOpen = expandedId === fm.memberId;
              const memberTxs = txByMember.get(fm.memberId) ?? [];
              const b = bucket(fm.balance.balance);
              const status = statusFor(b, t);
              const balanceColor =
                fm.balance.balance > 0
                  ? "text-green-600 dark:text-green-400"
                  : fm.balance.balance < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground";

              const tones =
                b === "hasFund"
                  ? {
                      bg: "bg-green-500/5 dark:bg-green-500/10",
                      hover: "hover:bg-green-500/10 dark:hover:bg-green-500/15",
                      ring: isOpen
                        ? "ring-2 ring-green-500/50"
                        : "ring-1 ring-green-500/25 dark:ring-green-500/30",
                      open: "bg-green-500/15 dark:bg-green-500/20",
                      divider: "border-green-500/20",
                    }
                  : b === "owing"
                    ? {
                        bg: "bg-red-500/5 dark:bg-red-500/10",
                        hover: "hover:bg-red-500/10 dark:hover:bg-red-500/15",
                        ring: isOpen
                          ? "ring-2 ring-red-500/50"
                          : "ring-1 ring-red-500/25 dark:ring-red-500/30",
                        open: "bg-red-500/15 dark:bg-red-500/20",
                        divider: "border-red-500/20",
                      }
                    : {
                        bg: "bg-muted/40",
                        hover: "hover:bg-muted/60",
                        ring: isOpen
                          ? "ring-2 ring-foreground/25"
                          : "ring-1 ring-border",
                        open: "bg-muted/70",
                        divider: "border-border",
                      };

              return (
                <motion.div
                  key={fm.memberId}
                  layout
                  className={cn(
                    "overflow-hidden rounded-xl shadow-sm transition-colors",
                    tones.bg,
                    tones.ring,
                    isOpen && tones.open,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : fm.memberId)}
                    className={cn(
                      "flex w-full items-center gap-3 p-3 text-left transition-colors",
                      tones.hover,
                    )}
                  >
                    <MemberAvatar
                      memberId={fm.memberId}
                      avatarKey={fm.member.avatarKey}
                      avatarUrl={fm.member.avatarUrl}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">
                        {fm.member.nickname || fm.member.name}
                      </p>
                      <p
                        className={cn(
                          "text-base font-bold tabular-nums",
                          balanceColor,
                        )}
                      >
                        {formatVND(fm.balance.balance)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <StatusBadge variant={status.variant}>
                        {status.label}
                      </StatusBadge>
                      <span
                        className={cn(
                          "bg-background/60 text-muted-foreground inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium",
                        )}
                      >
                        Chi tiết
                        <ChevronDown
                          className={cn(
                            "ml-1 h-4 w-4 transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </span>
                    </div>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="detail"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className={cn("border-t", tones.divider)}
                      >
                        <div className="bg-background/40 grid grid-cols-3 gap-2 p-3 text-center">
                          <SummaryTile
                            label="Đã đóng"
                            value={fm.balance.totalContributions}
                            color="text-green-600 dark:text-green-400"
                          />
                          <SummaryTile
                            label="Đã trừ"
                            value={fm.balance.totalDeductions}
                            color="text-orange-600 dark:text-orange-400"
                          />
                          <SummaryTile
                            label="Đã hoàn"
                            value={fm.balance.totalRefunds}
                            color="text-red-600 dark:text-red-400"
                          />
                        </div>
                        <div className="divide-y">
                          {memberTxs.length === 0 ? (
                            <p className="text-muted-foreground p-4 text-center text-sm">
                              Chưa có lịch sử quỹ
                            </p>
                          ) : (
                            memberTxs.map((tx) => <TxRow key={tx.id} tx={tx} />)
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("text-sm font-bold tabular-nums", color)}>
        {formatVND(value)}
      </p>
    </div>
  );
}

function TxRow({ tx }: { tx: FundTransaction }) {
  const t = useTranslations("fundAdmin");
  const isContribution = tx.type === "fund_contribution";
  const isDeduction = tx.type === "fund_deduction";
  const Icon = isContribution
    ? ArrowUpCircle
    : isDeduction
      ? ArrowDownCircle
      : RotateCcw;
  const iconColor = isContribution
    ? "text-green-500"
    : isDeduction
      ? "text-orange-500"
      : "text-red-500";
  const amountColor = isContribution
    ? "text-green-600 dark:text-green-400"
    : "text-red-600 dark:text-red-400";
  const sign = isContribution ? "+" : "−";
  const date = tx.createdAt
    ? formatSessionDate(tx.createdAt.slice(0, 10), "long")
    : "";
  const typeLabel = isContribution
    ? t("txLabelContribution")
    : isDeduction
      ? t("txLabelDeduction")
      : t("txLabelRefund");

  return (
    <div className="flex items-center gap-3 p-3">
      <Icon className={cn("h-5 w-5 shrink-0", iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{typeLabel}</p>
        <p className="text-muted-foreground text-xs">
          {date}
          {tx.session && ` · ${t("logSession", { date: tx.session.date })}`}
          {tx.description && ` · ${tx.description}`}
        </p>
      </div>
      <p className={cn("text-sm font-bold tabular-nums", amountColor)}>
        {sign}
        {formatVND(tx.amount)}
      </p>
    </div>
  );
}
