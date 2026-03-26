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

interface SessionCosts {
  courtPrice: number;
  courtName: string | null;
  diningBill: number;
  shuttlecocks: { brandName: string; quantity: number; pricePerTube: number }[];
  startTime: string;
  endTime: string;
  isCompleted: boolean;
}

interface AdminVoteManagerProps {
  sessionId: number;
  votes: Vote[];
  members: Member[];
  debtMap?: Record<number, DebtInfo>;
  readOnly?: boolean;
  sessionCosts?: SessionCosts;
}

// Local optimistic state types
interface LocalVote { willPlay: boolean; willDine: boolean; }
interface LocalDebt { adminConfirmed: boolean; }

export function AdminVoteManager({ sessionId, votes, members, debtMap = {}, readOnly = false, sessionCosts }: AdminVoteManagerProps) {
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

  /** Thành viên (không tính khách) đang play / dine */
  const memberPlayerCount = activeMembers.filter((m) => getVote(m.id)?.willPlay).length;
  const memberDinerCount = activeMembers.filter((m) => getVote(m.id)?.willDine).length;

  /** Khách cộng từ vote — bỏ member đã remove khỏi danh sách */
  const totalGuestPlay = votes.reduce((s, v) => {
    if (removedMembers.has(v.memberId)) return s;
    return s + (v.guestPlayCount ?? 0);
  }, 0);
  const totalGuestDine = votes.reduce((s, v) => {
    if (removedMembers.has(v.memberId)) return s;
    return s + (v.guestDineCount ?? 0);
  }, 0);

  /** Tổng “mạng” play/dine — khớp logic finalize (cost-calculator) */
  const playerCount = memberPlayerCount + totalGuestPlay;
  const dinerCount = memberDinerCount + totalGuestDine;

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
    return list.filter((m) => m.name.toLowerCase().includes(lower));
  }

  const sc = sessionCosts;
  const shuttlecockCost = sc ? sc.shuttlecocks.reduce((sum, s) => sum + Math.round(s.quantity * s.pricePerTube / 12), 0) : 0;
  const playCost = sc ? sc.courtPrice + shuttlecockCost : 0;
  const playPerHead = playerCount > 0 ? Math.ceil(playCost / playerCount / 1000) * 1000 : 0;
  const dinePerHead = dinerCount > 0 && sc ? Math.ceil(sc.diningBill / dinerCount / 1000) * 1000 : 0;
  const totalExpense = sc ? playCost + sc.diningBill : 0;
  const paidAmount = Object.entries(debtMap).filter(([mid]) => getDebtConfirmed(Number(mid))).reduce((sum, [, d]) => sum + d.amount, 0);
  const totalDebtAmount = Object.values(debtMap).reduce((sum, d) => sum + d.amount, 0);
  const totalOwed = totalDebtAmount - paidAmount;

  function getVoteRow(memberId: number) {
    return votes.find((v) => v.memberId === memberId);
  }

  /** Ưu tiên nợ đã finalize; không thì ước lượng theo play/dine + khách */
  function displayMemberAmount(memberId: number): number | null {
    const debt = debtMap[memberId];
    if (debt && sc?.isCompleted) {
      return debt.amount;
    }
    if (!sc) return debt?.amount ?? null;
    const v = getVote(memberId);
    if (!v) return debt?.amount ?? null;
    const row = getVoteRow(memberId);
    const gp = row?.guestPlayCount ?? 0;
    const gd = row?.guestDineCount ?? 0;
    const playPart =
      (v.willPlay ? playPerHead : 0) + gp * playPerHead;
    const dinePart =
      (v.willDine ? dinePerHead : 0) + gd * dinePerHead;
    const est = playPart + dinePart;
    if (est > 0) return est;
    return debt?.amount ?? null;
  }

  return (
    <div className="space-y-3">
      {/* Info card — blue tint */}
      {sc && (
        <Card className="bg-blue-50/40 border-blue-200/40 dark:bg-blue-950/20 dark:border-blue-900/30 !py-2">
          <CardContent className="px-3 py-0 space-y-1.5">
            <div className="flex items-center text-sm">
              <span className="inline-block w-6 text-center">⏰</span> <span className="ml-1">{sc.startTime} - {sc.endTime}</span>
            </div>
            {sc.isCompleted && (
              <div className="space-y-0.5 text-sm">
                {sc.shuttlecocks.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground"><span className="inline-block w-6 text-center">🏸</span> Cầu</span>
                    <span className="font-medium">{sc.shuttlecocks.map((s, i) => <span key={i}>{i > 0 && ", "}<strong>{s.quantity}</strong> quả {s.brandName}</span>)} · <span className="text-primary">{formatK(shuttlecockCost)}</span></span>
                  </div>
                )}
                {sc.courtPrice > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground"><span className="inline-block w-6 text-center">🏟</span> {sc.courtName ?? "Sân"}</span>
                    <span className="font-medium text-primary">{formatK(sc.courtPrice)}</span>
                  </div>
                )}
                {sc.diningBill > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground"><span className="inline-block w-6 text-center">🍻</span> Nhậu</span>
                    <span className="font-medium text-orange-500 dark:text-orange-400">{formatK(sc.diningBill)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-bold">
                  <span><span className="inline-block w-6 text-center">💰</span> Tổng chi</span>
                  <span>
                    <span className="text-primary">{formatK(totalExpense)}</span>
                    {totalOwed > 0 && <span className="text-red-600 dark:text-red-400"> (nợ {formatK(totalOwed)})</span>}
                    {totalOwed <= 0 && totalDebtAmount > 0 && <span className="text-green-600 dark:text-green-400"> (✓ hết nợ)</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1">
                    <span>🏸Cầu <strong className="text-primary">{playerCount}</strong></span>
                    {playPerHead > 0 && <span>· <strong className="text-primary">{formatK(playPerHead)}</strong>/mạng</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span>🍻Nhậu <strong className="text-orange-500 dark:text-orange-400">{dinerCount}</strong></span>
                    {dinePerHead > 0 && <span>· <strong className="text-orange-500 dark:text-orange-400">{formatK(dinePerHead)}</strong>/mạng</span>}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Member list card — amber tint */}
      <Card className="bg-amber-50/30 border-amber-200/40 dark:bg-amber-950/10 dark:border-amber-900/20 !py-0">
        <CardContent className="px-3 py-0 space-y-2">
          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive text-xs p-2 text-center">{error}</div>
          )}
          <div className="flex items-center justify-between">
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

            const amountShown = displayMemberAmount(member.id);

            return (
              <div
                key={member.id}
                className="flex items-center gap-2 py-2 min-h-[2.75rem]"
              >
                <MemberAvatar memberId={member.id} avatarKey={member.avatarKey} avatarUrl={member.avatarUrl} size={28} />
                <span className="text-sm font-medium truncate min-w-0 flex-1" title={member.name}>
                  {member.name}
                </span>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Cầu */}
                  <button
                    type="button"
                    title="Cầu lông"
                    disabled={readOnly}
                    onClick={() => toggleTag(member.id, "play")}
                    className={`inline-flex shrink-0 items-center justify-center rounded-lg border text-base transition-all w-10 h-10 cursor-pointer hover:opacity-80 disabled:pointer-events-none disabled:opacity-50 ${
                      v.willPlay
                        ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700"
                        : "bg-muted text-muted-foreground border-transparent opacity-40"
                    }`}
                  >
                    🏸
                  </button>

                  {/* Nhậu */}
                  <button
                    type="button"
                    title="Nhậu"
                    disabled={readOnly}
                    onClick={() => toggleTag(member.id, "dine")}
                    className={`inline-flex shrink-0 items-center justify-center rounded-lg border text-base transition-all w-10 h-10 cursor-pointer hover:opacity-80 disabled:pointer-events-none disabled:opacity-50 ${
                      v.willDine
                        ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700"
                        : "bg-muted text-muted-foreground border-transparent opacity-40"
                    }`}
                  >
                    🍻
                  </button>

                  {/* Đã thanh toán */}
                  {debt ? (
                    <button
                      type="button"
                      title={isConfirmed ? "Đã thanh toán" : "Chưa thanh toán"}
                      onClick={() => togglePayment(member.id)}
                      className={`inline-flex shrink-0 items-center justify-center rounded-lg border text-base transition-all w-10 h-10 cursor-pointer hover:opacity-80 ${
                        isConfirmed
                          ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700"
                          : "bg-muted text-muted-foreground border-transparent opacity-40"
                      }`}
                    >
                      🪙
                    </button>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden />
                  )}
                </div>

                <div className="flex min-w-[3.25rem] items-center justify-end gap-1 shrink-0">
                  {amountShown != null && (
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        debt
                          ? isConfirmed
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                          : "text-foreground"
                      }`}
                    >
                      {formatK(amountShown)}
                    </span>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setRemoveTarget({ memberId: member.id, name: member.name })}
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5 shrink-0"
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
                    <MemberAvatar memberId={m.id} avatarKey={m.avatarKey} avatarUrl={m.avatarUrl} size={20} />
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
    </div>
  );
}
