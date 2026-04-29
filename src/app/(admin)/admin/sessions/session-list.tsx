"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  createSessionManually,
  cancelSession,
  setAdminGuestCount,
} from "@/actions/sessions";
import { confirmPaymentByAdmin } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { NumberStepper } from "@/components/ui/number-stepper";
import { CourtSelector } from "@/components/sessions/court-selector";
import { ShuttlecockSelector } from "@/components/sessions/shuttlecock-selector";
import { AdminVoteManager } from "@/components/sessions/admin-vote-manager";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  Plus,
  Calendar,
  MapPin,
  ChevronDown,
  Navigation,
  AlertTriangle,
  X,
  Check,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { usePolling } from "@/lib/use-polling";
import {
  formatSessionDate as fmtSessionDate,
  getNextSessionDay,
} from "@/lib/date-format";
import type { InferSelectModel } from "drizzle-orm";
import type {
  votes as votesTable,
  members as membersTable,
  courts as courtsTable,
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: InferSelectModel<typeof membersTable>;
};
type Court = InferSelectModel<typeof courtsTable>;
type Brand = InferSelectModel<typeof brandsTable>;
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: Brand;
};
type Member = InferSelectModel<typeof membersTable>;

interface UnpaidDebt {
  debtId: number;
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

interface SessionCard {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  courtId: number | null;
  courtQuantity: number;
  courtName: string | null;
  courtMapLink: string | null;
  courtPrice: number | null;
  diningBill: number;
  adminGuestPlayCount: number;
  adminGuestDineCount: number;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
  totalDebt: number;
  paidDebt: number;
  unpaidDebts: UnpaidDebt[];
  shuttlecockInfo: { brandName: string; quantity: number }[];
  votes: Vote[];
  shuttlecocks: SessionShuttlecock[];
  debtMap: Record<
    number,
    { amount: number; adminConfirmed: boolean; debtId: number }
  >;
}

type SessionStatus = "voting" | "confirmed" | "completed" | "cancelled";

const statusStyles: Record<
  SessionStatus,
  { labelKey: SessionStatus; cardBg: string }
> = {
  voting: {
    labelKey: "voting",
    cardBg: "bg-green-50/60 border-2 dark:bg-green-950/20 animate-border-pulse",
  },
  confirmed: {
    labelKey: "confirmed",
    cardBg:
      "bg-green-50/60 border-green-200/50 dark:bg-green-950/20 dark:border-green-900/30",
  },
  completed: {
    labelKey: "completed",
    cardBg:
      "bg-blue-50/60 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-900/30",
  },
  cancelled: {
    labelKey: "cancelled",
    cardBg:
      "bg-red-50/60 border-red-200/50 dark:bg-red-950/20 dark:border-red-900/30",
  },
};

const DEFAULT_DATE = getNextSessionDay().toISOString().split("T")[0];

export function SessionList({
  sessions,
  courts = [],
  members = [],
  brands = [],
}: {
  sessions: SessionCard[];
  courts?: Court[];
  members?: Member[];
  brands?: Brand[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [cancelledSessions, setCancelledSessions] = useState<Set<number>>(
    new Set(),
  );
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [cancelPassed, setCancelPassed] = useState(true);
  const [cancelPassRevenue, setCancelPassRevenue] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [localAdminGuests, setLocalAdminGuests] = useState<
    Record<number, { play: number; dine: number }>
  >({});
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const t = useTranslations("sessions");
  const tF = useTranslations("finance");
  const tVoting = useTranslations("voting");
  const tFundAdmin = useTranslations("fundAdmin");
  usePolling();

  function handleCreate(formData: FormData) {
    const date = formData.get("date") as string;
    if (!date) {
      setError(t("pleaseSelectDate"));
      return;
    }
    const startTime = (formData.get("startTime") as string) || undefined;
    const endTime = (formData.get("endTime") as string) || undefined;
    const courtIdRaw = formData.get("courtId") as string;
    const courtId = courtIdRaw ? Number(courtIdRaw) : undefined;
    setDialogOpen(false);
    setError("");
    fireAction(
      () => createSessionManually(date, startTime, endTime, courtId),
      () => {
        setDialogOpen(true);
        setError(t("createFailed") ?? "Failed");
      },
    );
  }

  function handleCancelConfirm() {
    if (!cancelTarget) return;
    const id = cancelTarget;
    const passed = cancelPassed;
    const passRevenue = passed
      ? Math.max(0, parseInt(cancelPassRevenue, 10) || 0)
      : 0;
    setCancelledSessions((prev) => new Set(prev).add(id));
    setCancelTarget(null);
    fireAction(
      () => cancelSession(id, { passed, passRevenue }),
      () =>
        setCancelledSessions((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
    );
  }

  function getAdminGuests(sessionId: number, session: SessionCard) {
    return (
      localAdminGuests[sessionId] ?? {
        play: session.adminGuestPlayCount,
        dine: session.adminGuestDineCount,
      }
    );
  }

  function handleAdminGuestChange(
    sessionId: number,
    session: SessionCard,
    field: "play" | "dine",
    value: number,
  ) {
    const current = getAdminGuests(sessionId, session);
    const prev = { ...current };
    const next = { ...current, [field]: value };
    setLocalAdminGuests((s) => ({ ...s, [sessionId]: next }));
    fireAction(
      () => setAdminGuestCount(sessionId, next.play, next.dine),
      () => setLocalAdminGuests((s) => ({ ...s, [sessionId]: prev })),
    );
  }

  function formatSessionDate(dateStr: string) {
    return fmtSessionDate(dateStr, "weekdayLong");
  }

  function toggleExpand(e: React.MouseEvent, sessionId: number) {
    e.preventDefault();
    e.stopPropagation();
    setExpandedId(expandedId === sessionId ? null : sessionId);
  }

  return (
    <div className="pb-24">
      {/* pb-24 chừa chỗ cho thanh "Tạo buổi chơi" sticky ở bottom — nếu không
          row cuối của expanded session sẽ bị nó che mất. */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setError("");
        }}
      >
        <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="mr-2 h-4 w-4" /> {t("createSession")}
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createSessionTitle")}</DialogTitle>
          </DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="date">{t("date")}</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={DEFAULT_DATE}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="startTime">{t("startTime")}</Label>
                <Input
                  id="startTime"
                  name="startTime"
                  type="time"
                  defaultValue="20:30"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">{t("endTime")}</Label>
                <Input
                  id="endTime"
                  name="endTime"
                  type="time"
                  defaultValue="22:30"
                />
              </div>
            </div>
            {courts.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="courtId">{t("court")}</Label>
                <CustomSelect
                  value={selectedCourtId}
                  onChange={setSelectedCourtId}
                  name="courtId"
                  placeholder={t("noCourt")}
                  options={courts.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                />
              </div>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button type="submit" className="w-full">
              {t("create")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {sessions.map((session) => {
          const rawStatus = cancelledSessions.has(session.id)
            ? "cancelled"
            : (session.status ?? "voting");
          const effectiveStatus: SessionStatus = (
            ["voting", "confirmed", "completed", "cancelled"].includes(
              rawStatus,
            )
              ? rawStatus
              : "voting"
          ) as SessionStatus;
          const status = statusStyles[effectiveStatus];
          const unpaidAmount = session.totalDebt - session.paidDebt;
          const allPaid = effectiveStatus === "completed" && unpaidAmount <= 0;
          const isExpanded = expandedId === session.id;
          const isActive =
            effectiveStatus === "voting" || effectiveStatus === "confirmed";
          const ag = getAdminGuests(session.id, session);
          const totalGuestPlay =
            session.guestPlayCount + ag.play - session.adminGuestPlayCount;
          const totalGuestDine =
            session.guestDineCount + ag.dine - session.adminGuestDineCount;

          return (
            <div key={session.id}>
              <Card className={`!py-0 transition-all ${status.cardBg}`}>
                <CardContent className="space-y-2 p-4">
                  {/* Header: Date + Status */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="flex items-center gap-2 text-base font-bold capitalize">
                        <Calendar className="text-muted-foreground h-5 w-5" />
                        {formatSessionDate(session.date)}
                      </p>
                      {(session.startTime || session.endTime) && (
                        <p className="text-muted-foreground mt-1 text-sm whitespace-nowrap">
                          ⏰ {session.startTime ?? "—"} –{" "}
                          {session.endTime ?? "—"}
                        </p>
                      )}
                      {session.courtName && (
                        <p className="text-muted-foreground mt-1 flex min-w-0 flex-nowrap items-center gap-2 text-sm">
                          <MapPin className="h-4 w-4 shrink-0" />
                          <span className="truncate">{session.courtName}</span>
                          {session.courtMapLink && (
                            <span
                              role="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                window.open(session.courtMapLink!, "_blank");
                              }}
                              className="text-primary inline-flex shrink-0 items-center gap-1"
                            >
                              <Navigation className="h-4 w-4" />
                              {t("directions")}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:inline-flex">
                        <StatusBadge variant={effectiveStatus}>
                          {t(status.labelKey)}
                        </StatusBadge>
                      </div>
                      {isActive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCancelTarget(session.id);
                            setCancelPassed(true);
                            setCancelPassRevenue(
                              String(session.courtPrice ?? 200000),
                            );
                          }}
                          className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expand button — full width, shows counts */}
                  {isActive && (
                    <button
                      onClick={(e) => toggleExpand(e, session.id)}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-base transition-colors ${
                        isExpanded
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/30"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-left">
                        <span className="text-primary">
                          🏸 {tVoting("badmintonShort")}:{" "}
                          <strong>
                            {session.playerCount + totalGuestPlay}
                          </strong>{" "}
                          {t("people")}
                          {totalGuestPlay > 0 && (
                            <span className="tabular-nums">
                              {" "}
                              ({totalGuestPlay} {t("guest")})
                            </span>
                          )}
                        </span>
                        <span className="text-orange-500 dark:text-orange-400">
                          🍻 {tVoting("diningShort")}:{" "}
                          <strong>{session.dinerCount + totalGuestDine}</strong>{" "}
                          {t("people")}
                          {totalGuestDine > 0 && (
                            <span className="tabular-nums">
                              {" "}
                              ({totalGuestDine} {t("guest")})
                            </span>
                          )}
                        </span>
                      </div>
                      <ChevronDown
                        className={`text-muted-foreground h-5 w-5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  )}

                  {/* Admin guest — khách của admin (luôn mở, không cần click) */}
                  {isActive &&
                    (() => {
                      const ag = getAdminGuests(session.id, session);
                      return (
                        <div
                          className="flex flex-wrap items-center gap-3 px-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-muted-foreground text-sm font-medium">
                            Khách:
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🏸</span>
                            <NumberStepper
                              value={ag.play}
                              onChange={(v) =>
                                handleAdminGuestChange(
                                  session.id,
                                  session,
                                  "play",
                                  v,
                                )
                              }
                              min={0}
                              max={10}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🍻</span>
                            <NumberStepper
                              value={ag.dine}
                              onChange={(v) =>
                                handleAdminGuestChange(
                                  session.id,
                                  session,
                                  "dine",
                                  v,
                                )
                              }
                              min={0}
                              max={10}
                            />
                          </div>
                        </div>
                      );
                    })()}

                  {/* Completed: counts (non-expandable) + payment status */}
                  {effectiveStatus === "completed" && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span className="text-primary">
                        🏸{" "}
                        <strong>
                          {session.playerCount + session.guestPlayCount}
                        </strong>{" "}
                        {t("people")}
                      </span>
                      <span className="text-orange-500 dark:text-orange-400">
                        🍻{" "}
                        <strong>
                          {session.dinerCount + session.guestDineCount}
                        </strong>{" "}
                        {t("people")}
                      </span>
                      {allPaid ? (
                        <span className="ml-auto text-sm font-medium text-green-600 dark:text-green-400">
                          ✓ {formatK(session.totalDebt)}
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            setExpandedId(isExpanded ? null : session.id)
                          }
                          className="ml-auto inline-flex items-center gap-2 py-1 text-sm font-medium text-amber-600 dark:text-amber-400"
                        >
                          <AlertTriangle className="h-4 w-4" />
                          {t("stillOwingAmount", {
                            amount: formatK(unpaidAmount),
                          })}
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}
                    </div>
                  )}

                  {effectiveStatus === "cancelled" && (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 text-sm">
                      <span>
                        🏸 {session.playerCount + session.guestPlayCount}{" "}
                        {t("people")}
                      </span>
                      <span>
                        🍻 {session.dinerCount + session.guestDineCount}{" "}
                        {t("people")}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Expanded: inline management for voting/confirmed sessions */}
              {isExpanded && isActive && (
                <div className="bg-background/50 space-y-3 rounded-b-xl border border-t-0 p-4">
                  <CourtSelector
                    sessionId={session.id}
                    courts={courts}
                    currentCourtId={session.courtId}
                    currentCourtQuantity={session.courtQuantity}
                  />
                  <ShuttlecockSelector
                    sessionId={session.id}
                    brands={brands}
                    currentShuttlecocks={session.shuttlecocks}
                  />
                  <AdminVoteManager
                    sessionId={session.id}
                    votes={session.votes}
                    members={members}
                    debtMap={session.debtMap}
                    readOnly={false}
                    sessionCosts={{
                      courtPrice: session.courtPrice ?? 0,
                      courtName: session.courtName,
                      diningBill: session.diningBill,
                      shuttlecocks: session.shuttlecocks.map((s) => ({
                        brandName: s.brand?.name ?? "",
                        quantity: s.quantityUsed,
                        pricePerTube: s.pricePerTube,
                      })),
                      startTime: session.startTime ?? "20:30",
                      endTime: session.endTime ?? "22:30",
                      isCompleted: false,
                    }}
                  />
                </div>
              )}

              {/* Expanded: unpaid debts for completed sessions */}
              {isExpanded &&
                effectiveStatus === "completed" &&
                session.unpaidDebts.length > 0 && (
                  <div className="bg-background/50 divide-y rounded-b-xl border border-t-0 p-4">
                    {session.unpaidDebts.map((d) => (
                      <div
                        key={d.memberId}
                        className="flex items-center justify-between py-2 text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <MemberAvatar
                            memberId={d.memberId}
                            avatarKey={d.memberAvatarKey}
                            avatarUrl={d.memberAvatarUrl}
                            size={28}
                          />
                          <span>{d.memberName}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-destructive font-medium">
                            {formatK(d.amount)}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 border-green-500/40 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30"
                            onClick={() =>
                              fireAction(() => confirmPaymentByAdmin(d.debtId))
                            }
                          >
                            <Check className="h-4 w-4" />
                            {tF("received")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          );
        })}

        {sessions.length === 0 && (
          <div className="text-muted-foreground py-12 text-center">
            {t("noSessions")}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title={t("cancelSession")}
        description={t("cancelConfirm")}
        onConfirm={handleCancelConfirm}
        confirmLabel={t("cancelSessionConfirmLabel")}
      >
        <div className="space-y-3">
          <label className="hover:bg-accent/40 flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors">
            <input
              type="checkbox"
              checked={cancelPassed}
              onChange={(e) => setCancelPassed(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Pass được sân</div>
              <div className="text-muted-foreground text-xs">
                Tick nếu admin đã thu được tiền từ team khác. Tiền sẽ tự động
                vào quỹ admin.
              </div>
            </div>
          </label>
          {cancelPassed && (
            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium">
                Số tiền nhận lại (VND)
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={cancelPassRevenue}
                onChange={(e) => setCancelPassRevenue(e.target.value)}
                min={0}
                step={10000}
                className="bg-background min-h-11 w-full rounded-xl border px-3 text-base"
                placeholder={tFundAdmin("passRevenuePlaceholder")}
              />
              <p className="text-muted-foreground text-xs">
                Mặc định = giá thuê sân của buổi. Có thể chỉnh nếu khác.
              </p>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
