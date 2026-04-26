"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cancelSession } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { usePolling } from "@/lib/use-polling";
import { ArrowLeft, XCircle } from "lucide-react";
import { formatSessionDate } from "@/lib/date-format";
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
  member: InferSelectModel<typeof membersTable>;
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
}) {
  const [localStatus, setLocalStatus] = useState(session.status);
  const t = useTranslations("sessions");
  usePolling();

  // Sync localStatus when server prop changes (after revalidation)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- local optimistic state must resync after server revalidation.
    setLocalStatus(session.status);
  }, [session.status]);

  type SessionStatus = "voting" | "confirmed" | "completed" | "cancelled";
  const statusKey = (
    ["voting", "confirmed", "completed", "cancelled"].includes(
      localStatus ?? "",
    )
      ? localStatus
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

  return (
    <div className="space-y-3">
      {/* Header — date + status on same line */}
      <div className="flex items-center gap-2">
        <Link href="/admin/sessions">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-base font-bold capitalize">
            {formatSessionDate(session.date, "weekdayLong")}
            {(session.startTime || session.endTime) && (
              <span className="text-muted-foreground text-sm font-medium whitespace-nowrap">
                ⏰ {session.startTime ?? "—"} – {session.endTime ?? "—"}
              </span>
            )}
          </h1>
        </div>
        <StatusBadge variant={statusKey}>{t(statusKey)}</StatusBadge>
      </div>

      {/* Court Selector (only for voting status) */}
      {(localStatus === "voting" || localStatus === "confirmed") && (
        <Card>
          <CardContent className="p-4">
            <CourtSelector
              sessionId={session.id}
              courts={courts}
              currentCourtId={session.courtId}
              currentCourtQuantity={session.courtQuantity ?? 1}
            />
          </CardContent>
        </Card>
      )}

      {/* Shuttlecock Selector (only for voting/confirmed status) */}
      {(localStatus === "voting" || localStatus === "confirmed") && (
        <Card>
          <CardContent className="p-4">
            <ShuttlecockSelector
              sessionId={session.id}
              brands={brands}
              currentShuttlecocks={session.shuttlecocks}
            />
          </CardContent>
        </Card>
      )}

      {/* Admin Vote Manager — add/remove members from play/dine */}
      <AdminVoteManager
        sessionId={session.id}
        votes={votes}
        members={members}
        debtMap={debtMap}
        readOnly={localStatus === "completed" || localStatus === "cancelled"}
        sessionCosts={{
          courtPrice: session.courtPrice ?? 0,
          courtName: session.court?.name ?? null,
          diningBill: session.diningBill ?? 0,
          shuttlecocks: (session.shuttlecocks ?? []).map((s) => ({
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
