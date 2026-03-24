"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createCourt, updateCourt, toggleCourtActive } from "@/actions/courts";
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
import { Plus, Edit, MapPin, ToggleLeft, ToggleRight } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { courts as courtsTable } from "@/db/schema";

type Court = InferSelectModel<typeof courtsTable>;

export function CourtList({ courts }: { courts: Court[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCourt, setEditingCourt] = useState<Court | null>(null);
  const t = useTranslations("adminCourts");
  const tCommon = useTranslations("common");

  async function handleSubmit(formData: FormData) {
    if (editingCourt) {
      await updateCourt(editingCourt.id, formData);
    } else {
      await createCourt(formData);
    }
    setDialogOpen(false);
    setEditingCourt(null);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-muted-foreground">{t("count", { count: courts.length })}</p>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingCourt(null);
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" /> {t("addCourt")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingCourt ? t("editCourt") : t("addNewCourt")}
              </DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("courtName")}</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingCourt?.name ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">{t("address")}</Label>
                <Input
                  id="address"
                  name="address"
                  defaultValue={editingCourt?.address ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pricePerSession">{t("pricePerSession")}</Label>
                <Input
                  id="pricePerSession"
                  name="pricePerSession"
                  type="number"
                  defaultValue={editingCourt?.pricePerSession ?? ""}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {editingCourt ? t("update") : tCommon("add")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {courts.map((court) => (
          <Card key={court.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-accent">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">{court.name}</p>
                  {court.address && (
                    <p className="text-sm text-muted-foreground">{court.address}</p>
                  )}
                  <p className="text-sm font-medium text-primary">
                    {formatVND(court.pricePerSession)}{t("perSession")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={court.isActive ? "default" : "secondary"}>
                  {court.isActive ? t("active") : t("inactive")}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingCourt(court);
                    setDialogOpen(true);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <form action={async () => { await toggleCourtActive(court.id); }}>
                  <Button variant="ghost" size="icon" type="submit">
                    {court.isActive ? (
                      <ToggleRight className="h-4 w-4" />
                    ) : (
                      <ToggleLeft className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
