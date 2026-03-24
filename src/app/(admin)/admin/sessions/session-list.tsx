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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Calendar, MapPin, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import type { InferSelectModel } from "drizzle-orm";
import type { sessions as sessionsTable, courts as courtsTable } from "@/db/schema";

type Session = InferSelectModel<typeof sessionsTable> & {
  court: InferSelectModel<typeof courtsTable> | null;
};

export function SessionList({ sessions }: { sessions: Session[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const t = useTranslations("sessions");
  const tCommon = useTranslations("common");

  async function handleDelete(e: React.MouseEvent, sessionId: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(tCommon("confirmDelete"))) return;
    setDeleting(sessionId);
    await deleteSession(sessionId);
    setDeleting(null);
  }

  async function handleCreate(formData: FormData) {
    const date = formData.get("date") as string;
    if (!date) {
      setError(t("pleaseSelectDate"));
      return;
    }
    const result = await createSessionManually(date);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDialogOpen(false);
    setError("");
  }

  function formatSessionDate(dateStr: string) {
    try {
      const date = new Date(dateStr + "T00:00:00");
      return format(date, "EEEE, dd/MM/yyyy", { locale: vi });
    } catch {
      return dateStr;
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-muted-foreground">{t("sessionsCount", { count: sessions.length })}</p>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setError("");
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" /> {t("createSession")}
          </DialogTrigger>
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
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full">
                {t("create")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {sessions.map((session) => {
          const statusStyles: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; cardBg: string; badgeBg: string; badgeText: string; iconBg: string }> = {
            voting: { labelKey: "voting", cardBg: "bg-green-50/60 border-green-200/50 dark:bg-green-950/20 dark:border-green-900/30", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300", iconBg: "bg-green-100 dark:bg-green-900/40" },
            confirmed: { labelKey: "confirmed", cardBg: "bg-green-50/60 border-green-200/50 dark:bg-green-950/20 dark:border-green-900/30", badgeBg: "bg-green-100 dark:bg-green-900/40", badgeText: "text-green-700 dark:text-green-300", iconBg: "bg-green-100 dark:bg-green-900/40" },
            completed: { labelKey: "completed", cardBg: "bg-blue-50/60 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-900/30", badgeBg: "bg-blue-100 dark:bg-blue-900/40", badgeText: "text-blue-700 dark:text-blue-300", iconBg: "bg-blue-100 dark:bg-blue-900/40" },
            cancelled: { labelKey: "cancelled", cardBg: "bg-red-50/60 border-red-200/50 dark:bg-red-950/20 dark:border-red-900/30", badgeBg: "bg-red-100 dark:bg-red-900/40", badgeText: "text-red-700 dark:text-red-300", iconBg: "bg-red-100 dark:bg-red-900/40" },
          };
          const status = statusStyles[session.status ?? "voting"];
          return (
            <Link key={session.id} href={`/admin/sessions/${session.id}`}>
              <Card className={`hover:opacity-80 transition-all cursor-pointer ${status.cardBg}`}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center w-9 h-9 rounded-full ${status.iconBg}`}>
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium capitalize">
                        {formatSessionDate(session.date)}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{session.startTime} - {session.endTime}</span>
                        {session.court && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {session.court.name}
                              {session.court.mapLink && (
                                <a
                                  href={session.court.mapLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-primary hover:underline text-xs"
                                >
                                  Chỉ đường <ExternalLink className="h-2.5 w-2.5 inline" />
                                </a>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                      {session.courtPrice != null && (
                        <p className="text-sm font-medium text-primary">
                          {formatVND(session.courtPrice)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${status.badgeBg} ${status.badgeText}`}>
                      {t(status.labelKey)}
                    </span>
                    <button
                      onClick={(e) => handleDelete(e, session.id)}
                      disabled={deleting === session.id}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {sessions.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {t("noSessions")}
          </div>
        )}
      </div>
    </div>
  );
}
