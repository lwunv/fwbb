"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { formatVND } from "@/lib/utils";
import { fireAction } from "@/lib/optimistic-action";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  addFundMember,
  removeFundMember,
  recordContribution,
  recordRefund,
} from "@/actions/fund";
import {
  Wallet,
  Plus,
  ArrowUpCircle,
  ArrowDownCircle,
  UserPlus,
  UserMinus,
  TrendingUp,
  TrendingDown,
  RotateCcw,
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
  transactions: FundTransaction[];
  allMembers: Member[];
}

export function FundDashboard({
  overview,
  fundMembers,
  transactions,
  allMembers,
}: Props) {
  const [showAddMember, setShowAddMember] = useState(false);
  const [showContribution, setShowContribution] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [removeMemberId, setRemoveMemberId] = useState<number | null>(null);

  const nonFundMemberIds = new Set(fundMembers.map((fm) => fm.memberId));
  const availableMembers = allMembers.filter(
    (m) => !nonFundMemberIds.has(m.id),
  );

  async function handleAddMember(memberId: number) {
    fireAction(() => addFundMember(memberId), undefined, {
      successMsg: "Đã thêm vào quỹ",
    });
    setShowAddMember(false);
  }

  function confirmRemoveMember() {
    if (removeMemberId == null) return;
    const id = removeMemberId;
    setRemoveMemberId(null);
    fireAction(() => removeFundMember(id, true), undefined, {
      successMsg: "Đã rời quỹ",
    });
  }

  async function handleContribution() {
    if (!selectedMemberId || !amount) return;
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }

    fireAction(
      () =>
        recordContribution(
          selectedMemberId,
          amountNum,
          description || undefined,
        ),
      undefined,
      { successMsg: `Đã ghi nhận đóng quỹ ${formatVND(amountNum)}` },
    );
    setShowContribution(false);
    setAmount("");
    setDescription("");
    setSelectedMemberId(null);
  }

  async function handleRefund(memberId: number, maxAmount: number) {
    const input = prompt(`Nhập số tiền hoàn (tối đa ${formatVND(maxAmount)}):`);
    if (!input) return;
    const amountNum = parseInt(input, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    if (amountNum > maxAmount) {
      toast.error(`Số dư không đủ (tối đa ${formatVND(maxAmount)})`);
      return;
    }

    fireAction(() => recordRefund(memberId, amountNum, "Hoàn quỹ"), undefined, {
      successMsg: `Đã hoàn ${formatVND(amountNum)}`,
    });
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
            <h1 className="text-2xl font-bold">Quỹ nhóm</h1>
            <p className="text-muted-foreground text-sm">
              {overview.memberCount} thành viên
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowContribution(true)}
            className="bg-primary text-primary-foreground flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Ghi nhận đóng quỹ
          </button>
          <button
            onClick={() => setShowAddMember(true)}
            className="bg-card hover:bg-accent flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Thêm TV
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "Tổng quỹ",
            value: overview.totalBalance,
            icon: Wallet,
            color: "text-primary",
          },
          {
            label: "Đã đóng",
            value: overview.totalContributions,
            icon: TrendingUp,
            color: "text-green-500",
          },
          {
            label: "Đã trừ",
            value: overview.totalDeductions,
            icon: TrendingDown,
            color: "text-orange-500",
          },
          {
            label: "Đã hoàn",
            value: overview.totalRefunds,
            icon: RotateCcw,
            color: "text-red-500",
          },
        ].map((card) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/80 rounded-xl border p-4 backdrop-blur"
          >
            <div className="mb-2 flex items-center gap-2">
              <card.icon className={`h-4 w-4 ${card.color}`} />
              <span className="text-muted-foreground text-xs">
                {card.label}
              </span>
            </div>
            <p className="text-lg font-bold">{formatVND(card.value)}</p>
          </motion.div>
        ))}
      </div>

      {/* Fund Members */}
      <div className="bg-card/80 rounded-xl border backdrop-blur">
        <div className="border-b p-4">
          <h2 className="font-semibold">Thành viên quỹ</h2>
        </div>
        <div className="divide-y">
          {fundMembers.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center">
              Chưa có thành viên nào trong quỹ
            </p>
          ) : (
            fundMembers.map((fm) => (
              <motion.div
                key={fm.memberId}
                layout
                className="flex items-center justify-between p-4"
              >
                <div>
                  <p className="font-medium">
                    {fm.member.nickname || fm.member.name}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Đóng: {formatVND(fm.balance.totalContributions)} · Trừ:{" "}
                    {formatVND(fm.balance.totalDeductions)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p
                      className={`font-bold ${fm.balance.balance > 0 ? "text-green-500" : fm.balance.balance < 0 ? "text-red-500" : "text-muted-foreground"}`}
                    >
                      {formatVND(fm.balance.balance)}
                    </p>
                    <p className="text-muted-foreground text-xs">Số dư</p>
                  </div>
                  <div className="flex gap-1">
                    {fm.balance.balance > 0 && (
                      <button
                        onClick={() =>
                          handleRefund(fm.memberId, fm.balance.balance)
                        }
                        className="hover:bg-accent rounded-lg p-2 transition-colors"
                        title="Hoàn quỹ"
                      >
                        <ArrowDownCircle className="h-4 w-4 text-orange-500" />
                      </button>
                    )}
                    <button
                      onClick={() => setRemoveMemberId(fm.memberId)}
                      className="hover:bg-destructive/10 rounded-lg p-2 transition-colors"
                      title="Rời quỹ"
                    >
                      <UserMinus className="text-destructive h-4 w-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-card/80 rounded-xl border backdrop-blur">
        <div className="border-b p-4">
          <h2 className="font-semibold">Giao dịch gần đây</h2>
        </div>
        <div className="max-h-96 divide-y overflow-y-auto">
          {transactions.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center">
              Chưa có giao dịch nào
            </p>
          ) : (
            transactions.slice(0, 50).map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3">
                  {tx.type === "fund_contribution" && (
                    <ArrowUpCircle className="h-5 w-5 text-green-500" />
                  )}
                  {tx.type === "fund_deduction" && (
                    <ArrowDownCircle className="h-5 w-5 text-orange-500" />
                  )}
                  {tx.type === "fund_refund" && (
                    <RotateCcw className="h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {tx.member.nickname || tx.member.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {tx.description}
                      {tx.session && ` · ${tx.session.date}`}
                    </p>
                  </div>
                </div>
                <p
                  className={`text-sm font-bold ${tx.type === "fund_contribution" ? "text-green-500" : "text-red-500"}`}
                >
                  {tx.type === "fund_contribution" ? "+" : "−"}
                  {formatVND(tx.amount)}
                </p>
              </div>
            ))
          )}
        </div>
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
              <h3 className="mb-4 text-lg font-bold">
                Thêm thành viên vào quỹ
              </h3>
              {availableMembers.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Tất cả thành viên đã trong quỹ.
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
                Đóng
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
              <h3 className="mb-4 text-lg font-bold">Ghi nhận đóng quỹ</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Thành viên
                  </label>
                  <select
                    value={selectedMemberId ?? ""}
                    onChange={(e) =>
                      setSelectedMemberId(Number(e.target.value) || null)
                    }
                    className="bg-background w-full rounded-xl border p-3 text-base"
                  >
                    <option value="">Chọn thành viên...</option>
                    {fundMembers.map((fm) => (
                      <option key={fm.memberId} value={fm.memberId}>
                        {fm.member.nickname || fm.member.name} (
                        {formatVND(fm.balance.balance)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Số tiền (VND)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="500000"
                    className="bg-background w-full rounded-xl border p-3 text-base"
                    min={1000}
                    step={1000}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Ghi chú
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Đóng quỹ tháng 4"
                    className="bg-background w-full rounded-xl border p-3 text-base"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowContribution(false)}
                    className="hover:bg-accent flex-1 rounded-xl border py-3 font-medium transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    onClick={handleContribution}
                    disabled={!selectedMemberId || !amount}
                    className="bg-primary text-primary-foreground flex-1 rounded-xl py-3 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={removeMemberId !== null}
        onOpenChange={(open) => !open && setRemoveMemberId(null)}
        title="Rời quỹ thành viên"
        description="Rời quỹ sẽ hoàn trả số dư (nếu có). Tiếp tục?"
        confirmLabel="Rời quỹ"
        variant="destructive"
        onConfirm={confirmRemoveMember}
      />
    </div>
  );
}
