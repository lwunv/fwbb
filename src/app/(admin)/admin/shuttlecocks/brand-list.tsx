"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  createBrand,
  updateBrand,
  toggleBrandActive,
} from "@/actions/shuttlecocks";
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
import { Plus, Edit, CircleDot, ToggleLeft, X } from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import type { InferSelectModel } from "drizzle-orm";
import type { shuttlecockBrands as brandsTable } from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;

export function BrandList({ brands }: { brands: Brand[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [price, setPrice] = useState(320000);
  const [toggledBrands, setToggledBrands] = useState<Record<number, boolean>>(
    {},
  );
  const t = useTranslations("adminShuttlecocks");
  const tCommon = useTranslations("common");
  usePolling();

  function handleToggle(brandId: number, currentActive: boolean) {
    setToggledBrands((prev) => ({ ...prev, [brandId]: !currentActive }));
    fireAction(
      () => toggleBrandActive(brandId),
      () => setToggledBrands((prev) => ({ ...prev, [brandId]: currentActive })),
    );
  }

  function handleSubmit(formData: FormData) {
    const wasEditing = editingBrand;
    setDialogOpen(false);
    setEditingBrand(null);
    fireAction(
      () =>
        wasEditing
          ? updateBrand(wasEditing.id, formData)
          : createBrand(formData),
      () => {
        setEditingBrand(wasEditing);
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
          if (open && !editingBrand) setPrice(320000);
          if (!open) setEditingBrand(null);
        }}
      >
        <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="mr-2 h-4 w-4" /> {t("addBrand")}
          </DialogTrigger>
        </div>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingBrand ? t("editBrand") : t("addNewBrand")}
            </DialogTitle>
          </DialogHeader>
          <form
            key={editingBrand?.id ?? "new"}
            action={handleSubmit}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="name">{t("brandName")}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editingBrand?.name ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pricePerTube">{t("pricePerTube")}</Label>
              <NumberStepper
                value={price}
                onChange={setPrice}
                name="pricePerTube"
                min={0}
                step={5000}
                className="flex w-full"
              />
            </div>
            <Button type="submit" className="w-full">
              {editingBrand ? t("update") : tCommon("add")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {[...brands]
          .sort((a, b) => {
            const aActive = toggledBrands[a.id] ?? a.isActive;
            const bActive = toggledBrands[b.id] ?? b.isActive;
            if (aActive === bActive) return 0;
            return aActive ? -1 : 1;
          })
          .map((brand) => {
            const isActive = toggledBrands[brand.id] ?? brand.isActive;
            return (
              <Card key={brand.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                      <CircleDot className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold">{brand.name}</p>
                      <p className="text-primary text-base font-medium">
                        {formatK(brand.pricePerTube)}
                        {t("perTube")}
                      </p>
                    </div>
                  </div>
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
                        setEditingBrand(brand);
                        setPrice(brand.pricePerTube);
                        setDialogOpen(true);
                      }}
                    >
                      <Edit className="mr-1.5 h-4 w-4" />
                      {tCommon("edit")}
                    </Button>
                    <Button
                      variant={isActive ? "destructive" : "default"}
                      size="sm"
                      onClick={() => handleToggle(brand.id, isActive)}
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
