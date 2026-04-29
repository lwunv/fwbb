"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatVND } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { addFundMember, recordContribution } from "@/actions/fund";
import { CustomSelect } from "@/components/ui/custom-select";
import { StatTile } from "@/components/shared/stat-tile";
import {
  Wallet,
  Plus,
  UserPlus,
  TrendingUp,
  TrendingDown,
  AlertCircle,
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
}

interface Props {
  overview: FundOverview;
  fundMembers: FundMemberWithBalance[];
  allMembers: Member[];
  /** Tổng số dư âm — "nợ chưa thu" cho admin. */
  totalOutstanding: number;
  /** Số thành viên đang nợ. */
  owingCount: number;
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
}: Props) {
  const t = useTranslations("fundAdmin");
  const tCommon = useTranslations("common");
  const [localOverview, setLocalOverview] = useState(overview);
  const [localMembers, setLocalMembers] = useState(fundMembers);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showContribution, setShowContribution] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [amount, setAmount] = useState("500000");
  const [description, setDescription] = useState("");

  const formattedAmount = amount ? Number(amount).toLocaleString("vi-VN") : "";

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

  function handleContribution() {
    if (!selectedMemberId || !amount) return;
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error(t("toastInvalidAmount"));
      return;
    }
    const fmRow = localMembers.find((f) => f.memberId === selectedMemberId);
    if (!fmRow) return;

    const prev = cloneFundState(localOverview, localMembers);
    const desc = description.trim() || undefined;
    setLocalMembers((ms) => {
      const next = ms.map((fm) =>
        fm.memberId === selectedMemberId
          ? {
              ...fm,
              balance: {
                ...fm.balance,
                totalContributions: fm.balance.totalContributions + amountNum,
                balance: fm.balance.balance + amountNum,
              },
            }
          : fm,
      );
      return next.sort((a, b) => b.balance.balance - a.balance.balance);
    });
    setLocalOverview((o) => ({
      ...o,
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
    setAmount("500000");
    setDescription("");
    setSelectedMemberId(null);
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
            icon={Wallet}
            label={t("cardTotal")}
            value={formatVND(localOverview.totalBalance)}
            tone="primary"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <StatTile
            icon={TrendingUp}
            label={t("cardContributed")}
            value={formatVND(localOverview.totalContributions)}
            tone="green"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <StatTile
            icon={TrendingDown}
            label={t("cardDeducted")}
            value={formatVND(localOverview.totalDeductions)}
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
            value={formatVND(totalOutstanding)}
            tone={totalOutstanding > 0 ? "red" : "neutral"}
          />
        </motion.div>
      </div>

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
      <AnimatePresence>
        {showContribution && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowContribution(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card w-full max-w-md rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-4 text-lg font-bold">
                {t("modalRecordTitle")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("memberLabel")}
                  </label>
                  <CustomSelect
                    value={selectedMemberId ? String(selectedMemberId) : ""}
                    onChange={(v) => setSelectedMemberId(v ? Number(v) : null)}
                    placeholder={t("selectMember")}
                    searchable
                    searchPlaceholder="Tìm thành viên..."
                    options={localMembers.map((fm) => ({
                      value: String(fm.memberId),
                      label: `${fm.member.nickname || fm.member.name} (${formatVND(fm.balance.balance)})`,
                    }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("amountVnd")}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formattedAmount}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "");
                      setAmount(digits);
                    }}
                    placeholder={t("amountExample")}
                    className="bg-background w-full rounded-xl border p-3 text-base tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("noteLabel")}
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("notePlaceholder")}
                    className="bg-background w-full rounded-xl border p-3 text-base"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowContribution(false)}
                    className="hover:bg-accent flex-1 rounded-xl border py-3 font-medium transition-colors"
                  >
                    {tCommon("cancel")}
                  </button>
                  <button
                    onClick={handleContribution}
                    disabled={!selectedMemberId || !amount}
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
    </div>
  );
}
