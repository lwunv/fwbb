"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { adminSetVote, adminRemoveVote } from "@/actions/votes";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatK } from "@/lib/utils";
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

// Local optimistic state types
interface LocalVote { willPlay: boolean; willDine: boolean; }
interface LocalDebt { adminConfirmed: boolean; }

export function AdminVoteManager({ sessionId, votes, members, debtMap = {}, readOnly = false }: AdminVoteManagerProps) {
  const t = useTranslations("voting");
  const tCommon = useTranslations("common");
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ memberId: number; name: string } | null>(null);
  const [error, setError] = useState("");

  // Optimistic local state — overrides server data instantly
  const [localVotes, setLocalVotes] = useState<Record<number, LocalVote>>({});
  const [localDebts, setLocalDebts] = useState<Record<number, LocalDebt>>({});
  const [removedMembers, setRemovedMembers] = useState<Set<number>>(new Set());
  const [addedMembers, setAddedMembers] = useState<Set<number>>(new Set());

  // Merge server + local state
  function getVote(memberId: number): { willPlay: boolean; willDine: boolean } | null {
    if (removedMembers.has(memberId)) return null;
    const local = localVotes[memberId];
    if (local) return local;
    const sv = votes.find((v) => v.memberId === memberId);
    if (sv) return { willPlay: sv.willPlay ?? false, willDine: sv.willDine ?? false };
    if (addedMembers.has(memberId)) return { willPlay: true, willDine: true };
    return null;
  }

  function getDebtConfirmed(memberId: number): boolean {
    const local = localDebts[memberId];
    if (local !== undefined) return local.adminConfirmed;
    return debtMap[memberId]?.adminConfirmed ?? false;
  }

  const activeMembers = members.filter((m) => {
    const v = getVote(m.id);
    return v && (v.willPlay || v.willDine);
  });

  const playerCount = activeMembers.filter((m) => getVote(m.id)?.willPlay).length;
  const dinerCount = activeMembers.filter((m) => getVote(m.id)?.willDine).length;

  // Fire-and-forget with rollback on error
  function fireAsync(fn: () => Promise<{ error?: string; success?: boolean }>, rollback: () => void) {
    fn().then((result) => {
      if (result.error) {
        rollback();
        setError(result.error);
        setTimeout(() => setError(""), 3000);
      }
    });
  }

  function toggleTag(memberId: number, tag: "play" | "dine") {
    const current = getVote(memberId);
    if (!current) return;
    const newPlay = tag === "play" ? !current.willPlay : current.willPlay;
    const newDine = tag === "dine" ? !current.willDine : current.willDine;
    const prev = { ...current };

    // Optimistic
    setLocalVotes((s) => ({ ...s, [memberId]: { willPlay: newPlay, willDine: newDine } }));

    // API
    fireAsync(
      () => adminSetVote(sessionId, memberId, newPlay, newDine),
      () => setLocalVotes((s) => ({ ...s, [memberId]: prev }))
    );
  }

  function handleAddMember(memberId: number) {
    if (readOnly) return;
    // Optimistic
    setAddedMembers((s) => new Set(s).add(memberId));
    setLocalVotes((s) => ({ ...s, [memberId]: { willPlay: true, willDine: true } }));
    setRemovedMembers((s) => { const n = new Set(s); n.delete(memberId); return n; });

    fireAsync(
      () => adminSetVote(sessionId, memberId, true, true),
      () => {
        setAddedMembers((s) => { const n = new Set(s); n.delete(memberId); return n; });
        setLocalVotes((s) => { const n = { ...s }; delete n[memberId]; return n; });
      }
    );
  }

  async function handleRemoveConfirm() {
    if (!removeTarget) return;
    const mid = removeTarget.memberId;
    // Optimistic
    setRemovedMembers((s) => new Set(s).add(mid));
    setRemoveTarget(null);

    fireAsync(
      () => adminRemoveVote(sessionId, mid),
      () => setRemovedMembers((s) => { const n = new Set(s); n.delete(mid); return n; })
    );
  }

  function togglePayment(memberId: number) {
    const debt = debtMap[memberId];
    if (!debt) return;
    const current = getDebtConfirmed(memberId);
    const newVal = !current;

    // Optimistic
    setLocalDebts((s) => ({ ...s, [memberId]: { adminConfirmed: newVal } }));

    fireAsync(
      () => newVal ? confirmPaymentByAdmin(debt.debtId) : undoPaymentByAdmin(debt.debtId),
      () => setLocalDebts((s) => ({ ...s, [memberId]: { adminConfirmed: current } }))
    );
  }

  function filterMembers(list: Member[], q: string) {
    if (!q) return list;
    const lower = q.toLowerCase();
    return list.filter((m) => m.name.toLowerCase().includes(lower) || m.phone.includes(q));
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Error toast */}
        {error && (
          <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2 text-center">
            {error}
          </div>
        )}

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
            >
              {showAdd ? <ChevronUp className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              {showAdd ? tCommon("close") : tCommon("add")}
            </Button>
          )}
        </div>

        {/* Member list */}
        <div className="divide-y">
          {activeMembers.map((member) => {
            const v = getVote(member.id)!;
            const debt = debtMap[member.id];
            const isConfirmed = getDebtConfirmed(member.id);

            return (
              <div key={member.id} className="grid grid-cols-[28px_1fr_40px_40px_40px_auto_20px] gap-x-1.5 items-center gap-x-2 py-2">
                <MemberAvatar memberId={member.id} size={28} />
                <span className="text-sm font-medium truncate" title={member.name}>{member.name}</span>

                {/* Cầu */}
                <button
                  onClick={() => toggleTag(member.id, "play")}
                  className={`inline-flex items-center justify-center rounded-lg border px-1 py-1 text-base transition-all w-10 h-10 cursor-pointer hover:opacity-80 ${
                    v.willPlay
                      ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700"
                      : "bg-muted text-muted-foreground border-transparent opacity-40"
                  }`}
                >
                  🏸
                </button>

                {/* Nhậu */}
                <button
                  onClick={() => toggleTag(member.id, "dine")}
                  className={`inline-flex items-center justify-center rounded-lg border px-1 py-1 text-base transition-all w-10 h-10 cursor-pointer hover:opacity-80 ${
                    v.willDine
                      ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700"
                      : "bg-muted text-muted-foreground border-transparent opacity-40"
                  }`}
                >
                  🍻
                </button>

                {/* Hết nợ */}
                {debt ? (
                  <button
                    onClick={() => togglePayment(member.id)}
                    className={`inline-flex items-center justify-center rounded-lg border px-1 py-1 text-base transition-all w-10 h-10cursor-pointer hover:opacity-80 ${
                      isConfirmed
                        ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700"
                        : "bg-muted text-muted-foreground border-transparent opacity-40"
                    }`}
                  >
                    🪙
                  </button>
                ) : <span />}

                {/* Amount */}
                {debt ? (
                  <span className={`text-xs font-bold tabular-nums text-right ${isConfirmed ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {formatK(debt.amount)}
                  </span>
                ) : <span />}

                {/* Remove */}
                <div className="flex items-center justify-end">
                  {!readOnly && (
                    <button
                      onClick={() => setRemoveTarget({ memberId: member.id, name: member.name })}
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

        {/* Add member */}
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
                const v = getVote(m.id);
                const isIn = v && (v.willPlay || v.willDine);
                return (
                  <button
                    key={m.id}
                    onClick={() => !isIn && handleAddMember(m.id)}
                    disabled={!!isIn}
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
