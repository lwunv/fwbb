"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatVND, formatK } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { addFundMember, recordContribution } from "@/actions/fund";
import { recordCourtRentPayment } from "@/actions/court-rent";
import { recordPurchase } from "@/actions/inventory";
import { CustomSelect } from "@/components/ui/custom-select";
import { RecordContributionDialog } from "@/components/fund/record-contribution-dialog";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/shared/stat-tile";
import {
  Wallet,
  Plus,
  Minus,
  UserPlus,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Landmark,
  CircleDot,
  Banknote,
} from "lucide-react";
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

interface FundOverview {
  totalBalance: number;
  totalContributions: number;
  totalDeductions: number;
  totalRefunds: number;
  memberCount: number;
  /** Tiền mặt còn lại trong quỹ = contribution − refund − chi quỹ chung.
   *  Khác `totalBalance` ở chỗ KHÔNG trừ fund_deduction (deduction từ
   *  finalizeSession là member-allocation, không phải cash movement). */
  cashOnHand: number;
  /** Tổng đã chi quỹ chung (sân tháng + mua cầu, đã loại reversal). */
  totalGroupExpenses: number;
  groupExpenseCourtRent: number;
  groupExpenseInventory: number;
}

interface CourtOpt {
  id: number;
  name: string;
  pricePerSession: number;
}

interface BrandOpt {
  id: number;
  name: string;
  pricePerTube: number;
}

interface Props {
  overview: FundOverview;
  fundMembers: FundMemberWithBalance[];
  allMembers: Member[];
  /** Tổng số dư âm — "nợ chưa thu" cho admin. */
  totalOutstanding: number;
  /** Số thành viên đang nợ. */
  owingCount: number;
  courts: CourtOpt[];
  brands: BrandOpt[];
  currentYear: number;
  currentMonth: number;
}

function cloneFundState(
  overview: FundOverview,
  members: FundMemberWithBalance[],
) {
  return {
    overview: { ...overview },
    members: members.map((fm) => ({
      ...fm,
      balance: { ...fm.balance },
      member: fm.member,
    })),
  };
}

export function FundDashboard({
  overview,
  fundMembers,
  allMembers,
  totalOutstanding,
  owingCount,
  courts,
  brands,
  currentYear,
  currentMonth,
}: Props) {
  const t = useTranslations("fundAdmin");
  const tCommon = useTranslations("common");
  const [localOverview, setLocalOverview] = useState(overview);
  const [localMembers, setLocalMembers] = useState(fundMembers);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showContribution, setShowContribution] = useState(false);
  const [showCourtRent, setShowCourtRent] = useState(false);
  const [showBuyShuttle, setShowBuyShuttle] = useState(false);

  // Court-rent form state
  const [crYear, setCrYear] = useState(currentYear);
  const [crMonth, setCrMonth] = useState(currentMonth);
  const [crCourtId, setCrCourtId] = useState<number | null>(
    courts[0]?.id ?? null,
  );
  const [crAmount, setCrAmount] = useState("");
  const [crNote, setCrNote] = useState("");

  // Buy-shuttlecock form state
  const [bsBrandId, setBsBrandId] = useState<number | null>(
    brands[0]?.id ?? null,
  );
  const [bsTubes, setBsTubes] = useState(1);
  const [bsPricePerTube, setBsPricePerTube] = useState<number>(
    brands[0]?.pricePerTube ?? 0,
  );
  const [bsPurchasedAt, setBsPurchasedAt] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [bsNote, setBsNote] = useState("");

  const formattedCrAmount = crAmount
    ? Number(crAmount).toLocaleString("vi-VN")
    : "";
  const bsTotal = bsTubes * bsPricePerTube;

  // "Adjusting state on prop change" pattern. Sync server-fetched props back
  // to local optimistic state when the parent re-renders (e.g., after
  // revalidatePath triggers a refetch). Avoids cascading-render warning of
  // doing setState in useEffect.
  const [prevOverview, setPrevOverview] = useState(overview);
  const [prevMembers, setPrevMembers] = useState(fundMembers);
  if (overview !== prevOverview || fundMembers !== prevMembers) {
    setPrevOverview(overview);
    setPrevMembers(fundMembers);
    setLocalOverview(overview);
    setLocalMembers(fundMembers);
  }

  const nonFundMemberIds = new Set(localMembers.map((fm) => fm.memberId));
  const availableMembers = allMembers.filter(
    (m) => !nonFundMemberIds.has(m.id),
  );

  function handleAddMember(memberId: number) {
    const m = allMembers.find((x) => x.id === memberId);
    if (!m) return;
    const prev = cloneFundState(localOverview, localMembers);
    const newRow: FundMemberWithBalance = {
      id: 0,
      memberId: m.id,
      isActive: true,
      joinedAt: new Date().toISOString(),
      leftAt: null,
      member: m,
      balance: {
        memberId: m.id,
        totalContributions: 0,
        totalDeductions: 0,
        totalRefunds: 0,
        balance: 0,
      },
    };
    setLocalMembers((ms) =>
      [...ms, newRow].sort((a, b) => b.balance.balance - a.balance.balance),
    );
    setLocalOverview((o) => ({ ...o, memberCount: o.memberCount + 1 }));
    fireAction(
      () => addFundMember(memberId),
      () => {
        setLocalOverview(prev.overview);
        setLocalMembers(prev.members);
      },
      { successMsg: t("successAddMember") },
    );
    setShowAddMember(false);
  }

  function handleContribution(
    memberId: number,
    amountNum: number,
    desc?: string,
  ) {
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error(t("toastInvalidAmount"));
      return;
    }
    const selectedMemberId = memberId;
    const fmRow = localMembers.find((f) => f.memberId === selectedMemberId);
    // Auto-enrol path: nếu member chưa trong quỹ, dựng row mới từ
    // allMembers và optimistic insert vào localMembers (backend sẽ
    // auto-enrol). Nếu không tìm thấy ở cả allMembers → bail.
    const memberRow =
      fmRow?.member ?? allMembers.find((m) => m.id === selectedMemberId);
    if (!memberRow) return;
    const wasNotInFund = !fmRow;

    const prev = cloneFundState(localOverview, localMembers);
    setLocalMembers((ms) => {
      const base: FundMemberWithBalance = fmRow ?? {
        id: 0,
        memberId: selectedMemberId,
        isActive: true,
        joinedAt: new Date().toISOString(),
        leftAt: null,
        member: memberRow,
        balance: {
          memberId: selectedMemberId,
          totalContributions: 0,
          totalDeductions: 0,
          totalRefunds: 0,
          balance: 0,
        },
      };
      const updated: FundMemberWithBalance = {
        ...base,
        balance: {
          ...base.balance,
          totalContributions: base.balance.totalContributions + amountNum,
          balance: base.balance.balance + amountNum,
        },
      };
      const next = fmRow
        ? ms.map((fm) => (fm.memberId === selectedMemberId ? updated : fm))
        : [...ms, updated];
      return next.sort((a, b) => b.balance.balance - a.balance.balance);
    });
    setLocalOverview((o) => ({
      ...o,
      memberCount: wasNotInFund ? o.memberCount + 1 : o.memberCount,
      totalBalance: o.totalBalance + amountNum,
      totalContributions: o.totalContributions + amountNum,
    }));
    // Stable idempotency key per submit — duplicate fireAction retries (e.g.
    // network blips) collapse to a single ledger entry server-side.
    const idemKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `contrib-${crypto.randomUUID()}`
        : `contrib-${selectedMemberId}-${amountNum}-${Date.now()}`;
    fireAction(
      () => recordContribution(selectedMemberId, amountNum, desc, idemKey),
      () => {
        setLocalOverview(prev.overview);
        setLocalMembers(prev.members);
      },
      {
        successMsg: t("successContribution", {
          amount: formatVND(amountNum),
        }),
      },
    );
    setShowContribution(false);
  }

  function handleCourtRent() {
    const amountNum = parseInt(crAmount, 10);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error(t("toastInvalidAmount"));
      return;
    }
    const prev = { ...localOverview };
    // Optimistic: cash giảm, group expense tăng — totalBalance KHÔNG đổi
    // (đây là chi quỹ chung, không trừ ai cụ thể; member balance theo dõi
    // theo từng buổi qua finalizeSession, không bị ảnh hưởng).
    setLocalOverview((o) => ({
      ...o,
      cashOnHand: o.cashOnHand - amountNum,
      totalGroupExpenses: o.totalGroupExpenses + amountNum,
      groupExpenseCourtRent: o.groupExpenseCourtRent + amountNum,
    }));
    const idemKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `court-rent-${crypto.randomUUID()}`
        : `court-rent-${crYear}-${crMonth}-${amountNum}-${Date.now()}`;
    const noteTrimmed = crNote.trim();
    fireAction(
      () =>
        recordCourtRentPayment({
          year: crYear,
          month: crMonth,
          amount: amountNum,
          courtId: crCourtId,
          note: noteTrimmed || undefined,
          idempotencyKey: idemKey,
        }),
      () => {
        setLocalOverview(prev);
      },
      {
        successMsg: t("successCourtRent", { amount: formatVND(amountNum) }),
      },
    );
    setShowCourtRent(false);
    setCrAmount("");
    setCrNote("");
  }

  function handleBuyShuttle() {
    if (!bsBrandId) return;
    if (!Number.isFinite(bsTubes) || bsTubes < 1) {
      toast.error(t("toastInvalidAmount"));
      return;
    }
    if (!Number.isFinite(bsPricePerTube) || bsPricePerTube <= 0) {
      toast.error(t("toastInvalidAmount"));
      return;
    }
    const total = bsTubes * bsPricePerTube;
    const prev = { ...localOverview };
    setLocalOverview((o) => ({
      ...o,
      cashOnHand: o.cashOnHand - total,
      totalGroupExpenses: o.totalGroupExpenses + total,
      groupExpenseInventory: o.groupExpenseInventory + total,
    }));
    const idemKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `buy-shuttle-${crypto.randomUUID()}`
        : `buy-shuttle-${bsBrandId}-${bsTubes}-${bsPricePerTube}-${Date.now()}`;
    // recordPurchase nhận FormData — match đúng signature ở /admin/inventory.
    const fd = new FormData();
    fd.append("brandId", String(bsBrandId));
    fd.append("tubes", String(bsTubes));
    fd.append("pricePerTube", String(bsPricePerTube));
    fd.append("purchasedAt", bsPurchasedAt);
    if (bsNote.trim()) fd.append("notes", bsNote.trim());
    fd.append("idempotencyKey", idemKey);
    fireAction(
      () => recordPurchase(fd),
      () => {
        setLocalOverview(prev);
      },
      {
        successMsg: t("successBuyShuttlecock", { amount: formatVND(total) }),
      },
    );
    setShowBuyShuttle(false);
    setBsTubes(1);
    setBsNote("");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 rounded-xl p-2">
            <Wallet className="text-primary h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">
              {t("memberCount", { count: localOverview.memberCount })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowContribution(true)}
            className="bg-primary text-primary-foreground flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("recordContribution")}
          </button>
          <button
            onClick={() => setShowAddMember(true)}
            className="bg-card hover:bg-accent flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            {t("addMemberShort")}
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <StatTile
            icon={Banknote}
            label={t("cardCashOnHand")}
            value={formatK(localOverview.cashOnHand)}
            tone={localOverview.cashOnHand >= 0 ? "primary" : "red"}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <StatTile
            icon={TrendingUp}
            label={t("cardContributed")}
            value={formatK(localOverview.totalContributions)}
            tone="blue"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <StatTile
            icon={TrendingDown}
            label={t("cardGroupExpense")}
            value={formatK(localOverview.totalGroupExpenses)}
            tone="orange"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <StatTile
            icon={AlertCircle}
            label={
              owingCount > 0
                ? `Nợ chưa thu (${owingCount} người)`
                : "Nợ chưa thu"
            }
            value={formatK(totalOutstanding)}
            tone={totalOutstanding > 0 ? "red" : "neutral"}
          />
        </motion.div>
      </div>

      {/* Chi quỹ chung — nhập tiền sân tháng / mua cầu (trừ trực tiếp khỏi
          quỹ tiền mặt, KHÔNG động vào balance từng member). */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card/80 rounded-2xl border p-4 backdrop-blur"
      >
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="shrink-0 text-sm font-semibold">{t("chiQuyTitle")}</h3>
          <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {t("chiQuyHint")}
          </p>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatK(localOverview.groupExpenseCourtRent)} +{" "}
            {formatK(localOverview.groupExpenseInventory)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowCourtRent(true)}
            className="bg-card hover:bg-accent flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors"
          >
            <Landmark className="h-4 w-4 text-cyan-500" />
            {t("btnPayCourtRent")}
          </button>
          <button
            onClick={() => setShowBuyShuttle(true)}
            className="bg-card hover:bg-accent flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors"
          >
            <CircleDot className="h-4 w-4 text-orange-500" />
            {t("btnBuyShuttlecock")}
          </button>
        </div>
      </motion.div>

      {/* Add Member Modal */}
      <AnimatePresence>
        {showAddMember && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowAddMember(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-md rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-4 text-lg font-bold">{t("modalAddTitle")}</h3>
              {availableMembers.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("allInFund")}
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {availableMembers.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleAddMember(m.id)}
                      className="hover:bg-accent flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors"
                    >
                      <UserPlus className="text-primary h-4 w-4" />
                      <span className="font-medium">
                        {m.nickname || m.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowAddMember(false)}
                className="hover:bg-accent mt-4 w-full rounded-xl border py-2 text-sm transition-colors"
              >
                {t("close")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record Contribution Modal */}
      <RecordContributionDialog
        open={showContribution}
        onClose={() => setShowContribution(false)}
        onSubmit={handleContribution}
        selectableMembers={allMembers.map((m) => {
          const fm = localMembers.find((f) => f.memberId === m.id);
          return {
            id: m.id,
            name: m.name,
            nickname: m.nickname,
            balance: fm?.balance.balance ?? 0,
            avatarKey: m.avatarKey,
            avatarUrl: m.avatarUrl,
          };
        })}
      />

      {/* Trả tiền sân tháng — chi quỹ chung. */}
      <AnimatePresence>
        {showCourtRent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowCourtRent(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-md rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-1 text-lg font-bold">
                {t("modalCourtRentTitle")}
              </h3>
              <p className="text-muted-foreground mb-4 text-xs">
                {t("modalCourtRentHint")}
              </p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("monthLabel")}
                    </label>
                    <CustomSelect
                      value={String(crMonth)}
                      onChange={(v) => setCrMonth(Number(v))}
                      options={Array.from({ length: 12 }, (_, i) => ({
                        value: String(i + 1),
                        label: `T${i + 1}`,
                      }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("yearLabel")}
                    </label>
                    <CustomSelect
                      value={String(crYear)}
                      onChange={(v) => setCrYear(Number(v))}
                      options={[
                        currentYear - 1,
                        currentYear,
                        currentYear + 1,
                      ].map((y) => ({ value: String(y), label: String(y) }))}
                    />
                  </div>
                </div>
                {courts.length > 0 && (
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("courtLabel")}{" "}
                      <span className="text-muted-foreground text-xs font-normal">
                        {t("optional")}
                      </span>
                    </label>
                    <CustomSelect
                      value={crCourtId ? String(crCourtId) : ""}
                      onChange={(v) => setCrCourtId(v ? Number(v) : null)}
                      placeholder={t("selectCourtPlaceholder")}
                      options={[
                        { value: "", label: "—" },
                        ...courts.map((c) => ({
                          value: String(c.id),
                          label: c.name,
                        })),
                      ]}
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("amountVnd")}
                  </label>
                  {/* Stepper +/− 100k flanking input — đồng bộ pattern với
                      "Ghi nhận đóng quỹ" dialog. Display vi-VN format
                      ("2.000.000") trong khi raw state vẫn là digits. */}
                  <div className="flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const cur = parseInt(crAmount, 10) || 0;
                        setCrAmount(String(Math.max(0, cur - 100000)));
                      }}
                      disabled={(parseInt(crAmount, 10) || 0) <= 0}
                      className="bg-card hover:bg-muted/50 inline-flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border-2 transition-colors disabled:opacity-40"
                      aria-label={t("ariaDecrease100k")}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={formattedCrAmount}
                      onChange={(e) =>
                        setCrAmount(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="2.000.000"
                      className="text-center tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = parseInt(crAmount, 10) || 0;
                        setCrAmount(String(cur + 100000));
                      }}
                      className="bg-card hover:bg-muted/50 inline-flex h-[42px] w-11 shrink-0 items-center justify-center rounded-xl border-2 transition-colors disabled:opacity-40"
                      aria-label={t("ariaIncrease100k")}
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
                    value={crNote}
                    onChange={(e) => setCrNote(e.target.value)}
                    placeholder={t("courtRentNotePlaceholder", {
                      month: String(crMonth).padStart(2, "0"),
                      year: crYear,
                    })}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowCourtRent(false)}
                    className="hover:bg-accent flex-1 rounded-xl border py-3 font-medium transition-colors"
                  >
                    {tCommon("cancel")}
                  </button>
                  <button
                    onClick={handleCourtRent}
                    disabled={!crAmount || Number(crAmount) <= 0}
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

      {/* Mua cầu — chi quỹ chung; tăng stock + ghi ledger inventory_purchase. */}
      <AnimatePresence>
        {showBuyShuttle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowBuyShuttle(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-md rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-1 text-lg font-bold">
                {t("modalBuyShuttlecockTitle")}
              </h3>
              <p className="text-muted-foreground mb-4 text-xs">
                {t("modalBuyShuttlecockHint")}
              </p>
              {brands.length === 0 ? (
                <div className="text-muted-foreground py-6 text-center text-sm">
                  {t("noBrandsAvailable")}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("brandLabel")}
                    </label>
                    <CustomSelect
                      value={bsBrandId ? String(bsBrandId) : ""}
                      onChange={(v) => {
                        const id = v ? Number(v) : null;
                        setBsBrandId(id);
                        const b = brands.find((x) => x.id === id);
                        if (b) setBsPricePerTube(b.pricePerTube);
                      }}
                      placeholder={t("selectBrandPlaceholder")}
                      options={brands.map((b) => ({
                        value: String(b.id),
                        label: `${b.name} (${formatK(b.pricePerTube)}/ống)`,
                      }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium">
                        {t("tubesLabel")}
                      </label>
                      <NumberStepper
                        value={bsTubes}
                        onChange={setBsTubes}
                        min={1}
                        max={1000}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium">
                        {t("pricePerTubeLabel")}
                      </label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={
                          bsPricePerTube
                            ? bsPricePerTube.toLocaleString("vi-VN")
                            : ""
                        }
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "");
                          setBsPricePerTube(digits ? Number(digits) : 0);
                        }}
                        placeholder="100000"
                        className="tabular-nums"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("purchasedAtLabel")}
                    </label>
                    <Input
                      type="date"
                      value={bsPurchasedAt}
                      onChange={(e) => setBsPurchasedAt(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      {t("noteLabel")}
                    </label>
                    <Input
                      type="text"
                      value={bsNote}
                      onChange={(e) => setBsNote(e.target.value)}
                      placeholder={t("buyShuttleNotePlaceholder")}
                    />
                  </div>
                  <div className="bg-muted flex items-center justify-between rounded-xl px-4 py-3">
                    <span className="text-sm font-medium">
                      {t("totalLabel")}
                    </span>
                    <span className="text-base font-bold tabular-nums">
                      {formatK(bsTotal)}
                    </span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setShowBuyShuttle(false)}
                      className="hover:bg-accent flex-1 rounded-xl border py-3 font-medium transition-colors"
                    >
                      {tCommon("cancel")}
                    </button>
                    <button
                      onClick={handleBuyShuttle}
                      disabled={
                        !bsBrandId || bsTubes < 1 || bsPricePerTube <= 0
                      }
                      className="bg-primary text-primary-foreground flex-1 rounded-xl py-3 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {tCommon("confirm")}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
