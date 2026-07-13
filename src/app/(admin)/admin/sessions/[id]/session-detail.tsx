"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cancelSession } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { Button } from "@/components/ui/button";
import {
  AdminSessionCard,
  type AdminSessionCardSession,
} from "@/components/sessions/admin-session-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { usePolling } from "@/lib/use-polling";
import { ArrowLeft, XCircle } from "lucide-react";
import { ymdInVN } from "@/lib/date-format";
import { deriveSessionBadge, type SessionStatus } from "@/lib/session-status";
import type { InferSelectModel } from "drizzle-orm";
import type {
  sessions as sessionsTable,
  courts as courtsTable,
  votes as votesTable,
  members as membersTable,
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Session = InferSelectModel<typeof sessionsTable> & {
  court: InferSelectModel<typeof courtsTable> | null;
  shuttlecocks: (InferSelectModel<typeof sessionShuttlecocksTable> & {
    brand: InferSelectModel<typeof brandsTable>;
  })[];
};

type Vote = InferSelectModel<typeof votesTable> & {
  member: import("@/lib/optimistic-votes").PublicMember;
};

type Court = InferSelectModel<typeof courtsTable>;
type Brand = InferSelectModel<typeof brandsTable>;
type Member = InferSelectModel<typeof membersTable>;

export function SessionDetail({
  session,
  votes,
  courts,
  brands,
  members,
  debtMap = {},
  defaultCourtId = null,
  sessionDays,
  exemptMemberIds = [],
  memberBalances = {},
}: {
  session: Session;
  votes: Vote[];
  courts: Court[];
  brands: Brand[];
  members: Member[];
  debtMap?: Record<
    number,
    { amount: number; adminConfirmed: boolean; debtId: number }
  >;
  defaultCourtId?: number | null;
  /** Lịch ngày chơi từ getSessionDaysOfWeek() — cần để CourtSelector preview
   *  đúng giá khi admin đã đổi lịch khỏi mặc định M/W/F. */
  sessionDays?: readonly number[] | number[];
  /** Member IDs đã được admin miễn khỏi min-deduction floor. */
  exemptMemberIds?: number[];
  /** Map memberId → fund balance. Threaded xuống AdminVoteManager để
   *  render warning icon cạnh tên member trong row. */
  memberBalances?: Record<number, number>;
}) {
  const [localStatus, setLocalStatus] = useState(session.status);
  // Optimistic mirror của giá/tên sân + danh sách cầu. CourtSelector /
  // ShuttlecockSelector cập nhật giá HIỂN THỊ của CHÍNH chúng ngay, nhưng tóm
  // tắt chi phí (SessionCostStats + trừ dự kiến từng member trong AdminVoteManager)
  // đọc các state này → recompute NGAY, không chờ revalidate. Nguồn optimistic
  // vẫn là 2 selector (chúng giữ fireAction + rollback); ở đây chỉ mirror giá
  // trị hiệu lực chúng báo lên.
  const [localCourtPrice, setLocalCourtPrice] = useState(
    session.courtPrice ?? 0,
  );
  const [localCourtName, setLocalCourtName] = useState(
    session.court?.name ?? null,
  );
  const [localShuttlecocks, setLocalShuttlecocks] = useState(
    session.shuttlecocks,
  );
  const t = useTranslations("sessions");
  usePolling();

  // Sync localStatus when server prop changes (after revalidation)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- local optimistic state must resync after server revalidation.
    setLocalStatus(session.status);
  }, [session.status]);

  // Resync mirror khi server prop đổi (sau revalidate). Selector cũng resync
  // state riêng của chúng từ cùng prop → 2 nguồn hội tụ về cùng số.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- local optimistic mirror must resync after server revalidation.
    setLocalCourtPrice(session.courtPrice ?? 0);
  }, [session.courtPrice]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- local optimistic mirror must resync after server revalidation.
    setLocalCourtName(session.court?.name ?? null);
  }, [session.court?.name]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- local optimistic mirror must resync after server revalidation.
    setLocalShuttlecocks(session.shuttlecocks);
  }, [session.shuttlecocks]);

  // Callback ổn định (useCallback) để effect mirror trong CourtSelector không
  // chạy lại mỗi render.
  const handleCourtChange = useCallback(
    (price: number, name: string | null) => {
      setLocalCourtPrice(price);
      setLocalCourtName(name);
    },
    [],
  );

  // Shared badge derivation (session-list/AdminSessionCard dùng chung).
  const badge = deriveSessionBadge(localStatus, session.date, ymdInVN());

  const isActive = localStatus === "voting" || localStatus === "confirmed";

  // effectiveStatus cho card — coerce localStatus (đã fold optimistic cancel).
  const rawStatus = localStatus ?? "voting";
  const effectiveStatus: SessionStatus = (
    ["voting", "confirmed", "completed", "cancelled"].includes(rawStatus)
      ? rawStatus
      : "voting"
  ) as SessionStatus;

  const [showCancelDialog, setShowCancelDialog] = useState(false);

  function handleCancelConfirm() {
    const prev = localStatus;
    setLocalStatus("cancelled");
    setShowCancelDialog(false);
    fireAction(
      () => cancelSession(session.id),
      () => setLocalStatus(prev),
    );
  }

  // Derive aggregate counts from votes (detail không có sẵn như grid). Cùng
  // semantics với /admin/sessions page.tsx cho buổi chưa completed: đếm theo
  // vote, khách = tổng guest count của member + khách-của-admin.
  const memberGuestPlay = votes.reduce(
    (sum, v) => sum + (v.guestPlayCount ?? 0),
    0,
  );
  const memberGuestDine = votes.reduce(
    (sum, v) => sum + (v.guestDineCount ?? 0),
    0,
  );
  const adminGuestPlay = session.adminGuestPlayCount ?? 0;
  const adminGuestDine = session.adminGuestDineCount ?? 0;

  // Tổng nợ/đã trả suy từ debtMap (buổi completed) để SessionCostStats hiện
  // đúng "Tổng thu" thực tế.
  const debtValues = Object.values(debtMap);
  const totalDebt = debtValues.reduce((sum, d) => sum + d.amount, 0);
  const paidDebt = debtValues
    .filter((d) => d.adminConfirmed)
    .reduce((sum, d) => sum + d.amount, 0);

  const cardSession: AdminSessionCardSession = {
    id: session.id,
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
    status: session.status,
    courtId: session.courtId,
    courtQuantity: session.courtQuantity ?? 1,
    courtName: session.court?.name ?? null,
    courtMapLink: session.court?.mapLink ?? null,
    courtPrice: session.courtPrice,
    courtPriceOverridden: session.courtPriceOverridden ?? false,
    diningBill: session.diningBill ?? 0,
    adminGuestPlayCount: adminGuestPlay,
    adminGuestDineCount: adminGuestDine,
    useMinDeduction: session.useMinDeduction ?? false,
    exemptMemberIds,
    playerCount: votes.filter((v) => v.willPlay).length,
    dinerCount: votes.filter((v) => v.willDine).length,
    guestPlayCount: memberGuestPlay + adminGuestPlay,
    guestDineCount: memberGuestDine + adminGuestDine,
    totalDebt,
    paidDebt,
    unpaidDebts: [],
    votes,
    shuttlecocks: session.shuttlecocks,
    debtMap,
    attendees: [],
    voteDeadline: session.voteDeadline ?? null,
    maxPlayers: session.maxPlayers ?? 16,
  };

  return (
    <div className="space-y-3 pb-28">
      {/* Điều hướng trang — back về danh sách (grid card không có, detail cần). */}
      <div className="flex items-center">
        <Link href="/admin/sessions">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Thẻ buổi — dùng CHUNG với grid. Detail: members luôn mở
          (membersCollapsible=false) → SessionCostStats + AdminVoteManager giống
          hệt layout grid. Selector fire optimistic mirror (localCourtPrice /
          localShuttlecocks) qua onCourtChange/onItemsChange để cost cập nhật ngay. */}
      <AdminSessionCard
        session={cardSession}
        effectiveStatus={effectiveStatus}
        isPastPending={badge.isPastPending}
        badge={badge}
        courts={courts}
        brands={brands}
        members={members}
        memberBalances={memberBalances}
        defaultCourtId={defaultCourtId}
        sessionDays={sessionDays}
        adminMemberId={null}
        adminGuestPlay={adminGuestPlay}
        adminGuestDine={adminGuestDine}
        costCourtPrice={localCourtPrice}
        costCourtName={localCourtName}
        costShuttlecocks={localShuttlecocks ?? []}
        onCourtChange={handleCourtChange}
        onItemsChange={setLocalShuttlecocks}
        paidDebtIds={new Set()}
        onCancel={() => setShowCancelDialog(true)}
        membersCollapsible={false}
      />

      {/* Action Button — sticky bottom: only cancel */}
      {isActive && (
        <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-4 backdrop-blur lg:left-60">
          <Button
            variant="destructive"
            size="lg"
            onClick={() => setShowCancelDialog(true)}
            className="h-13 w-full rounded-xl text-base"
          >
            <XCircle className="mr-2 h-5 w-5" />
            {t("cancelSession")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        title={t("cancelSession")}
        description={t("cancelConfirm")}
        onConfirm={handleCancelConfirm}
      />
    </div>
  );
}
