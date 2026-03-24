"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { adminSetVote, adminRemoveVote } from "@/actions/votes";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatVND } from "@/lib/utils";
import { Plus, X, Check, ChevronUp, Search } from "lucide-react";
import { confirmPaymentByAdmin, undoPaymentByAdmin } from "@/actions/finance";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};
type Member = InferSelectModel<typeof membersTable>;

interface DebtInfo {
  amount: number;
  adminConfirmed: boolean;
  debtId: number;
}

interface AdminVoteManagerProps {
  sessionId: number;
  votes: Vote[];
  members: Member[];
  debtMap?: Record<number, DebtInfo>;
  readOnly?: boolean;
}

export function AdminVoteManager({ sessionId, votes, members, debtMap = {}, readOnly = false }: AdminVoteManagerProps) {
  const t = useTranslations("voting");
  const tCommon = useTranslations("common");
  const tFinance = useTranslations("finance");
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ memberId: number; name: string } | null>(null);
  const [payLoading, setPayLoading] = useState<number | null>(null);

  const voteMap = new Map(votes.map((v) => [v.memberId, v]));

  // All members who are in either play or dine
  const activeMembers = members.filter((m) => {
    const v = voteMap.get(m.id);
    return v && (v.willPlay || v.willDine);
  });

  const notInList = members.filter((m) => {
    const v = voteMap.get(m.id);
    return !v || (!v.willPlay && !v.willDine);
  });

  const playerCount = votes.filter((v) => v.willPlay).length;
  const dinerCount = votes.filter((v) => v.willDine).length;

  function toggleTag(memberId: number, tag: "play" | "dine") {
    if (readOnly) return;
    startTransition(async () => {
      const v = voteMap.get(memberId);
      const willPlay = v?.willPlay ?? false;
      const willDine = v?.willDine ?? false;

      if (tag === "play") {
        await adminSetVote(sessionId, memberId, !willPlay, willDine);
      } else {
        await adminSetVote(sessionId, memberId, willPlay, !willDine);
      }
    });
  }

  function handleAddMember(memberId: number) {
    if (readOnly) return;
    startTransition(async () => {
      await adminSetVote(sessionId, memberId, true, true);
    });
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    await adminRemoveVote(sessionId, removeTarget.memberId);
    setRemoveTarget(null);
  }

  function handleRemoveClick(memberId: number, name: string) {
    if (readOnly) return;
    setRemoveTarget({ memberId, name });
  }

  async function handlePay(debtId: number) {
    setPayLoading(debtId);
    await confirmPaymentByAdmin(debtId);
    setPayLoading(null);
  }

  async function handleUndo(debtId: number) {
    setPayLoading(debtId);
    await undoPaymentByAdmin(debtId);
    setPayLoading(null);
  }

  function filterMembers(list: Member[], q: string) {
    if (!q) return list;
    const lower = q.toLowerCase();
    return list.filter((m) => m.name.toLowerCase().includes(lower) || m.phone.includes(q));
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <span>🏸 <strong>{playerCount}</strong></span>
            <span>🍻 <strong>{dinerCount}</strong></span>
            <span className="text-muted-foreground">({activeMembers.length} người)</span>
          </div>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAdd(!showAdd); setSearch(""); }}
              disabled={isPending}
            >
              {showAdd ? <ChevronUp className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              {showAdd ? tCommon("close") : tCommon("add")}
            </Button>
          )}
        </div>

        {/* Member list */}
        <div className="divide-y">
          {activeMembers.map((member) => {
            const v = voteMap.get(member.id)!;
            const debt = debtMap[member.id];
            const isConfirmed = debt?.adminConfirmed ?? false;

            return (
              <div key={member.id} className="flex items-center gap-2 py-2">
                <MemberAvatar memberId={member.id} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium">{member.name}</span>
                    {/* Tags */}
                    <button
                      onClick={() => toggleTag(member.id, "play")}
                      disabled={isPending || readOnly}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                        v.willPlay
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-muted text-muted-foreground opacity-40 line-through"
                      } ${!readOnly ? "cursor-pointer hover:opacity-80" : ""}`}
                    >
                      🏸 Cầu
                    </button>
                    <button
                      onClick={() => toggleTag(member.id, "dine")}
                      disabled={isPending || readOnly}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                        v.willDine
                          ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                          : "bg-muted text-muted-foreground opacity-40 line-through"
                      } ${!readOnly ? "cursor-pointer hover:opacity-80" : ""}`}
                    >
                      🍻 Nhậu
                    </button>
                    {/* Hết nợ tag */}
                    {debt && (
                      <button
                        onClick={() => isConfirmed ? handleUndo(debt.debtId) : handlePay(debt.debtId)}
                        disabled={payLoading === debt.debtId}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-all cursor-pointer hover:opacity-80 ${
                          isConfirmed
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-red-100/50 text-red-300 dark:bg-red-900/20 dark:text-red-600 opacity-60"
                        }`}
                      >
                        Hết nợ
                      </button>
                    )}
                    {/* Amount — color by payment status */}
                    {debt && (
                      <span className={`text-xs font-bold ${isConfirmed ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {formatVND(debt.amount)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Remove button */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!readOnly && (
                    <button
                      onClick={() => handleRemoveClick(member.id, member.name)}
                      disabled={isPending}
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {activeMembers.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">{tCommon("noOne")}</p>
          )}
        </div>

        {/* Add member multi-select */}
        {showAdd && !readOnly && (
          <div className="border rounded-md overflow-hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={`${tCommon("search")}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border-b bg-background outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-auto">
              {filterMembers(members, search).map((m) => {
                const v = voteMap.get(m.id);
                const isIn = v && (v.willPlay || v.willDine);
                return (
                  <button
                    key={m.id}
                    onClick={() => !isIn && handleAddMember(m.id)}
                    disabled={isPending || !!isIn}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
                      isIn ? "bg-primary/10 opacity-60" : "hover:bg-accent"
                    }`}
                  >
                    <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      isIn ? "bg-primary border-primary" : "border-border"
                    }`}>
                      {isIn && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <MemberAvatar memberId={m.id} size={20} />
                    <span>{m.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>

      {/* Remove confirm dialog */}
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        title={`Xóa ${removeTarget?.name ?? ""}?`}
        description="Xóa khỏi danh sách buổi chơi này?"
        onConfirm={handleRemoveConfirm}
      />
    </Card>
  );
}
