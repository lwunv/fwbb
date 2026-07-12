"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Wallet,
  Plus,
  Minus,
  Check,
  Pencil,
  X,
  History,
} from "lucide-react";
import { MemberPlayHistorySheet } from "@/components/members/member-play-history-sheet";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { SearchInput } from "@/components/shared/search-input";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatVND, formatK, cn } from "@/lib/utils";
import { formatSessionDate } from "@/lib/date-format";
import { fireAction } from "@/lib/optimistic-action";
import { getFundStatus, type FundStatus } from "@/lib/fund-core";
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

type FilterKey = FundStatus;

interface Props {
  fundMembers: FundMemberWithBalance[];
  transactions: FundTransaction[];
}

function statusFor(
  b: FilterKey,
  t: (
    key: "filterHasFund" | "filterOwing" | "filterDepleted" | "filterLowFund",
  ) => string,
): {
  variant: "paid" | "unpaid" | "depleted" | "lowFund";
  label: string;
} {
  if (b === "hasFund") return { variant: "paid", label: t("filterHasFund") };
  if (b === "owing") return { variant: "unpaid", label: t("filterOwing") };
  if (b === "lowFund") return { variant: "lowFund", label: t("filterLowFund") };
  return { variant: "depleted", label: t("filterDepleted") };
}

export function FundReport({ fundMembers, transactions }: Props) {
  const t = useTranslations("fundAdmin");
  const tHistory = useTranslations("memberHistory");
  const [filter, setFilter] = useState<FilterKey | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<string>("");
  const [adjustDesc, setAdjustDesc] = useState<string>("");
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1);
  const [adjustDirty, setAdjustDirty] = useState(false);
  const [adjustFocused, setAdjustFocused] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  // Inline balance edit — click pencil bên cạnh số dư trên row header để mở
  // stepper trực tiếp, set balance đến giá trị mong muốn. Auto-compute diff
  // và gọi recordContribution / recordRefund.
  const [editingBalanceId, setEditingBalanceId] = useState<number | null>(null);
  const [balanceDraft, setBalanceDraft] = useState(0);

  function startEditBalance(memberId: number, currentBalance: number) {
    setEditingBalanceId(memberId);
    setBalanceDraft(Math.max(0, currentBalance));
  }

  function cancelEditBalance() {
    setEditingBalanceId(null);
    setBalanceDraft(0);
  }

  function submitBalanceEdit(memberId: number, currentBalance: number) {
    const diff = balanceDraft - currentBalance;
    if (diff === 0) {
      toast.info("Số tiền không thay đổi");
      setEditingBalanceId(null);
      setBalanceDraft(0);
      return;
    }
    const idemKey = `${diff > 0 ? "set-contrib" : "set-refund"}-${crypto.randomUUID()}`;
    setAdjusting(true);
    fireAction(
      () =>
        diff > 0
          ? recordContribution(memberId, diff, "Sửa balance", idemKey)
          : recordRefund(memberId, -diff, "Sửa balance", idemKey),
      () => setAdjusting(false),
      {
        successMsg: `Đã set balance → ${formatVND(balanceDraft)}`,
        onSuccess: () => {
          setAdjusting(false);
          setEditingBalanceId(null);
          setBalanceDraft(0);
        },
      },
    );
  }

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
    const c = { hasFund: 0, depleted: 0, lowFund: 0, owing: 0 } as Record<
      FilterKey,
      number
    >;
    for (const fm of fundMembers) c[getFundStatus(fm.balance.balance)] += 1;
    return c;
  }, [fundMembers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...fundMembers]
      .filter((fm) => {
        if (filter && getFundStatus(fm.balance.balance) !== filter)
          return false;
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
    { key: "lowFund", label: t("filterLowFund") },
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
              const b = getFundStatus(fm.balance.balance);
              const status = statusFor(b, t);
              const balanceColor =
                b === "hasFund"
                  ? "text-blue-600 dark:text-blue-400"
                  : b === "owing"
                    ? "text-rose-600 dark:text-rose-400"
                    : b === "lowFund"
                      ? "text-orange-600 dark:text-orange-400"
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
                    : b === "lowFund"
                      ? {
                          bg: "bg-card",
                          hover: "hover:bg-muted/40",
                          ring: isOpen
                            ? "ring-1 ring-orange-500/40"
                            : "ring-1 ring-border",
                          open: "",
                          divider: "border-border",
                          accent: "border-l-4 border-l-orange-500/60",
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
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (editingBalanceId === fm.memberId) return;
                      setExpandedId(isOpen ? null : fm.memberId);
                    }}
                    onKeyDown={(e) => {
                      if (editingBalanceId === fm.memberId) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedId(isOpen ? null : fm.memberId);
                      }
                    }}
                    className={cn(
                      "flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-left transition-colors",
                      tones.hover,
                    )}
                  >
                    {/* Danh tính — avatar + tên, badge trạng thái làm phụ đề
                        dưới tên. flex-1/min-w-0 (basis 0) nên luôn ở dòng 1;
                        badge sizing theo nội dung (w-fit) để không kéo giãn
                        hàng như bản cũ (w-[110px] cố định gây tràn mobile). */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <MemberAvatar
                        memberId={fm.memberId}
                        avatarKey={fm.member.avatarKey}
                        avatarUrl={fm.member.avatarUrl}
                        size={32}
                        className="shrink-0"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-sm font-semibold">
                          {fm.member.nickname || fm.member.name}
                        </span>
                        <StatusBadge variant={status.variant} className="w-fit">
                          {status.label}
                        </StatusBadge>
                      </div>
                    </div>

                    {/* Cụm phải — số dư + nút sửa/lịch sử (hoặc stepper khi
                        đang edit). w-full để rớt xuống dòng riêng trên mobile
                        (khớp pattern member-list), chung dòng từ sm: trở lên.
                        Trước đây cả cụm shrink-0 trên 1 hàng nên tràn + bị
                        overflow-hidden của card cắt mất badge/chevron. */}
                    {editingBalanceId === fm.memberId ? (
                      <div
                        className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <NumberStepper
                          value={balanceDraft}
                          onChange={setBalanceDraft}
                          step={1_000}
                          min={0}
                          max={100_000_000}
                          disabled={adjusting}
                          displayFormat="vnd"
                          className="min-w-0 flex-1 sm:w-44 sm:flex-none"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            submitBalanceEdit(fm.memberId, fm.balance.balance);
                          }}
                          disabled={adjusting}
                          aria-label="Lưu balance"
                          title="Lưu"
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-500 bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEditBalance();
                          }}
                          disabled={adjusting}
                          aria-label="Hủy"
                          title="Hủy"
                          className="border-border text-muted-foreground hover:bg-muted/50 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-60"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                        <span
                          className={cn(
                            "text-right text-base font-bold tabular-nums",
                            balanceColor,
                          )}
                        >
                          {formatK(fm.balance.balance)}
                        </span>
                        <div className="ml-auto flex items-center gap-2 sm:ml-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditBalance(fm.memberId, fm.balance.balance);
                            }}
                            aria-label="Sửa balance"
                            title="Sửa balance"
                            className="border-border text-muted-foreground hover:bg-muted/50 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setHistoryTarget({
                                id: fm.memberId,
                                name: fm.member.nickname || fm.member.name,
                              });
                            }}
                            aria-label={tHistory("openHistory")}
                            title={tHistory("openHistory")}
                            className="border-border text-muted-foreground hover:bg-muted/50 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          <ChevronDown
                            className={cn(
                              "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                              isOpen && "rotate-180",
                            )}
                          />
                        </div>
                      </div>
                    )}
                  </div>

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

                        <MemberTxList transactions={memberTxs} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
        <MemberPlayHistorySheet
          memberId={historyTarget?.id ?? null}
          memberName={historyTarget?.name ?? ""}
          onClose={() => setHistoryTarget(null)}
        />
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

type TxFilterType = "all" | FundTransaction["type"];
type TxSortMode = "newest" | "oldest" | "amountDesc" | "amountAsc";
const TX_PAGE_SIZE = 5;

/**
 * Lịch sử giao dịch quỹ của 1 member trong panel expand. Có thể dài hàng
 * chục dòng theo thời gian nên cần filter theo loại + sort + phân trang +
 * giới hạn chiều cao, thay vì render phẳng toàn bộ (spec 2026-07-03).
 */
function MemberTxList({ transactions }: { transactions: FundTransaction[] }) {
  const t = useTranslations("fundAdmin");
  const tHistory = useTranslations("memberHistory");
  const [filterType, setFilterType] = useState<TxFilterType>("all");
  const [sortMode, setSortMode] = useState<TxSortMode>("newest");
  const [page, setPage] = useState(1);

  const filtered =
    filterType === "all"
      ? transactions
      : transactions.filter((tx) => tx.type === filterType);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortMode === "amountDesc") return b.amount - a.amount;
      if (sortMode === "amountAsc") return a.amount - b.amount;
      const cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return sortMode === "oldest" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / TX_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice(
    (safePage - 1) * TX_PAGE_SIZE,
    safePage * TX_PAGE_SIZE,
  );

  const FILTER_CHIPS: Array<{ key: TxFilterType; label: string }> = [
    { key: "all", label: t("logSourceAll") },
    { key: "fund_contribution", label: t("txLabelContribution") },
    { key: "fund_deduction", label: t("txLabelDeduction") },
    { key: "fund_refund", label: t("txLabelRefund") },
  ];
  const SORT_OPTIONS = [
    { value: "newest", label: t("txSortNewest") },
    { value: "oldest", label: t("txSortOldest") },
    { value: "amountDesc", label: t("txSortAmountDesc") },
    { value: "amountAsc", label: t("txSortAmountAsc") },
  ];

  if (transactions.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-center text-sm">
        Chưa có lịch sử quỹ
      </p>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1.5">
          {FILTER_CHIPS.map((f) => {
            const active = filterType === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilterType(f.key);
                  setPage(1);
                }}
                className={cn(
                  "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground hover:bg-muted/80",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <CustomSelect
          value={sortMode}
          onChange={(v) => {
            setSortMode(v as TxSortMode);
            setPage(1);
          }}
          options={SORT_OPTIONS}
          className="w-44 shrink-0"
        />
      </div>

      {pageItems.length === 0 ? (
        <p className="text-muted-foreground p-4 text-center text-sm">
          {t("logEmptyFiltered")}
        </p>
      ) : (
        <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          {pageItems.map((tx) => (
            <TxRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            aria-label={tHistory("prevPage")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground text-sm">
            {tHistory("pageOf", { page: safePage, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
            aria-label={tHistory("nextPage")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
