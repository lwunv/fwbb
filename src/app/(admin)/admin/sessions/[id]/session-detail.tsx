"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { confirmSession, cancelSession } from "@/actions/sessions";
import { formatK } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { VoteList } from "@/components/sessions/vote-list";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ArrowLeft, Calendar, Clock, MapPin, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
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
  debtMap?: Record<number, { amount: number; adminConfirmed: boolean; debtId: number }>;
}) {
  const [actionError, setActionError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const t = useTranslations("sessions");
  const tDetail = useTranslations("sessionDetail");
  const tCommon = useTranslations("common");

  const statusConfig: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; badgeBg: string; badgeText: string }> = {
    voting: { labelKey: "voting", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300" },
    confirmed: { labelKey: "confirmed", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300" },
    completed: { labelKey: "completed", badgeBg: "bg-blue-100 dark:bg-blue-900/40", badgeText: "text-blue-700 dark:text-blue-300" },
    cancelled: { labelKey: "cancelled", badgeBg: "bg-red-100 dark:bg-red-900/40", badgeText: "text-red-700 dark:text-red-300" },
  };

  const status = statusConfig[session.status ?? "voting"];

  function formatSessionDate(dateStr: string) {
    try {
      const date = new Date(dateStr + "T00:00:00");
      return format(date, "EEEE, dd/MM/yyyy", { locale: vi });
    } catch {
      return dateStr;
    }
  }

  async function handleConfirm() {
    setIsLoading(true);
    setActionError("");
    const result = await confirmSession(session.id);
    if (result.error) {
      setActionError(result.error);
    }
    setIsLoading(false);
  }

  const [showCancelDialog, setShowCancelDialog] = useState(false);

  async function handleCancelConfirm() {
    setIsLoading(true);
    setActionError("");
    const result = await cancelSession(session.id);
    if (result.error) {
      setActionError(result.error);
    }
    setIsLoading(false);
  }

  const playingCount = votes.filter((v) => v.willPlay).length;
  const diningCount = votes.filter((v) => v.willDine).length;
  const totalGuestPlay = votes.reduce((sum, v) => sum + (v.guestPlayCount ?? 0), 0);
  const totalGuestDine = votes.reduce((sum, v) => sum + (v.guestDineCount ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/sessions">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold capitalize">
            {formatSessionDate(session.date)}
          </h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium mt-1 ${status.badgeBg} ${status.badgeText}`}>
            {t(status.labelKey)}
          </span>
        </div>
      </div>

      {/* Session Info Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="capitalize">{formatSessionDate(session.date)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>{session.startTime} - {session.endTime}</span>
          </div>
          <div className="flex gap-4 text-sm pt-2 border-t">
            <span>{tDetail("play")}: <strong>{playingCount}</strong> người{totalGuestPlay > 0 && <span className="text-muted-foreground"> +{totalGuestPlay} {tDetail("guest")}</span>}</span>
            <span>{tDetail("dine")}: <strong>{diningCount}</strong> người{totalGuestDine > 0 && <span className="text-muted-foreground"> +{totalGuestDine} {tDetail("guest")}</span>}</span>
          </div>

          {/* Financial summary for completed sessions */}
          {session.status === "completed" && (
            <div className="pt-2 border-t space-y-1.5">
              {session.shuttlecocks && session.shuttlecocks.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">🪶 Cầu</span>
                  <span className="font-medium">
                    {session.shuttlecocks.map((s) => `${s.quantityUsed} quả ${s.brand?.name ?? ""}`).join(", ")}
                    {" · "}
                    {formatK(session.shuttlecocks.reduce((sum, s) => sum + Math.round(s.quantityUsed * s.pricePerTube / 12), 0))}
                  </span>
                </div>
              )}
              {session.courtPrice != null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">🏟 {session.court?.name ?? "Sân"}</span>
                  <span className="font-medium">{formatK(session.courtPrice)}</span>
                </div>
              )}
              {session.diningBill != null && session.diningBill > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">🍻 Nhậu</span>
                  <span className="font-medium">{formatK(session.diningBill)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm pt-1 border-t font-bold">
                <span>Tổng chi</span>
                <span className="text-primary">
                  {formatK(
                    (session.courtPrice ?? 0) +
                    (session.diningBill ?? 0) +
                    (session.shuttlecocks?.reduce((sum, s) => sum + Math.round(s.quantityUsed * s.pricePerTube / 12), 0) ?? 0)
                  )}
                </span>
              </div>
              {playingCount > 0 && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Chơi cầu/người: <strong className="text-foreground">
                    {formatK(Math.round(((session.courtPrice ?? 0) + (session.shuttlecocks?.reduce((sum, s) => sum + Math.round(s.quantityUsed * s.pricePerTube / 12), 0) ?? 0)) / playingCount / 1000) * 1000)}
                  </strong></span>
                  {diningCount > 0 && session.diningBill != null && (
                    <span>Nhậu/người: <strong className="text-foreground">
                      {formatK(Math.round(session.diningBill / diningCount / 1000) * 1000)}
                    </strong></span>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Court Selector (only for voting status) */}
      {(session.status === "voting" || session.status === "confirmed") && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">{t("selectCourt")}</h2>
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
      {(session.status === "voting" || session.status === "confirmed") && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">{t("shuttlecockUsage")}</h2>
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
        readOnly={session.status === "completed" || session.status === "cancelled"}
      />

      {/* Action Buttons — sticky bottom */}
      {(session.status === "voting" || session.status === "confirmed") && (
        <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t p-3 -mx-4 md:-mx-6 flex gap-3">
          {session.status === "voting" && (
            <Button
              onClick={handleConfirm}
              disabled={isLoading}
              className="flex-1"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {tCommon("confirm")}
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={() => setShowCancelDialog(true)}
            disabled={isLoading}
          >
            <XCircle className="h-4 w-4 mr-2" />
            {t("cancelSession")}
          </Button>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      {/* Cancelled / Completed notice */}
      {session.status === "cancelled" && (
        <div className="text-center py-4 text-muted-foreground">
          {t("sessionCancelled")}
        </div>
      )}
      {session.status === "completed" && (
        <div className="text-center py-4 text-muted-foreground">
          {t("sessionCompleted")}
        </div>
      )}

      <ConfirmDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        title={t("cancelSession")}
        description={t("cancelConfirm")}
        onConfirm={handleCancelConfirm}
        loading={isLoading}
      />
    </div>
  );
}
