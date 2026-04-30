"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  adminSetVote,
  adminRemoveVote,
  adminSetGuestCount,
} from "@/actions/votes";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatK } from "@/lib/utils";
import { calculateShuttlecockCost } from "@/lib/cost-calculator";
import { X, Search, Users } from "lucide-react";
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
  adminGuestPlayCount?: number;
  adminGuestDineCount?: number;
}

// Local optimistic state types
interface LocalVote {
  willPlay: boolean;
  willDine: boolean;
}
interface LocalDebt {
  adminConfirmed: boolean;
}

export function AdminVoteManager({
  sessionId,
  votes,
  members,
  debtMap = {},
  readOnly = false,
  sessionCosts,
  adminGuestPlayCount = 0,
  adminGuestDineCount = 0,
}: AdminVoteManagerProps) {
  const t = useTranslations("voting");
  const tCommon = useTranslations("common");
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{
    memberId: number;
    name: string;
  } | null>(null);
  const [error, setError] = useState("");

  // Optimistic local state — overrides server data instantly
  const [localVotes, setLocalVotes] = useState<Record<number, LocalVote>>({});
  const [localDebts, setLocalDebts] = useState<Record<number, LocalDebt>>({});
  const [localGuests, setLocalGuests] = useState<
    Record<number, { play: number; dine: number }>
  >({});
  const [removedMembers, setRemovedMembers] = useState<Set<number>>(new Set());
  const [addedMembers, setAddedMembers] = useState<Set<number>>(new Set());
  const [expandedGuest, setExpandedGuest] = useState<number | null>(null);

  // Merge server + local state
  function getVote(
    memberId: number,
  ): { willPlay: boolean; willDine: boolean } | null {
    if (removedMembers.has(memberId)) return null;
    const local = localVotes[memberId];
    if (local) return local;
    const sv = votes.find((v) => v.memberId === memberId);
    if (sv)
      return { willPlay: sv.willPlay ?? false, willDine: sv.willDine ?? false };
    if (addedMembers.has(memberId)) return { willPlay: true, willDine: true };
    return null;
  }

  function getDebtConfirmed(memberId: number): boolean {
    const local = localDebts[memberId];
    if (local !== undefined) return local.adminConfirmed;
    return debtMap[memberId]?.adminConfirmed ?? false;
  }

  const allActiveMembers = members.filter((m) => {
    const v = getVote(m.id);
    return v && (v.willPlay || v.willDine);
  });
  const activeMembers = filterMembers(allActiveMembers, search);

  /** Thành viên (không tính khách) đang play / dine */
  const memberPlayerCount = allActiveMembers.filter(
    (m) => getVote(m.id)?.willPlay,
  ).length;
  const memberDinerCount = allActiveMembers.filter(
    (m) => getVote(m.id)?.willDine,
  ).length;

  /** Khách cộng từ vote — bỏ member đã remove khỏi danh sách. Cộng cả khách
   *  của admin (lưu trên `sessions.admin_guest_*_count`) để khớp finalize. */
  const totalGuestPlay =
    votes.reduce((s, v) => {
      if (removedMembers.has(v.memberId)) return s;
      return s + (v.guestPlayCount ?? 0);
    }, 0) + adminGuestPlayCount;
  const totalGuestDine =
    votes.reduce((s, v) => {
      if (removedMembers.has(v.memberId)) return s;
      return s + (v.guestDineCount ?? 0);
    }, 0) + adminGuestDineCount;

  /** Tổng “mạng” play/dine — khớp logic finalize (cost-calculator) */
  const playerCount = memberPlayerCount + totalGuestPlay;
  const dinerCount = memberDinerCount + totalGuestDine;

  // Fire-and-forget with rollback on error
  function fireAsync(
    fn: () => Promise<{ error?: string; success?: boolean }>,
    rollback: () => void,
  ) {
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
    setLocalVotes((s) => ({
      ...s,
      [memberId]: { willPlay: newPlay, willDine: newDine },
    }));

    // API
    fireAsync(
      () => adminSetVote(sessionId, memberId, newPlay, newDine),
      () => setLocalVotes((s) => ({ ...s, [memberId]: prev })),
    );
  }

  function handleAddMember(memberId: number, play: boolean, dine: boolean) {
    if (readOnly) return;
    setAddedMembers((s) => new Set(s).add(memberId));
    setLocalVotes((s) => ({
      ...s,
      [memberId]: { willPlay: play, willDine: dine },
    }));
    setRemovedMembers((s) => {
      const n = new Set(s);
      n.delete(memberId);
      return n;
    });

    fireAsync(
      () => adminSetVote(sessionId, memberId, play, dine),
      () => {
        setAddedMembers((s) => {
          const n = new Set(s);
          n.delete(memberId);
          return n;
        });
        setLocalVotes((s) => {
          const n = { ...s };
          delete n[memberId];
          return n;
        });
      },
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
      () =>
        setRemovedMembers((s) => {
          const n = new Set(s);
          n.delete(mid);
          return n;
        }),
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
      () =>
        newVal
          ? confirmPaymentByAdmin(debt.debtId)
          : undoPaymentByAdmin(debt.debtId),
      () =>
        setLocalDebts((s) => ({
          ...s,
          [memberId]: { adminConfirmed: current },
        })),
    );
  }

  function filterMembers(list: Member[], q: string) {
    if (!q) return list;
    const lower = q.toLowerCase();
    return list.filter((m) => m.name.toLowerCase().includes(lower));
  }

  const sc = sessionCosts;
  const shuttlecockCost = sc
    ? sc.shuttlecocks.reduce(
        (sum, s) => sum + calculateShuttlecockCost(s.quantity, s.pricePerTube),
        0,
      )
    : 0;
  const playCost = sc ? sc.courtPrice + shuttlecockCost : 0;
  const playPerHead =
    playerCount > 0 ? Math.ceil(playCost / playerCount / 1000) * 1000 : 0;
  const dinePerHead =
    dinerCount > 0 && sc
      ? Math.ceil(sc.diningBill / dinerCount / 1000) * 1000
      : 0;
  const totalExpense = sc ? playCost + sc.diningBill : 0;
  const paidAmount = Object.entries(debtMap)
    .filter(([mid]) => getDebtConfirmed(Number(mid)))
    .reduce((sum, [, d]) => sum + d.amount, 0);
  const totalDebtAmount = Object.values(debtMap).reduce(
    (sum, d) => sum + d.amount,
    0,
  );
  const totalOwed = totalDebtAmount - paidAmount;

  function getVoteRow(memberId: number) {
    return votes.find((v) => v.memberId === memberId);
  }

  function getGuestCounts(memberId: number): { play: number; dine: number } {
    const local = localGuests[memberId];
    if (local) return local;
    const row = getVoteRow(memberId);
    return { play: row?.guestPlayCount ?? 0, dine: row?.guestDineCount ?? 0 };
  }

  function handleGuestChange(
    memberId: number,
    field: "play" | "dine",
    value: number,
  ) {
    const current = getGuestCounts(memberId);
    const prev = { ...current };
    const next = { ...current, [field]: value };
    setLocalGuests((s) => ({ ...s, [memberId]: next }));
    fireAsync(
      () => adminSetGuestCount(sessionId, memberId, next.play, next.dine),
      () => setLocalGuests((s) => ({ ...s, [memberId]: prev })),
    );
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
    const playPart = (v.willPlay ? playPerHead : 0) + gp * playPerHead;
    const dinePart = (v.willDine ? dinePerHead : 0) + gd * dinePerHead;
    const est = playPart + dinePart;
    if (est > 0) return est;
    return debt?.amount ?? null;
  }

  return (
    <div className="space-y-3">
      {/* Info card — luôn hiện khi có dữ liệu chi/người. Khi chưa completed
          các con số là ước tính (per-head có thể thay đổi nếu thêm/bớt người). */}
      {sc &&
        (sc.courtPrice > 0 ||
          sc.diningBill > 0 ||
          shuttlecockCost > 0 ||
          playerCount > 0 ||
          dinerCount > 0) && (
          <Card className="border-blue-200/40 bg-blue-50/40 !py-2 dark:border-blue-900/30 dark:bg-blue-950/20">
            <CardContent className="space-y-1.5 px-3 py-0">
              <div className="space-y-0.5 text-sm">
                {sc.shuttlecocks.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      <span className="inline-block w-6 text-center">🏸</span>{" "}
                      Cầu
                    </span>
                    <span className="font-medium">
                      {sc.shuttlecocks.map((s, i) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          <strong>{s.quantity}</strong> quả {s.brandName}
                        </span>
                      ))}{" "}
                      ·{" "}
                      <span className="text-primary">
                        {formatK(shuttlecockCost)}
                      </span>
                    </span>
                  </div>
                )}
                {sc.courtPrice > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      <span className="inline-block w-6 text-center">🏟</span>{" "}
                      {sc.courtName ?? "Sân"}
                    </span>
                    <span className="text-primary font-medium">
                      {formatK(sc.courtPrice)}
                    </span>
                  </div>
                )}
                {sc.diningBill > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      <span className="inline-block w-6 text-center">🍻</span>{" "}
                      Nhậu
                    </span>
                    <span className="font-medium text-orange-500 dark:text-orange-400">
                      {formatK(sc.diningBill)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between font-bold">
                  <span>
                    <span className="inline-block w-6 text-center">💰</span>{" "}
                    Tổng chi
                  </span>
                  <span>
                    <span className="text-primary">
                      {formatK(totalExpense)}
                    </span>
                    {totalOwed > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        {" "}
                        (nợ {formatK(totalOwed)})
                      </span>
                    )}
                    {totalOwed <= 0 && totalDebtAmount > 0 && (
                      <span className="text-green-600 dark:text-green-400">
                        {" "}
                        (✓ hết nợ)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1">
                    <span>
                      🏸Cầu{" "}
                      <strong className="text-primary">{playerCount}</strong>
                    </span>
                    {playPerHead > 0 && (
                      <span>
                        ·{" "}
                        <strong className="text-primary">
                          {formatK(playPerHead)}
                        </strong>
                        /mạng
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span>
                      🍻Nhậu{" "}
                      <strong className="text-orange-500 dark:text-orange-400">
                        {dinerCount}
                      </strong>
                    </span>
                    {dinePerHead > 0 && (
                      <span>
                        ·{" "}
                        <strong className="text-orange-500 dark:text-orange-400">
                          {formatK(dinePerHead)}
                        </strong>
                        /mạng
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Search box — solid bg + border-2 cho dễ thấy hơn */}
      {!readOnly && (
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`${tCommon("search")}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-card focus:border-primary h-12 w-full rounded-xl border-2 pr-4 pl-11 text-base transition-colors outline-none"
          />
        </div>
      )}

      {/* Member list card — amber tint */}
      <Card className="border-amber-200/40 bg-amber-50/30 !py-0 dark:border-amber-900/20 dark:bg-amber-950/10">
        <CardContent className="space-y-2 px-3 py-0">
          {error && (
            <div className="bg-destructive/10 text-destructive rounded-md p-2 text-center text-xs">
              {error}
            </div>
          )}

          {/* Đã tham gia — mỗi row có nền primary nhẹ + ring để nổi hơn list "Chưa vote" */}
          <div className="space-y-2 py-2">
            {activeMembers.map((member) => {
              const v = getVote(member.id)!;
              const debt = debtMap[member.id];
              const isConfirmed = getDebtConfirmed(member.id);

              const amountShown = displayMemberAmount(member.id);

              return (
                <div
                  key={member.id}
                  className="bg-primary/[0.06] ring-primary/15 dark:bg-primary/[0.08] rounded-xl p-2 ring-1"
                >
                  <div className="flex min-h-[3.5rem] items-center gap-3">
                    <MemberAvatar
                      memberId={member.id}
                      avatarKey={member.avatarKey}
                      avatarUrl={member.avatarUrl}
                      size={36}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-base font-semibold"
                      title={member.name}
                    >
                      {member.name}
                    </span>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* Cầu — đã vote: LED border + border tĩnh primary; chưa vote: dashed mờ */}
                      {v.willPlay ? (
                        <div className="led-border-sm primary inline-flex">
                          <button
                            type="button"
                            title="Cầu lông"
                            disabled={readOnly}
                            onClick={() => toggleTag(member.id, "play")}
                            className="border-primary text-primary inline-flex h-12 w-12 cursor-pointer items-center justify-center border-2 bg-violet-50 text-lg transition-all hover:opacity-80 disabled:pointer-events-none disabled:opacity-50 dark:bg-violet-950"
                          >
                            🏸
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Cầu lông"
                          disabled={readOnly}
                          onClick={() => toggleTag(member.id, "play")}
                          className="border-muted-foreground/25 bg-muted/30 text-muted-foreground/60 inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-lg opacity-50 grayscale transition-all hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
                        >
                          🏸
                        </button>
                      )}

                      {/* Nhậu — đã vote: LED border + border tĩnh cam; chưa vote: dashed mờ */}
                      {v.willDine ? (
                        <div className="led-border-sm orange inline-flex">
                          <button
                            type="button"
                            title="Nhậu"
                            disabled={readOnly}
                            onClick={() => toggleTag(member.id, "dine")}
                            className="inline-flex h-12 w-12 cursor-pointer items-center justify-center border-2 border-orange-500 bg-orange-50 text-lg text-orange-700 transition-all hover:opacity-80 disabled:pointer-events-none disabled:opacity-50 dark:border-orange-400 dark:bg-orange-950 dark:text-orange-300"
                          >
                            🍻
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          title="Nhậu"
                          disabled={readOnly}
                          onClick={() => toggleTag(member.id, "dine")}
                          className="border-muted-foreground/25 bg-muted/30 text-muted-foreground/60 inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-lg opacity-50 grayscale transition-all hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
                        >
                          🍻
                        </button>
                      )}

                      {/* + Khách button */}
                      {!readOnly && (
                        <button
                          type="button"
                          title="Thêm khách"
                          onClick={() =>
                            setExpandedGuest(
                              expandedGuest === member.id ? null : member.id,
                            )
                          }
                          className={`inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border text-xs font-bold transition-all hover:opacity-80 ${
                            expandedGuest === member.id ||
                            getGuestCounts(member.id).play +
                              getGuestCounts(member.id).dine >
                              0
                              ? "bg-primary/10 text-primary border-primary"
                              : "bg-muted text-muted-foreground border-transparent opacity-60"
                          }`}
                        >
                          <Users className="h-5 w-5" />
                        </button>
                      )}

                      {/* Đã thanh toán */}
                      {debt ? (
                        <button
                          type="button"
                          title={
                            isConfirmed ? "Đã thanh toán" : "Chưa thanh toán"
                          }
                          onClick={() => togglePayment(member.id)}
                          className={`inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border text-lg transition-all hover:opacity-80 ${
                            isConfirmed
                              ? "border-green-300 bg-green-100 text-green-700 dark:border-green-700 dark:bg-green-900/40 dark:text-green-300"
                              : "bg-muted text-muted-foreground border-transparent opacity-40"
                          }`}
                        >
                          🪙
                        </button>
                      ) : null}
                    </div>

                    <div className="flex min-w-[3.5rem] shrink-0 items-center justify-end gap-1.5">
                      {sc?.isCompleted && amountShown != null && (
                        <span
                          className={`text-sm font-bold tabular-nums ${
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
                          onClick={() =>
                            setRemoveTarget({
                              memberId: member.id,
                              name: member.name,
                            })
                          }
                          className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Guest expand row */}
                  {!readOnly &&
                    (() => {
                      const guests = getGuestCounts(member.id);
                      const totalGuests = guests.play + guests.dine;
                      const isOpen = expandedGuest === member.id;
                      return isOpen ? (
                        <div className="flex flex-wrap items-center gap-2 pt-2 pb-1">
                          <span className="text-muted-foreground text-sm font-medium">
                            Khách:
                          </span>
                          {v.willPlay && (
                            <>
                              <span className="text-sm">🏸</span>
                              <NumberStepper
                                value={guests.play}
                                onChange={(val) =>
                                  handleGuestChange(member.id, "play", val)
                                }
                                min={0}
                                max={5}
                              />
                            </>
                          )}
                          {v.willDine && (
                            <>
                              <span className="text-sm">🍻</span>
                              <NumberStepper
                                value={guests.dine}
                                onChange={(val) =>
                                  handleGuestChange(member.id, "dine", val)
                                }
                                min={0}
                                max={5}
                              />
                            </>
                          )}
                        </div>
                      ) : totalGuests > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpandedGuest(member.id)}
                          className="text-primary hover:text-primary/80 pt-1 pb-1 text-left text-sm transition-colors"
                        >
                          {guests.play > 0 && (
                            <span>🏸 {guests.play} khách</span>
                          )}
                          {guests.play > 0 && guests.dine > 0 && (
                            <span className="mx-2">·</span>
                          )}
                          {guests.dine > 0 && (
                            <span>🍻 {guests.dine} khách</span>
                          )}
                        </button>
                      ) : null;
                    })()}
                </div>
              );
            })}
            {activeMembers.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-xs">
                {tCommon("noOne")}
              </p>
            )}
          </div>

          {/* Chưa tham gia */}
          {!readOnly &&
            (() => {
              const inactiveMembers = filterMembers(
                members.filter((m) => {
                  const v = getVote(m.id);
                  return !v || (!v.willPlay && !v.willDine);
                }),
                search,
              );
              if (inactiveMembers.length === 0) return null;
              return (
                <div className="space-y-1 border-t pt-3">
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    {t("notVoted")} ({inactiveMembers.length})
                  </p>
                  <div className="divide-y">
                    {inactiveMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex min-h-[3rem] items-center gap-3 py-3"
                      >
                        <MemberAvatar
                          memberId={m.id}
                          avatarKey={m.avatarKey}
                          avatarUrl={m.avatarUrl}
                          size={36}
                        />
                        <span className="min-w-0 flex-1 truncate text-base font-medium opacity-50">
                          {m.name}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAddMember(m.id, true, false)}
                            className="border-primary hover:bg-primary/20 bg-muted/30 relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-all"
                            title="Thêm chơi cầu"
                          >
                            <span className="text-lg opacity-30">🏸</span>
                            <span className="text-primary absolute inset-0 flex items-center justify-center text-2xl font-black">
                              +
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAddMember(m.id, false, true)}
                            className="bg-muted/30 relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed border-orange-500 transition-all hover:bg-orange-900/30 dark:border-orange-400"
                            title="Thêm nhậu"
                          >
                            <span className="text-lg opacity-30">🍻</span>
                            <span className="absolute inset-0 flex items-center justify-center text-2xl font-black text-orange-500 dark:text-orange-400">
                              +
                            </span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
        </CardContent>

        <ConfirmDialog
          open={removeTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          title={`Xóa ${removeTarget?.name ?? ""}?`}
          description="Xóa khỏi danh sách buổi chơi này?"
          onConfirm={handleRemoveConfirm}
        />
      </Card>
    </div>
  );
}
