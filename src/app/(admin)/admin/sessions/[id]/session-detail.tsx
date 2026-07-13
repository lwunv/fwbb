"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cancelSession } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import { WeekStrip } from "@/components/sessions/week-strip";
import { VoteCountdown } from "@/components/sessions/vote-countdown";
import { VoteDeadlineEdit } from "@/components/sessions/vote-deadline-edit";
import { MaxPlayersToggle } from "@/components/sessions/max-players-toggle";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LedBorder } from "@/components/shared/led-border";
import { usePolling } from "@/lib/use-polling";
import {
  ArrowLeft,
  XCircle,
  Calendar,
  Clock,
  MapPin,
  Navigation,
  X,
} from "lucide-react";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import { deriveSessionBadge } from "@/lib/session-status";
import { StatusBadge } from "@/components/shared/status-badge";
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
  // tắt chi phí trong AdminVoteManager (Tổng chi / per-head / trừ dự kiến từng
  // member) đọc props này → nâng lên state để recompute NGAY, không chờ
  // revalidate. Nguồn optimistic vẫn là 2 selector (chúng giữ fireAction +
  // rollback); ở đây chỉ mirror giá trị hiệu lực chúng báo lên.
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
  const tF = useTranslations("finance");
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

  // Shared badge derivation (session-card/list dùng chung). Past-pending →
  // amber "needsConfirm" (trước đây detail giữ màu voting — nay đồng nhất).
  const sessionBadge = deriveSessionBadge(localStatus, session.date, ymdInVN());

  // Mirror grid card: buổi đang vote/xác nhận thì hiện selector + deadline; LED
  // pink chỉ giữ cho buổi active CHƯA quá hạn (past-pending → amber, không LED).
  const isActive = localStatus === "voting" || localStatus === "confirmed";
  const showLed = isActive && !sessionBadge.isPastPending;

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

      {/* Thẻ buổi — mirror grid card: 1 Card gộp ngày/giờ + dãy thứ + địa điểm
          + selector + deadline, trạng thái & nút huỷ ABSOLUTE góc phải trên. */}
      <LedBorder active={showLed} variant="pink">
        <Card className="relative">
          <CardContent className="space-y-2 p-4">
            {/* Trạng thái + huỷ: ABSOLUTE góc phải trên → không chiếm hàng
                riêng. Header chừa pr-28 để ngày/giờ không chạy dưới badge. */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              <StatusBadge variant={sessionBadge.variant}>
                {sessionBadge.isPastPending
                  ? tF("needsConfirm")
                  : t(sessionBadge.labelKey)}
              </StatusBadge>
              {isActive && (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  onClick={() => setShowCancelDialog(true)}
                  aria-label={t("ariaCancelSession")}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Hàng ngày + giờ (mirror grid). */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pr-28">
              <p className="flex items-center gap-2 text-base font-bold capitalize">
                <Calendar className="text-muted-foreground h-5 w-5 shrink-0" />
                {formatSessionDate(session.date)}
              </p>
              {(session.startTime || session.endTime) && (
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums">
                  <Clock className="h-4 w-4" />
                  {session.startTime ?? "—"} – {session.endTime ?? "—"}
                </span>
              )}
            </div>

            {/* Dãy thứ — FULL WIDTH (7 ô chia đều 1 hàng). */}
            <WeekStrip sessionDate={session.date} className="w-full" />

            {/* Địa điểm — full width, "Chỉ đường" sát lề phải. */}
            {session.court?.name && (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {session.court.name}
                </span>
                {session.court.mapLink && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(session.court!.mapLink!, "_blank");
                    }}
                    className="text-primary ml-auto inline-flex shrink-0 items-center gap-1"
                  >
                    <Navigation className="h-4 w-4" />
                    {t("directions")}
                  </span>
                )}
              </p>
            )}

            {/* Court + Shuttlecock selectors + deadline — chỉ hiện cho buổi
                đang vote/xác nhận (mirror grid, cùng 1 Card). */}
            {isActive && (
              <div className="space-y-2">
                <CourtSelector
                  sessionId={session.id}
                  courts={courts}
                  currentCourtId={session.courtId}
                  currentCourtQuantity={session.courtQuantity ?? 1}
                  currentCourtPrice={session.courtPrice ?? null}
                  isCourtPriceOverridden={session.courtPriceOverridden ?? false}
                  sessionDate={session.date}
                  defaultCourtId={defaultCourtId}
                  sessionDays={sessionDays}
                  onCourtChange={handleCourtChange}
                />
                <ShuttlecockSelector
                  sessionId={session.id}
                  brands={brands}
                  currentShuttlecocks={session.shuttlecocks}
                  onItemsChange={setLocalShuttlecocks}
                />
                <div className="flex flex-nowrap items-center gap-1.5 pt-1">
                  <span className="min-w-0 flex-1 truncate">
                    <VoteCountdown
                      deadline={session.voteDeadline}
                      variant="inline"
                    />
                  </span>
                  <VoteDeadlineEdit
                    sessionId={session.id}
                    current={session.voteDeadline}
                  />
                  <MaxPlayersToggle
                    sessionId={session.id}
                    current={session.maxPlayers}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </LedBorder>

      {/* Admin Vote Manager — add/remove members from play/dine */}
      <AdminVoteManager
        sessionId={session.id}
        votes={votes}
        members={members}
        debtMap={debtMap}
        readOnly={localStatus === "completed" || localStatus === "cancelled"}
        adminGuestPlayCount={session.adminGuestPlayCount ?? 0}
        adminGuestDineCount={session.adminGuestDineCount ?? 0}
        minDeductionEnabled={session.useMinDeduction ?? false}
        exemptMemberIds={exemptMemberIds}
        memberBalances={memberBalances}
        sessionCosts={{
          courtPrice: localCourtPrice,
          courtName: localCourtName,
          diningBill: session.diningBill ?? 0,
          shuttlecocks: (localShuttlecocks ?? []).map((s) => ({
            brandName: s.brand?.name ?? "",
            quantity: s.quantityUsed,
            pricePerTube: s.pricePerTube,
          })),
          startTime: session.startTime ?? "20:30",
          endTime: session.endTime ?? "22:30",
          isCompleted: localStatus === "completed",
        }}
      />

      {/* Action Button — sticky bottom: only cancel */}
      {(localStatus === "voting" || localStatus === "confirmed") && (
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
