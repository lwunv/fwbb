"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createSessionManually, cancelSession } from "@/actions/sessions";
import { confirmPaymentByAdmin } from "@/actions/finance";
import { formatK } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Calendar, MapPin, ChevronDown, Navigation, AlertTriangle, X, Check } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { usePolling } from "@/lib/use-polling";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

interface UnpaidDebt {
  debtId: number;
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

interface ShuttlecockInfo {
  brandName: string;
  quantity: number;
}

interface SessionCard {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  courtName: string | null;
  courtMapLink: string | null;
  courtPrice: number | null;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
  totalDebt: number;
  paidDebt: number;
  unpaidDebts: UnpaidDebt[];
  shuttlecockInfo: ShuttlecockInfo[];
}

const statusStyles: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; cardBg: string; badgeBg: string; badgeText: string; iconBg: string }> = {
  voting: { labelKey: "voting", cardBg: "bg-green-50/60 border-2 dark:bg-green-950/20 animate-border-pulse", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300", iconBg: "bg-green-100 dark:bg-green-900/40" },
  confirmed: { labelKey: "confirmed", cardBg: "bg-green-50/60 border-green-200/50 dark:bg-green-950/20 dark:border-green-900/30", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300", iconBg: "bg-green-100 dark:bg-green-900/40" },
  completed: { labelKey: "completed", cardBg: "bg-blue-50/60 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-900/30", badgeBg: "bg-blue-100 dark:bg-blue-900/40", badgeText: "text-blue-700 dark:text-blue-300", iconBg: "bg-blue-100 dark:bg-blue-900/40" },
  cancelled: { labelKey: "cancelled", cardBg: "bg-red-50/60 border-red-200/50 dark:bg-red-950/20 dark:border-red-900/30", badgeBg: "bg-red-100 dark:bg-red-900/40", badgeText: "text-red-700 dark:text-red-300", iconBg: "bg-red-100 dark:bg-red-900/40" },
};

interface CourtOption {
  id: number;
  name: string;
}

function getNextMonOrFri() {
  const today = new Date();
  const day = today.getDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
  const daysToMon = ((1 - day) + 7) % 7 || 7;
  const daysToFri = ((5 - day) + 7) % 7 || 7;
  const daysAhead = Math.min(daysToMon, daysToFri);
  const next = new Date(today);
  next.setDate(today.getDate() + daysAhead);
  return next.toISOString().split("T")[0];
}

const DEFAULT_DATE = getNextMonOrFri();

export function SessionList({ sessions, courts = [] }: { sessions: SessionCard[]; courts?: CourtOption[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const t = useTranslations("sessions");
  const tCommon = useTranslations("common");
  const tF = useTranslations("finance");
  const tVoting = useTranslations("voting");
  usePolling();

  async function handleCreate(formData: FormData) {
    const date = formData.get("date") as string;
    if (!date) { setError(t("pleaseSelectDate")); return; }
    const startTime = formData.get("startTime") as string || undefined;
    const endTime = formData.get("endTime") as string || undefined;
    const courtIdRaw = formData.get("courtId") as string;
    const courtId = courtIdRaw ? Number(courtIdRaw) : undefined;
    const result = await createSessionManually(date, startTime, endTime, courtId);
    if (result.error) { setError(result.error); return; }
    setDialogOpen(false);
    setError("");
  }

  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setCancelling(cancelTarget);
    await cancelSession(cancelTarget);
    setCancelling(null);
    setCancelTarget(null);
  }

  function formatSessionDate(dateStr: string) {
    try {
      return format(new Date(dateStr + "T00:00:00"), "EEEE, dd/MM/yyyy", { locale: vi });
    } catch { return dateStr; }
  }

  return (
    <div className="pb-20">
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setError(""); }}>
        {/* Sticky bottom button on mobile */}
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 z-30 p-3 bg-background/95 backdrop-blur border-t">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="h-4 w-4 mr-2" /> {t("createSession")}
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createSessionTitle")}</DialogTitle>
          </DialogHeader>
          <form action={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="date">{t("date")}</Label>
              <Input id="date" name="date" type="date" defaultValue={DEFAULT_DATE} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="startTime">{t("startTime")}</Label>
                <Input id="startTime" name="startTime" type="time" defaultValue="20:30" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">{t("endTime")}</Label>
                <Input id="endTime" name="endTime" type="time" defaultValue="22:30" />
              </div>
            </div>
            {courts.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="courtId">{t("court")}</Label>
                <select
                  id="courtId"
                  name="courtId"
                  defaultValue=""
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">{t("noCourt")}</option>
                  {courts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">{t("create")}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {sessions.map((session) => {
          const status = statusStyles[session.status ?? "voting"];
          const unpaidAmount = session.totalDebt - session.paidDebt;
          const allPaid = session.status === "completed" && unpaidAmount <= 0;
          const isExpanded = expandedId === session.id;

          return (
            <div key={session.id}>
              <Link href={`/admin/sessions/${session.id}`}>
                <Card className={`hover:opacity-90 transition-all cursor-pointer !py-0 ${status.cardBg}`}>
                  <CardContent className="p-4 space-y-2">
                    {/* Row 1: Date + Status + Cancel */}
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold capitalize text-sm flex items-center gap-1.5">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {formatSessionDate(session.date)}
                        </p>
                        {(session.startTime || session.endTime) && (
                          <p className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">
                            {session.startTime ?? "—"} - {session.endTime ?? "—"}
                          </p>
                        )}
                        {session.courtName && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex flex-nowrap items-center gap-1.5 min-w-0">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{session.courtName}</span>
                            {session.courtMapLink && (
                              <span
                                role="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(session.courtMapLink!, "_blank"); }}
                                className="text-primary shrink-0 inline-flex items-center gap-0.5"
                              >
                                <Navigation className="h-2.5 w-2.5" />
                                Chỉ đường
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${status.badgeBg} ${status.badgeText}`}>
                        {t(status.labelKey)}
                      </span>
                    </div>
                    {/* Row 2: Players + Diners + Shuttlecocks + Cancel */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="text-primary">
                        🏸 {tVoting("badmintonShort")}: <strong>{session.playerCount + session.guestPlayCount}</strong>{" "}
                        {t("people")}
                        {session.guestPlayCount > 0 && (
                          <span className="tabular-nums">
                            {" "}
                            ({session.guestPlayCount} {t("guest")})
                          </span>
                        )}
                      </span>
                      <span className="text-orange-500 dark:text-orange-400">
                        🍻 {tVoting("diningShort")}: <strong>{session.dinerCount + session.guestDineCount}</strong>{" "}
                        {t("people")}
                        {session.guestDineCount > 0 && (
                          <span className="tabular-nums">
                            {" "}
                            ({session.guestDineCount} {t("guest")})
                          </span>
                        )}
                      </span>
                      {session.shuttlecockInfo.length > 0 && (
                        <span>
                          🏸 {session.shuttlecockInfo.map((s, i) => <span key={i}>{i > 0 && ", "}<strong>{s.quantity}</strong> quả {s.brandName}</span>)}
                        </span>
                      )}
                      {/* Cancel button - voting/confirmed sessions */}
                      {session.status !== "cancelled" && session.status !== "completed" && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCancelTarget(session.id);
                          }}
                          className="ml-auto inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                          {t("cancelSession")}
                        </button>
                      )}
                      {/* Payment status - completed sessions, same row aligned right */}
                      {session.status === "completed" && (
                        allPaid ? (
                          <span className="ml-auto text-xs text-green-600 dark:text-green-400 font-medium">
                            ✓ Đã thanh toán hết — {formatK(session.totalDebt)}
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : session.id);
                            }}
                            className="ml-auto inline-flex items-center gap-1.5 text-xs py-1 text-amber-600 dark:text-amber-400 font-medium"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Còn thiếu {formatK(unpaidAmount)} / {formatK(session.totalDebt)}
                            <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </button>
                        )
                      )}
                    </div>
                    {/* Expandable unpaid debts list */}
                    {isExpanded && session.unpaidDebts.length > 0 && (
                      <div className="divide-y">
                        {session.unpaidDebts.map((d) => (
                          <div key={d.memberId} className="flex items-center justify-between pb-1.5 mt-1.5 text-xs">
                            <div className="flex items-center gap-2">
                              <MemberAvatar memberId={d.memberId} avatarKey={d.memberAvatarKey} avatarUrl={d.memberAvatarUrl} size={20} />
                              <span>{d.memberName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-destructive">{formatK(d.amount)}</span>
                              <form action={async () => { await confirmPaymentByAdmin(d.debtId); }} onClick={(e) => e.stopPropagation()}>
                                <Button type="submit" size="sm" variant="outline" className="h-6 text-[11px] gap-1 px-2 border-green-500/40 text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30">
                                  <Check className="h-3 w-3" />
                                  {tF("received")}
                                </Button>
                              </form>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </div>
          );
        })}

        {sessions.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {t("noSessions")}
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title={t("cancelSession")}
        description={t("cancelConfirm")}
        onConfirm={handleCancelConfirm}
        loading={cancelling !== null}
      />
    </div>
  );
}
