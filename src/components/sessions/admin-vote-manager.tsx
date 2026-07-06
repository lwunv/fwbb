"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  adminSetVote,
  adminRemoveVote,
  adminSetGuestCount,
} from "@/actions/votes";
import { setMemberMinDeductionExempt } from "@/actions/sessions";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SearchInput } from "@/components/shared/search-input";
import { formatK } from "@/lib/utils";
import { getFundStatus } from "@/lib/fund-core";
import { FundStatusIcon } from "@/components/shared/fund-status-icon";
import {
  computeShuttlecockTotal,
  computePerHeadCharges,
  applyMinDeductionFloor,
  type MemberDebt,
} from "@/lib/cost-calculator";
import { MinDeductionToggle } from "@/components/sessions/min-deduction-toggle";
import { X, Users, Shield, ShieldOff } from "lucide-react";
import {
  FundAdjustDialog,
  type FundAdjustDialogTarget,
} from "@/components/fund/fund-adjust-dialog";
import { confirmPaymentByAdmin, undoPaymentByAdmin } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: import("@/lib/optimistic-votes").PublicMember;
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
  /** Khi cung cấp → render Khách-của-admin stepper bên trong (trên search box).
   *  Gắn callback fire setAdminGuestCount + rollback ở caller. */
  onAdminGuestChange?: (play: number, dine: number) => void;
  /** Ẩn block tóm tắt chi phí (Cầu/Sân/Tổng chi/per-head) — dùng khi caller
   *  đã hiển thị tóm tắt riêng trong card (vd /admin/sessions list). */
  hideCostSummary?: boolean;
  /** Bật rule min-deduction 60K (`sessions.use_min_deduction`). Khi true
   *  → hiển thị icon shield cạnh tên member, admin click để toggle miễn. */
  minDeductionEnabled?: boolean;
  /** Member IDs đã được miễn rule cho session này. */
  exemptMemberIds?: number[];
  /** Map memberId → fund balance để render warning icon cạnh tên member. */
  memberBalances?: Record<number, number>;
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
  onAdminGuestChange,
  hideCostSummary = false,
  minDeductionEnabled = false,
  exemptMemberIds = [],
  memberBalances = {},
}: AdminVoteManagerProps) {
  const t = useTranslations("voting");
  const tCommon = useTranslations("common");
  const tA = useTranslations("adminVote");
  const [search, setSearch] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{
    memberId: number;
    name: string;
  } | null>(null);

  // Optimistic local state — overrides server data instantly
  const [localVotes, setLocalVotes] = useState<Record<number, LocalVote>>({});
  const [localDebts, setLocalDebts] = useState<Record<number, LocalDebt>>({});
  const [localGuests, setLocalGuests] = useState<
    Record<number, { play: number; dine: number }>
  >({});
  const [removedMembers, setRemovedMembers] = useState<Set<number>>(new Set());
  const [addedMembers, setAddedMembers] = useState<Set<number>>(new Set());
  const [expandedGuest, setExpandedGuest] = useState<number | null>(null);
  // Optimistic exempt: memberId → exempt? local override prop từ server.
  const [localExempt, setLocalExempt] = useState<Record<number, boolean>>({});
  const [fundAdjustTarget, setFundAdjustTarget] =
    useState<FundAdjustDialogTarget | null>(null);

  // Resync: drop local optimistic overrides when the MATCHING server data
  // actually changes, so the server view stays authoritative. Done during render
  // (React's "adjust state on prop change" pattern) instead of useEffect, so it
  // resets before paint with no cascading render. fireAction converges via
  // revalidatePath; without this reset a local override would mask fresh props
  // forever (e.g. stale paid/unpaid on this money surface).
  //
  // Keyed PER CONCERN, not one combined snapshot: a 5s poll bringing another
  // admin's vote change must NOT wipe an in-flight payment-confirm override
  // (localDebts), and vice-versa. Each map only resets when its own server
  // source changes.
  const voteSnapshot = JSON.stringify(votes);
  const [prevVoteSnapshot, setPrevVoteSnapshot] = useState(voteSnapshot);
  if (voteSnapshot !== prevVoteSnapshot) {
    setPrevVoteSnapshot(voteSnapshot);
    setLocalVotes({});
    setLocalGuests({});
    setRemovedMembers(new Set());
    setAddedMembers(new Set());
  }
  const debtSnapshot = JSON.stringify(debtMap);
  const [prevDebtSnapshot, setPrevDebtSnapshot] = useState(debtSnapshot);
  if (debtSnapshot !== prevDebtSnapshot) {
    setPrevDebtSnapshot(debtSnapshot);
    setLocalDebts({});
  }
  const exemptSnapshot = JSON.stringify(exemptMemberIds);
  const [prevExemptSnapshot, setPrevExemptSnapshot] = useState(exemptSnapshot);
  if (exemptSnapshot !== prevExemptSnapshot) {
    setPrevExemptSnapshot(exemptSnapshot);
    setLocalExempt({});
  }

  function getExempt(memberId: number): boolean {
    const local = localExempt[memberId];
    if (local !== undefined) return local;
    return exemptMemberIds.includes(memberId);
  }

  function handleToggleExempt(memberId: number) {
    if (readOnly) return;
    const current = getExempt(memberId);
    const next = !current;
    setLocalExempt((s) => ({ ...s, [memberId]: next }));
    fireAsync(
      () => setMemberMinDeductionExempt(sessionId, memberId, next),
      () => setLocalExempt((s) => ({ ...s, [memberId]: current })),
    );
  }

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

  // Fire-and-forget with rollback on error. Routes through the canonical
  // fireAction (auto-retry once + toast.error + rollback) — replaces the old
  // setTimeout-cleared inline error. All these actions are idempotent
  // (set vote / set guest count / remove / confirm-with-key) so retry is safe.
  function fireAsync(
    fn: () => Promise<{ error?: string; success?: boolean }>,
    rollback: () => void,
  ) {
    fireAction(fn, rollback);
  }

  function toggleTag(memberId: number, tag: "play" | "dine") {
    const current = getVote(memberId);
    if (!current) return;
    const newPlay = tag === "play" ? !current.willPlay : current.willPlay;
    const newDine = tag === "dine" ? !current.willDine : current.willDine;
    const prev = { ...current };

    // Optimistic vote update
    setLocalVotes((s) => ({
      ...s,
      [memberId]: { willPlay: newPlay, willDine: newDine },
    }));

    // Khi tắt cờ play/dine, reset guest count tương ứng về 0 để tránh ghost
    // guest: VD member bỏ tick "Nhậu" mà vẫn hiển thị "1 khách 🍻". Chỉ chạy
    // khi đang tắt (true → false) và guest count > 0.
    const togglingOffPlay = tag === "play" && current.willPlay && !newPlay;
    const togglingOffDine = tag === "dine" && current.willDine && !newDine;
    if (togglingOffPlay || togglingOffDine) {
      const guests = getGuestCounts(memberId);
      const needsReset =
        (togglingOffPlay && guests.play > 0) ||
        (togglingOffDine && guests.dine > 0);
      if (needsReset) {
        const prevGuests = { ...guests };
        const nextGuests = {
          play: togglingOffPlay ? 0 : guests.play,
          dine: togglingOffDine ? 0 : guests.dine,
        };
        setLocalGuests((s) => ({ ...s, [memberId]: nextGuests }));
        fireAsync(
          () =>
            adminSetGuestCount(
              sessionId,
              memberId,
              nextGuests.play,
              nextGuests.dine,
            ),
          () => setLocalGuests((s) => ({ ...s, [memberId]: prevGuests })),
        );
      }
    }

    // API: vote update
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

    const idempotencyKey = crypto.randomUUID();
    fireAsync(
      () =>
        newVal
          ? confirmPaymentByAdmin(debt.debtId, idempotencyKey)
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
  // Round-UP-tổng (KHÔNG round per-brand rồi sum). Đồng bộ với
  // calculateSessionCosts → debt finalize match preview. Admin không bị
  // underpay (vì roundToThousand round UP).
  const shuttlecockCost = sc
    ? computeShuttlecockTotal(
        sc.shuttlecocks.map((s) => ({
          quantityUsed: s.quantity,
          pricePerTube: s.pricePerTube,
        })),
      )
    : 0;
  const playCost = sc ? sc.courtPrice + shuttlecockCost : 0;
  // Use the canonical per-head helper so this component stays in lockstep
  // with finalize-session.tsx, session-list.tsx, dashboard-client.tsx and the
  // server-side cost-calculator. Previously inlined the same Math.ceil
  // formula and would drift if the rounding rule changed.
  // adminGuestPlayHeads: khách-của-admin trả sàn 60K, phần dư chia cho nhóm
  // chia đều → playPerHead ở đây là SPLIT rate (members + khách-member), khớp
  // finalize. Khách-member dùng đúng playPerHead này.
  const { playCostPerHead: playPerHead, dineCostPerHead: dinePerHead } = sc
    ? computePerHeadCharges({
        courtPrice: sc.courtPrice,
        shuttlecockCost,
        diningBill: sc.diningBill,
        playerCount,
        dinerCount,
        adminGuestPlayHeads: adminGuestPlayCount,
      })
    : { playCostPerHead: 0, dineCostPerHead: 0 };
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

  /** Predicted debt for a member in this session — uses the same play/dine
   *  state as the row JSX (via getVote + getGuestCounts optimistic helpers). */
  function predictedDebt(memberId: number): MemberDebt {
    const v = getVote(memberId);
    const willPlay = v?.willPlay ?? false;
    const willDine = v?.willDine ?? false;
    const guests = getGuestCounts(memberId);
    const gp = v?.willPlay ? guests.play : 0;
    const gd = v?.willDine ? guests.dine : 0;
    const playAmount = willPlay ? playPerHead : 0;
    const dineAmount = willDine ? dinePerHead : 0;
    const guestPlayAmount = gp * playPerHead;
    const guestDineAmount = gd * dinePerHead;
    return {
      memberId,
      playAmount,
      dineAmount,
      guestPlayAmount,
      guestPlayCount: gp,
      guestDineAmount,
      totalAmount: playAmount + dineAmount + guestPlayAmount + guestDineAmount,
    };
  }

  return (
    <div className="space-y-3">
      {/* Info card — luôn hiện khi có dữ liệu chi/người. Khi chưa completed
          các con số là ước tính (per-head có thể thay đổi nếu thêm/bớt người).
          `hideCostSummary` = caller (vd /admin/sessions list) đã render tóm tắt
          riêng → ẩn để tránh trùng lặp. */}
      {!hideCostSummary &&
        sc &&
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
                      {tA("badminton")}
                    </span>
                    <span className="font-medium">
                      {sc.shuttlecocks.map((s, i) => (
                        <span key={i}>
                          {i > 0 && ", "}
                          <strong>{s.quantity}</strong> {tA("shuttleUnit")}{" "}
                          {s.brandName}
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
                      {sc.courtName ?? tA("court")}
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
                      {tA("dining")}
                    </span>
                    <span className="font-medium text-orange-500 dark:text-orange-400">
                      {formatK(sc.diningBill)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between font-bold">
                  <span>
                    <span className="inline-block w-6 text-center">💰</span>{" "}
                    {tA("totalSpend")}
                  </span>
                  <span>
                    <span className="text-primary">
                      {formatK(totalExpense)}
                    </span>
                    {totalOwed > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        {" "}
                        ({tA("owes")} {formatK(totalOwed)})
                      </span>
                    )}
                    {totalOwed <= 0 && totalDebtAmount > 0 && (
                      <span className="text-green-600 dark:text-green-400">
                        {" "}
                        ({tA("paidOff")})
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-1">
                    <span>
                      🏸{tA("badminton")}{" "}
                      <strong className="text-primary">{playerCount}</strong>
                    </span>
                    {playPerHead > 0 && (
                      <span>
                        ·{" "}
                        <strong className="text-primary">
                          {formatK(playPerHead)}
                        </strong>
                        {tA("perHead")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span>
                      🍻{tA("dining")}{" "}
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
                        {tA("perHead")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Min-deduction toggle — đặt đầu khu vực này (trước admin guest stepper)
          để admin thấy rule trước khi sắp xếp khách/member. Compact 1-line:
          icon + text + switch. Disabled khi readOnly (completed/cancelled). */}
      <MinDeductionToggle
        sessionId={sessionId}
        enabled={minDeductionEnabled}
        exemptCount={exemptMemberIds.length}
        disabled={readOnly}
      />

      {/* Khách của admin (stepper) — hiện ở đầu khu danh sách, trên search.
          Chỉ render khi caller cung cấp `onAdminGuestChange` (parent sở hữu state
          để cost summary cùng tham chiếu một nguồn). */}
      {!readOnly && onAdminGuestChange && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          <span className="text-muted-foreground text-sm font-medium">
            {tA("adminGuests")}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm">🏸</span>
            <NumberStepper
              value={adminGuestPlayCount}
              onChange={(v) => onAdminGuestChange(v, adminGuestDineCount)}
              min={0}
              max={10}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">🍻</span>
            <NumberStepper
              value={adminGuestDineCount}
              onChange={(v) => onAdminGuestChange(adminGuestPlayCount, v)}
              min={0}
              max={10}
            />
          </div>
        </div>
      )}

      {/* Search box */}
      {!readOnly && (
        <SearchInput
          placeholder={`${tCommon("search")}...`}
          value={search}
          onChange={setSearch}
        />
      )}

      {/* Member list — không bọc Card riêng vì parent đã có Card chung. Mỗi
          row member là card duy nhất nổi lên (bg-card đặc + shadow nhẹ) để
          tách biệt rõ giữa các thành viên mà không gây "card-trong-card". */}
      <div className="space-y-2">
        {/* Đã tham gia */}
        <div className="space-y-2">
          {activeMembers.map((member) => {
            const v = getVote(member.id)!;
            const debt = debtMap[member.id];
            const isConfirmed = getDebtConfirmed(member.id);

            const amountShown = displayMemberAmount(member.id);

            return (
              <div
                key={member.id}
                className="bg-card border-primary/30 rounded-xl border px-2 py-1.5 shadow-sm"
              >
                <div className="flex min-h-[3.5rem] items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (memberBalances[member.id] === undefined) return;
                      setFundAdjustTarget({
                        memberId: member.id,
                        memberName: member.name,
                        memberNickname: member.nickname,
                        memberAvatarKey: member.avatarKey ?? null,
                        memberAvatarUrl: member.avatarUrl ?? null,
                        currentBalance: memberBalances[member.id],
                      });
                    }}
                    className="hover:bg-muted/30 -m-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left transition-colors"
                  >
                    <MemberAvatar
                      memberId={member.id}
                      avatarKey={member.avatarKey}
                      avatarUrl={member.avatarUrl}
                      size={36}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-base font-semibold"
                        title={member.name}
                      >
                        <span className="truncate">{member.name}</span>
                        {memberBalances[member.id] !== undefined && (
                          <FundStatusIcon balance={memberBalances[member.id]} />
                        )}
                      </span>
                      {(() => {
                        if (memberBalances[member.id] === undefined)
                          return null;
                        const bal = memberBalances[member.id];
                        const raw = predictedDebt(member.id);
                        const exempt = getExempt(member.id);
                        const after =
                          minDeductionEnabled && !exempt
                            ? applyMinDeductionFloor(raw, bal)
                            : raw;
                        const ded = after.totalAmount;

                        // "Tiền hiện có" theo status:
                        //   hasFund (≥50K) → xanh dương
                        //   lowFund (<50K)  → vàng
                        //   depleted (=0)   → foreground (trắng trong dark mode)
                        //   owing (<0)      → đỏ rose
                        const balStatus = getFundStatus(bal);
                        const balColor =
                          balStatus === "owing"
                            ? "font-semibold text-rose-500 dark:text-rose-400"
                            : balStatus === "depleted"
                              ? "font-semibold text-foreground"
                              : balStatus === "lowFund"
                                ? "font-semibold text-yellow-500 dark:text-yellow-400"
                                : "font-semibold text-blue-600 dark:text-blue-400";

                        if (ded === 0) {
                          // No deduction yet (un-priced session or member not contributing).
                          return (
                            <span
                              className={`text-sm tabular-nums ${balColor}`}
                            >
                              💰 {formatK(bal)}
                            </span>
                          );
                        }

                        const remain = bal - ded;
                        const remainStatus = getFundStatus(remain);
                        const remainColor =
                          remainStatus === "owing"
                            ? "font-semibold text-rose-500 dark:text-rose-400"
                            : remainStatus === "depleted" ||
                                remainStatus === "lowFund"
                              ? "font-semibold text-orange-500 dark:text-orange-400"
                              : "text-foreground";

                        return (
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm tabular-nums">
                            {/* 💰 = quỹ hiện tại; số sau dấu trừ = chi buổi này.
                                Tách rõ để admin không nhìn nhầm thành trừ 2 lần.
                                flex-wrap + min-w-0: màn hẹp thì xuống dòng thay
                                vì tràn ngang đè lên cụm nút vote bên phải. */}
                            <span className={balColor}>💰 {formatK(bal)}</span>
                            <span className="font-medium text-rose-500 dark:text-rose-400">
                              − {formatK(ded)}
                            </span>
                            {after.totalAmount > raw.totalAmount && (
                              <span
                                className="text-xs text-orange-500 dark:text-orange-400"
                                title={tA("min60k", {
                                  from: formatK(raw.totalAmount),
                                  to: formatK(after.totalAmount),
                                })}
                              >
                                🛡
                              </span>
                            )}
                            <span className="text-muted-foreground">=</span>
                            <span className={remainColor}>
                              {formatK(remain)}
                            </span>
                          </span>
                        );
                      })()}
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Cầu — đã vote: LED border + border tĩnh primary; chưa vote: dashed mờ */}
                    {v.willPlay ? (
                      <div className="led-border-sm primary inline-flex">
                        <button
                          type="button"
                          title={t("badmintonShort")}
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
                        title={t("badmintonShort")}
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
                          title={t("diningShort")}
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
                        title={t("diningShort")}
                        disabled={readOnly}
                        onClick={() => toggleTag(member.id, "dine")}
                        className="border-muted-foreground/25 bg-muted/30 text-muted-foreground/60 inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-lg opacity-50 grayscale transition-all hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
                      >
                        🍻
                      </button>
                    )}

                    {/* + Khách — active (đang mở hoặc đã có khách): LED
                          border + border tĩnh primary, đồng bộ với 🏸/🍻.
                          Inactive: dashed mờ. */}
                    {!readOnly &&
                      (() => {
                        const guests = getGuestCounts(member.id);
                        const isActive =
                          expandedGuest === member.id ||
                          guests.play + guests.dine > 0;
                        const onClick = () =>
                          setExpandedGuest(
                            expandedGuest === member.id ? null : member.id,
                          );
                        return isActive ? (
                          <div className="led-border-sm primary inline-flex">
                            <button
                              type="button"
                              title={t("addGuestShort")}
                              onClick={onClick}
                              className="border-primary text-primary inline-flex h-12 w-12 cursor-pointer items-center justify-center border-2 bg-violet-50 transition-all hover:opacity-80 dark:bg-violet-950"
                            >
                              <Users className="h-5 w-5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            title={t("addGuestShort")}
                            onClick={onClick}
                            className="border-muted-foreground/25 bg-muted/30 text-muted-foreground/60 inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed opacity-50 grayscale transition-all hover:opacity-80"
                          >
                            <Users className="h-5 w-5" />
                          </button>
                        );
                      })()}

                    {/* Đã thanh toán */}
                    {debt ? (
                      <button
                        type="button"
                        title={isConfirmed ? tA("paid") : tA("unpaid")}
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
                    {/* Min-deduction exempt toggle — chỉ hiện khi session
                        bật rule AND member đang play (rule chỉ áp dụng cho
                        play share). Filled shield = đang apply; outline =
                        admin đã miễn member này. */}
                    {minDeductionEnabled && !readOnly && v.willPlay && (
                      <button
                        type="button"
                        onClick={() => handleToggleExempt(member.id)}
                        title={
                          getExempt(member.id)
                            ? tA("exemptOn")
                            : tA("exemptOff")
                        }
                        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                          getExempt(member.id)
                            ? "border-muted-foreground/30 bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                        }`}
                      >
                        {getExempt(member.id) ? (
                          <ShieldOff className="h-4 w-4" />
                        ) : (
                          <Shield className="h-4 w-4" />
                        )}
                      </button>
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
                        className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors"
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
                    const isOpen = expandedGuest === member.id;
                    return isOpen ? (
                      <div className="flex flex-wrap items-center gap-2 pt-2 pb-1">
                        <span className="text-muted-foreground text-sm font-medium">
                          {tA("guests")}
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
                    ) : (
                      (() => {
                        // Chỉ hiện guest cho tag thực sự đang on (willPlay /
                        // willDine) — match expanded view (steppers chỉ render
                        // cho tag active). Tránh "ghost guest" khi data còn
                        // guestDineCount > 0 từ trước nhưng willDine đã off.
                        const showPlayGuest = v.willPlay && guests.play > 0;
                        const showDineGuest = v.willDine && guests.dine > 0;
                        if (!showPlayGuest && !showDineGuest) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => setExpandedGuest(member.id)}
                            className="text-primary hover:text-primary/80 pt-1 pb-1 text-left text-sm transition-colors"
                          >
                            {showPlayGuest && (
                              <span>
                                🏸 {guests.play} {tA("guestUnit")}
                              </span>
                            )}
                            {showPlayGuest && showDineGuest && (
                              <span className="mx-2">·</span>
                            )}
                            {showDineGuest && (
                              <span>
                                🍻 {guests.dine} {tA("guestUnit")}
                              </span>
                            )}
                          </button>
                        );
                      })()
                    );
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
                      <button
                        type="button"
                        onClick={() => {
                          if (memberBalances[m.id] === undefined) return;
                          setFundAdjustTarget({
                            memberId: m.id,
                            memberName: m.name,
                            memberNickname: m.nickname,
                            memberAvatarKey: m.avatarKey ?? null,
                            memberAvatarUrl: m.avatarUrl ?? null,
                            currentBalance: memberBalances[m.id],
                          });
                        }}
                        className="hover:bg-muted/30 -m-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left transition-colors"
                      >
                        <MemberAvatar
                          memberId={m.id}
                          avatarKey={m.avatarKey}
                          avatarUrl={m.avatarUrl}
                          size={36}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5 opacity-50">
                          <span className="flex items-center gap-1.5 truncate text-base font-medium">
                            {m.name}
                            {memberBalances[m.id] !== undefined && (
                              <FundStatusIcon balance={memberBalances[m.id]} />
                            )}
                          </span>
                          {memberBalances[m.id] !== undefined &&
                            (() => {
                              const bal = memberBalances[m.id];
                              // Status-colored balance (consistent với voted-list):
                              // owing đỏ, depleted foreground, lowFund vàng, hasFund xanh.
                              const balStatus = getFundStatus(bal);
                              const balColor =
                                balStatus === "owing"
                                  ? "font-semibold text-rose-500 dark:text-rose-400"
                                  : balStatus === "depleted"
                                    ? "font-semibold text-foreground"
                                    : balStatus === "lowFund"
                                      ? "font-semibold text-yellow-500 dark:text-yellow-400"
                                      : "font-semibold text-blue-600 dark:text-blue-400";
                              return (
                                <span
                                  className={`text-sm tabular-nums ${balColor}`}
                                >
                                  {formatK(bal)}
                                </span>
                              );
                            })()}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddMember(m.id, true, false)}
                          className="border-primary hover:bg-primary/20 bg-muted/30 relative inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed transition-all"
                          title={t("addPlayer")}
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
                          title={t("addDiner")}
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
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={tA("removeTitle", { name: removeTarget?.name ?? "" })}
        description={tA("removeDesc")}
        onConfirm={handleRemoveConfirm}
      />
      <FundAdjustDialog
        target={fundAdjustTarget}
        open={fundAdjustTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFundAdjustTarget(null);
        }}
      />
    </div>
  );
}
