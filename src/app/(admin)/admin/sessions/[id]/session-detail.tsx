"use client";

import { useState } from "react";
import Link from "next/link";
import { confirmSession, cancelSession } from "@/actions/sessions";
import { formatVND } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { VoteList } from "@/components/sessions/vote-list";
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

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  voting: { label: "Dang vote", variant: "outline" },
  confirmed: { label: "Da xac nhan", variant: "default" },
  completed: { label: "Hoan thanh", variant: "secondary" },
  cancelled: { label: "Da huy", variant: "destructive" },
};

export function SessionDetail({
  session,
  votes,
  courts,
  brands,
  members,
}: {
  session: Session;
  votes: Vote[];
  courts: Court[];
  brands: Brand[];
  members: Member[];
}) {
  const [actionError, setActionError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
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

  async function handleCancel() {
    if (!confirm("Ban co chac muon huy buoi choi nay?")) return;
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
          <Badge variant={status.variant} className="mt-1">
            {status.label}
          </Badge>
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
          {session.court && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>{session.court.name}</span>
              {session.courtPrice != null && (
                <span className="text-primary font-medium">
                  ({formatVND(session.courtPrice)})
                </span>
              )}
            </div>
          )}
          <div className="flex gap-4 text-sm pt-2 border-t">
            <span>Choi: <strong>{playingCount}</strong> + {totalGuestPlay} khach</span>
            <span>An: <strong>{diningCount}</strong> + {totalGuestDine} khach</span>
          </div>
        </CardContent>
      </Card>

      {/* Court Selector (only for voting status) */}
      {(session.status === "voting" || session.status === "confirmed") && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">Chon san</h2>
            <CourtSelector
              sessionId={session.id}
              courts={courts}
              currentCourtId={session.courtId}
            />
          </CardContent>
        </Card>
      )}

      {/* Shuttlecock Selector (only for voting/confirmed status) */}
      {(session.status === "voting" || session.status === "confirmed") && (
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">Cau long su dung</h2>
            <ShuttlecockSelector
              sessionId={session.id}
              brands={brands}
              currentShuttlecocks={session.shuttlecocks}
            />
          </CardContent>
        </Card>
      )}

      {/* Vote List */}
      <Card>
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3">
            Danh sach vote ({votes.length}/{members.length})
          </h2>
          <VoteList votes={votes} members={members} />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      {(session.status === "voting" || session.status === "confirmed") && (
        <div className="flex gap-3">
          {session.status === "voting" && (
            <Button
              onClick={handleConfirm}
              disabled={isLoading}
              className="flex-1"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Xac nhan buoi choi
            </Button>
          )}
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={isLoading}
          >
            <XCircle className="h-4 w-4 mr-2" />
            Huy
          </Button>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      {/* Cancelled / Completed notice */}
      {session.status === "cancelled" && (
        <div className="text-center py-4 text-muted-foreground">
          Buoi choi nay da bi huy
        </div>
      )}
      {session.status === "completed" && (
        <div className="text-center py-4 text-muted-foreground">
          Buoi choi nay da hoan thanh
        </div>
      )}
    </div>
  );
}
