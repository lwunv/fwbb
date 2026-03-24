"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createSessionManually } from "@/actions/sessions";
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
import { Plus, Calendar, MapPin, ChevronRight } from "lucide-react";
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
  const t = useTranslations("sessions");

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
          const statusConfig: Record<string, { labelKey: "voting" | "confirmed" | "completed" | "cancelled"; variant: "default" | "secondary" | "destructive" | "outline" }> = {
            voting: { labelKey: "voting", variant: "outline" },
            confirmed: { labelKey: "confirmed", variant: "default" },
            completed: { labelKey: "completed", variant: "secondary" },
            cancelled: { labelKey: "cancelled", variant: "destructive" },
          };
          const status = statusConfig[session.status ?? "voting"];
          return (
            <Link key={session.id} href={`/admin/sessions/${session.id}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-accent">
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
                    <Badge variant={status.variant}>{t(status.labelKey)}</Badge>
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
