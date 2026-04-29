"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createCourt, updateCourt, toggleCourtActive } from "@/actions/courts";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, MapPin, ToggleLeft, X, Navigation } from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import type { InferSelectModel } from "drizzle-orm";
import type { courts as courtsTable } from "@/db/schema";

type Court = InferSelectModel<typeof courtsTable>;

export function CourtList({ courts }: { courts: Court[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCourt, setEditingCourt] = useState<Court | null>(null);
  const [price, setPrice] = useState(0);
  const [retailPrice, setRetailPrice] = useState(0);
  const [toggledCourts, setToggledCourts] = useState<Record<number, boolean>>(
    {},
  );
  const t = useTranslations("adminCourts");
  const tCommon = useTranslations("common");
  usePolling();

  function handleToggle(courtId: number, currentActive: boolean) {
    setToggledCourts((prev) => ({ ...prev, [courtId]: !currentActive }));
    fireAction(
      () => toggleCourtActive(courtId),
      () => setToggledCourts((prev) => ({ ...prev, [courtId]: currentActive })),
    );
  }

  function handleSubmit(formData: FormData) {
    const wasEditing = editingCourt;
    setDialogOpen(false);
    setEditingCourt(null);
    fireAction(
      () =>
        wasEditing
          ? updateCourt(wasEditing.id, formData)
          : createCourt(formData),
      () => {
        setEditingCourt(wasEditing);
        setDialogOpen(true);
      },
    );
  }

  return (
    <div className="">
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingCourt(null);
        }}
      >
        <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="mr-2 h-4 w-4" /> {t("addCourt")}
          </DialogTrigger>
        </div>
        <DialogContent className="p-6 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingCourt ? t("editCourt") : t("addNewCourt")}
            </DialogTitle>
          </DialogHeader>
          <form
            key={editingCourt?.id ?? "new"}
            action={handleSubmit}
            className="space-y-4"
          >
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
              <Label htmlFor="mapLink">{t("mapLink")}</Label>
              <Input
                id="mapLink"
                name="mapLink"
                type="url"
                placeholder={t("mapLinkPlaceholder")}
                defaultValue={editingCourt?.mapLink ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pricePerSession">
                Giá thuê tháng (200k/2h cho sân chính)
              </Label>
              <NumberStepper
                value={price}
                onChange={setPrice}
                name="pricePerSession"
                min={0}
                step={10000}
                className="flex w-full"
              />
              <p className="text-muted-foreground text-xs">
                Áp dụng khi đã ký hợp đồng tháng — sân chính của buổi.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pricePerSessionRetail">
                Giá thuê lẻ (220k/2h cho sân thuê thêm)
              </Label>
              <NumberStepper
                value={retailPrice}
                onChange={setRetailPrice}
                name="pricePerSessionRetail"
                min={0}
                step={10000}
                className="flex w-full"
              />
              <p className="text-muted-foreground text-xs">
                Áp dụng cho sân thứ 2 thuê thêm hoặc khi không có hợp đồng
                tháng.
              </p>
            </div>
            <Button type="submit" className="w-full">
              {editingCourt ? t("update") : tCommon("add")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {[...courts]
          .sort((a, b) => {
            const aActive = toggledCourts[a.id] ?? a.isActive;
            const bActive = toggledCourts[b.id] ?? b.isActive;
            if (aActive === bActive) return 0;
            return aActive ? -1 : 1;
          })
          .map((court) => {
            const isActive = toggledCourts[court.id] ?? court.isActive;
            return (
              <Card key={court.id}>
                <CardContent className="space-y-3 p-4">
                  {/* Info */}
                  <div className="flex items-start gap-3">
                    <div className="bg-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold">{court.name}</p>
                      {court.address && (
                        <p className="text-muted-foreground text-sm">
                          {court.address}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                        <span className="text-primary font-medium">
                          Tháng:{" "}
                          <strong className="tabular-nums">
                            {formatK(court.pricePerSession)}
                          </strong>
                          {t("perSession")}
                        </span>
                        {court.pricePerSessionRetail != null && (
                          <span className="text-muted-foreground">
                            Lẻ:{" "}
                            <strong className="tabular-nums">
                              {formatK(court.pricePerSessionRetail)}
                            </strong>
                            {t("perSession")}
                          </span>
                        )}
                      </div>
                    </div>
                    {court.mapLink && (
                      <a
                        href={court.mapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80 inline-flex shrink-0 items-center gap-1 text-sm"
                      >
                        <Navigation className="h-4 w-4" />
                        {t("openMap")}
                      </a>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={isActive ? "default" : "secondary"}
                      className="px-3 py-1 text-sm"
                    >
                      {isActive ? t("active") : t("inactive")}
                    </Badge>
                    <div className="flex-1" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingCourt(court);
                        setPrice(court.pricePerSession);
                        setRetailPrice(
                          court.pricePerSessionRetail ??
                            court.pricePerSession + 20000,
                        );
                        setDialogOpen(true);
                      }}
                    >
                      <Edit className="mr-1.5 h-4 w-4" />
                      {tCommon("edit")}
                    </Button>
                    <Button
                      variant={isActive ? "destructive" : "default"}
                      size="sm"
                      onClick={() => handleToggle(court.id, isActive)}
                    >
                      {isActive ? (
                        <>
                          <X className="mr-1.5 h-4 w-4" />
                          {tCommon("delete")}
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="mr-1.5 h-4 w-4" />
                          {tCommon("enable")}
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
