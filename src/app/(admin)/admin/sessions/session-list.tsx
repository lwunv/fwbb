"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createSessionManually, deleteSession } from "@/actions/sessions";
import { formatVND } from "@/lib/utils";
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
import { Plus, Calendar, MapPin, ChevronDown, Trash2, Navigation, AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { format } from "date-fns";
import { vi } from "date-fns/locale";

interface UnpaidDebt {
  memberId: number;
  memberName: string;
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
  totalDebt: number;
  paidDebt: number;
  unpaidDebts: UnpaidDebt[];
  shuttlecockInfo: ShuttlecockInfo[];
}

const statusStyles: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; cardBg: string; badgeBg: string; badgeText: string; iconBg: string }> = {
  voting: { labelKey: "voting", cardBg: "bg-green-50/60 border-green-200/50 dark:bg-green-950/20 dark:border-green-900/30", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300", iconBg: "bg-green-100 dark:bg-green-900/40" },
  confirmed: { labelKey: "confirmed", cardBg: "bg-green-50/60 border-green-200/50 dark:bg-green-950/20 dark:border-green-900/30", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300", iconBg: "bg-green-100 dark:bg-green-900/40" },
  completed: { labelKey: "completed", cardBg: "bg-blue-50/60 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-900/30", badgeBg: "bg-blue-100 dark:bg-blue-900/40", badgeText: "text-blue-700 dark:text-blue-300", iconBg: "bg-blue-100 dark:bg-blue-900/40" },
  cancelled: { labelKey: "cancelled", cardBg: "bg-red-50/60 border-red-200/50 dark:bg-red-950/20 dark:border-red-900/30", badgeBg: "bg-red-100 dark:bg-red-900/40", badgeText: "text-red-700 dark:text-red-300", iconBg: "bg-red-100 dark:bg-red-900/40" },
};

export function SessionList({ sessions }: { sessions: SessionCard[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const t = useTranslations("sessions");
  const tCommon = useTranslations("common");
  const tVoting = useTranslations("voting");

  async function handleCreate(formData: FormData) {
    const date = formData.get("date") as string;
    if (!date) { setError(t("pleaseSelectDate")); return; }
    const result = await createSessionManually(date);
    if (result.error) { setError(result.error); return; }
    setDialogOpen(false);
    setError("");
  }

  function handleDeleteClick(e: React.MouseEvent, sessionId: number) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteTarget(sessionId);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(deleteTarget);
    await deleteSession(deleteTarget);
    setDeleting(null);
    setDeleteTarget(null);
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
              <Input id="date" name="date" type="date" required />
            </div>
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
                <Card className={`hover:opacity-90 transition-all cursor-pointer ${status.cardBg}`}>
                  <CardContent className="p-4 space-y-2">
                    {/* Row 1: Date + Status + Actions */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${status.iconBg}`}>
                          <Calendar className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold capitalize text-sm">
                            {formatSessionDate(session.date)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span>{session.startTime} - {session.endTime}</span>
                            {session.courtName && (
                              <>
                                <span>·</span>
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {session.courtName}
                                  {session.courtMapLink && (
                                    <a
                                      href={session.courtMapLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-primary hover:underline"
                                    >
                                      <Navigation className="h-2.5 w-2.5 inline mr-0.5" /> Chỉ đường
                                    </a>
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${status.badgeBg} ${status.badgeText}`}>
                          {t(status.labelKey)}
                        </span>
                        <button
                          onClick={(e) => handleDeleteClick(e, session.id)}
                          disabled={deleting === session.id}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Row 2: Players + Diners + Shuttlecocks */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pl-12">
                      <span>🏸 {tVoting("badmintonShort")}: <strong>{session.playerCount}</strong> người</span>
                      <span>🍻 {tVoting("diningShort")}: <strong>{session.dinerCount}</strong> người</span>
                      {session.shuttlecockInfo.length > 0 && (
                        <span className="text-muted-foreground">
                          🪶 {session.shuttlecockInfo.map((s) => `${s.quantity} quả ${s.brandName}`).join(", ")}
                        </span>
                      )}
                    </div>

                    {/* Row 3: Payment status (completed sessions only) */}
                    {session.status === "completed" && (
                      <div className="pl-12">
                        {allPaid ? (
                          <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                            ✓ Đã thanh toán hết — {formatVND(session.totalDebt)}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setExpandedId(isExpanded ? null : session.id);
                              }}
                              className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium hover:underline"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Còn thiếu {formatVND(unpaidAmount)} / {formatVND(session.totalDebt)}
                              <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>

              {/* Expandable unpaid debts list */}
              {isExpanded && session.unpaidDebts.length > 0 && (
                <div className="ml-12 mt-1 mb-2 border rounded-md bg-card divide-y">
                  {session.unpaidDebts.map((d) => (
                    <div key={d.memberId} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <MemberAvatar memberId={d.memberId} size={20} />
                        <span>{d.memberName}</span>
                      </div>
                      <span className="font-medium text-destructive">{formatVND(d.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {sessions.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {t("noSessions")}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("deleteSessionTitle")}
        description={t("deleteSessionDesc")}
        onConfirm={handleDeleteConfirm}
        loading={deleting !== null}
      />
    </div>
  );
}
