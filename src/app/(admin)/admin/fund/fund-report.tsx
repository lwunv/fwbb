"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  ChevronDown,
  Wallet,
  Plus,
  Minus,
  Check,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/shared/search-input";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatVND, formatK, cn } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import { fireAction } from "@/lib/optimistic-action";
import { recordContribution, recordRefund } from "@/actions/fund";
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
  variant: "paid" | "unpaid" | "depleted";
  label: string;
} {
  if (b === "hasFund") return { variant: "paid", label: t("filterHasFund") };
  if (b === "owing") return { variant: "unpaid", label: t("filterOwing") };
  return { variant: "depleted", label: t("filterDepleted") };
}

export function FundReport({ fundMembers, transactions }: Props) {
  const t = useTranslations("fundAdmin");
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<string>("");
  const [adjustDesc, setAdjustDesc] = useState<string>("");
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1);
  const [adjustDirty, setAdjustDirty] = useState(false);
  const [adjustFocused, setAdjustFocused] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  function handleAdjust(memberId: number) {
    const amount = parseInt(adjustAmount, 10);
    if (!amount || amount <= 0) {
      toast.error("Nhập số tiền hợp lệ");
      return;
    }
    const sign = adjustSign;
    const desc = adjustDesc.trim() || undefined;
    const idemKey = `${sign === 1 ? "contrib" : "refund"}-${crypto.randomUUID()}`;
    setAdjusting(true);
    fireAction(
      () =>
        sign === 1
          ? recordContribution(memberId, amount, desc, idemKey)
          : recordRefund(memberId, amount, desc, idemKey),
      () => setAdjusting(false),
      {
        successMsg:
          sign === 1
            ? `Đã cộng ${formatVND(amount)} vào quỹ`
            : `Đã trừ ${formatVND(amount)} khỏi quỹ`,
        onSuccess: () => {
          setAdjusting(false);
          setAdjustAmount("");
          setAdjustDesc("");
          setAdjustDirty(false);
          setAdjustSign(1);
        },
      },
    );
  }

  /**
   * One-click clear debt: cộng đúng `-balance` để bring balance về 0. Lưu
   * description "Đã hết nợ" để log dễ nhận diện. Idempotent qua
   * `idemKey` (UUID/click) — DB UNIQUE INDEX trên financial_transactions
   *  ngăn double-submit nếu user lỡ bấm liên tục.
   */
  function handleClearDebt(memberId: number, balance: number) {
    if (balance >= 0) return;
    const amount = -balance;
    const idemKey = `clear-debt-${memberId}-${crypto.randomUUID()}`;
    setAdjusting(true);
    fireAction(
      () => recordContribution(memberId, amount, t("clearDebtNote"), idemKey),
      () => setAdjusting(false),
      {
        successMsg: t("toastClearDebt", { amount: formatVND(amount) }),
        onSuccess: () => {
          setAdjusting(false);
          setAdjustAmount("");
          setAdjustDesc("");
          setAdjustDirty(false);
          setAdjustSign(1);
        },
      },
    );
  }

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
        <SearchInput
          placeholder={t("searchMemberPlaceholder")}
          value={search}
          onChange={setSearch}
        />
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
                  "h-[42px] rounded-full border px-4 text-sm font-medium transition-colors",
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
                  ? "text-blue-600 dark:text-blue-400"
                  : fm.balance.balance < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-yellow-600 dark:text-yellow-400";

              // Card neutral — chỉ dùng accent ở viền trái + status badge
              // top-right để nhận biết trạng thái. Tránh tô màu toàn card
              // (xấu trên pink theme + chói mắt khi list dài).
              const tones =
                b === "hasFund"
                  ? {
                      bg: "bg-card",
                      hover: "hover:bg-muted/40",
                      ring: isOpen
                        ? "ring-1 ring-blue-500/40"
                        : "ring-1 ring-border",
                      open: "",
                      divider: "border-border",
                      accent: "border-l-4 border-l-blue-500/60",
                    }
                  : b === "owing"
                    ? {
                        bg: "bg-card",
                        hover: "hover:bg-muted/40",
                        ring: isOpen
                          ? "ring-1 ring-rose-500/40"
                          : "ring-1 ring-border",
                        open: "",
                        divider: "border-border",
                        accent: "border-l-4 border-l-rose-500/60",
                      }
                    : {
                        bg: "bg-card",
                        hover: "hover:bg-muted/40",
                        ring: isOpen
                          ? "ring-1 ring-yellow-500/40"
                          : "ring-1 ring-border",
                        open: "",
                        divider: "border-border",
                        accent: "border-l-4 border-l-yellow-500/60",
                      };

              return (
                <div
                  key={fm.memberId}
                  className={cn(
                    "overflow-hidden rounded-xl shadow-sm transition-colors",
                    tones.bg,
                    tones.ring,
                    tones.accent,
                    isOpen && tones.open,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : fm.memberId)}
                    className={cn(
                      "flex w-full items-center gap-4 px-3 py-2 text-left transition-colors",
                      tones.hover,
                    )}
                  >
                    <MemberAvatar
                      memberId={fm.memberId}
                      avatarKey={fm.member.avatarKey}
                      avatarUrl={fm.member.avatarUrl}
                      size={32}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {fm.member.nickname || fm.member.name}
                    </span>
                    <span
                      className={cn(
                        "min-w-24 shrink-0 text-right text-base font-bold tabular-nums",
                        balanceColor,
                      )}
                    >
                      {formatK(fm.balance.balance)}
                    </span>
                    <StatusBadge
                      variant={status.variant}
                      className="w-[110px] shrink-0 justify-center"
                    >
                      {status.label}
                    </StatusBadge>
                    <ChevronDown
                      className={cn(
                        "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
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
                        <div className="grid grid-cols-3 gap-2 p-3 text-center">
                          <SummaryTile
                            label="Đã đóng"
                            value={fm.balance.totalContributions}
                            color="text-blue-600 dark:text-blue-400"
                          />
                          <SummaryTile
                            label="Đã trừ"
                            value={fm.balance.totalDeductions}
                            color="text-amber-600 dark:text-amber-400"
                          />
                          <SummaryTile
                            label="Đã hoàn"
                            value={fm.balance.totalRefunds}
                            color="text-rose-600 dark:text-rose-400"
                          />
                        </div>

                        {/* Inline adjust quỹ — sign toggle + amount + Lưu button.
                            Lưu chỉ hiện khi user đã sửa value và đã unfocus. */}
                        <div
                          className={cn(
                            "space-y-2 border-t p-3",
                            tones.divider,
                          )}
                        >
                          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                            Điều chỉnh quỹ
                          </p>

                          {/* 3 actions cùng 1 row khi đang nợ ([Đã hết nợ |
                              Cộng quỹ | Trừ quỹ]); fallback 2-col khi không nợ.
                              Mỗi button 1 màu: primary (pink) cho clear-debt,
                              blue cho cộng, rose cho trừ. */}
                          <div
                            className={cn(
                              "grid gap-2",
                              fm.balance.balance < 0
                                ? "grid-cols-3"
                                : "grid-cols-2",
                            )}
                          >
                            {fm.balance.balance < 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleClearDebt(
                                    fm.memberId,
                                    fm.balance.balance,
                                  )
                                }
                                disabled={adjusting}
                                className="border-primary bg-card text-primary hover:bg-primary/10 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
                              >
                                <Check className="h-4 w-4" />
                                <span className="truncate">
                                  Hết nợ {formatK(-fm.balance.balance)}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setAdjustSign(1)}
                              disabled={adjusting}
                              className={cn(
                                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold transition-colors disabled:opacity-50",
                                adjustSign === 1
                                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                  : "border-border text-muted-foreground hover:bg-muted/50",
                              )}
                            >
                              <Plus className="h-4 w-4" /> Cộng quỹ
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdjustSign(-1)}
                              disabled={adjusting}
                              className={cn(
                                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold transition-colors disabled:opacity-50",
                                adjustSign === -1
                                  ? "border-rose-500 bg-rose-500 text-white shadow-sm"
                                  : "border-border text-muted-foreground hover:bg-muted/50",
                              )}
                            >
                              <Minus className="h-4 w-4" /> Trừ quỹ
                            </button>
                          </div>

                          <Input
                            type="text"
                            inputMode="numeric"
                            value={
                              adjustAmount
                                ? Number(adjustAmount).toLocaleString("vi-VN")
                                : ""
                            }
                            onChange={(e) => {
                              setAdjustAmount(
                                e.target.value.replace(/\D/g, ""),
                              );
                              setAdjustDirty(true);
                            }}
                            onFocus={() => setAdjustFocused(true)}
                            onBlur={() => setAdjustFocused(false)}
                            placeholder={t("adjustAmountPlaceholder")}
                            className="tabular-nums"
                            aria-label={t("ariaAdjustAmount")}
                            disabled={adjusting}
                          />
                          <Input
                            type="text"
                            value={adjustDesc}
                            onChange={(e) => {
                              setAdjustDesc(e.target.value);
                              setAdjustDirty(true);
                            }}
                            onFocus={() => setAdjustFocused(true)}
                            onBlur={() => setAdjustFocused(false)}
                            placeholder={t("adjustNotePlaceholder")}
                            disabled={adjusting}
                          />

                          {/* Lưu button — chỉ hiện khi user đã sửa giá trị + đã
                              unfocus (input.blur). Click → fire action + ghi
                              vào financial_transactions log. */}
                          <AnimatePresence initial={false}>
                            {adjustDirty &&
                              !adjustFocused &&
                              parseInt(adjustAmount, 10) > 0 && (
                                <motion.button
                                  key="save"
                                  type="button"
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  onClick={() => handleAdjust(fm.memberId)}
                                  disabled={adjusting}
                                  className={cn(
                                    "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-50",
                                    adjustSign === 1
                                      ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                                      : "bg-rose-500 hover:bg-rose-600",
                                  )}
                                >
                                  Lưu — {adjustSign === 1 ? "Cộng" : "Trừ"}{" "}
                                  {formatK(parseInt(adjustAmount, 10) || 0)}
                                </motion.button>
                              )}
                          </AnimatePresence>
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
                </div>
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
        {formatK(value)}
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
    ? "text-blue-500"
    : isDeduction
      ? "text-amber-500"
      : "text-rose-500";
  const amountColor = isContribution
    ? "text-blue-600 dark:text-blue-400"
    : "text-rose-600 dark:text-rose-400";
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
        {formatK(tx.amount)}
      </p>
    </div>
  );
}
