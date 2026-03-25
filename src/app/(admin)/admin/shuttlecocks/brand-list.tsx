"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createBrand, updateBrand, toggleBrandActive } from "@/actions/shuttlecocks";
import { formatK } from "@/lib/utils";
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
import { Plus, Edit, CircleDot, ToggleLeft, ToggleRight } from "lucide-react";
import { usePolling } from "@/lib/use-polling";
import type { InferSelectModel } from "drizzle-orm";
import type { shuttlecockBrands as brandsTable } from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;

export function BrandList({ brands }: { brands: Brand[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const t = useTranslations("adminShuttlecocks");
  const tCommon = useTranslations("common");
  usePolling();

  async function handleSubmit(formData: FormData) {
    if (editingBrand) {
      await updateBrand(editingBrand.id, formData);
    } else {
      await createBrand(formData);
    }
    setDialogOpen(false);
    setEditingBrand(null);
  }

  return (
    <div className="pb-20">
      <div className="flex justify-between items-center mb-4">
        <p className="text-muted-foreground">{t("count", { count: brands.length })}</p>
      </div>
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingBrand(null);
        }}
      >
        <div className="fixed bottom-0 left-0 right-0 lg:left-60 z-30 p-3 bg-background/95 backdrop-blur border-t">
          <DialogTrigger render={<Button className="w-full" size="lg" />}>
            <Plus className="h-4 w-4 mr-2" /> {t("addBrand")}
          </DialogTrigger>
        </div>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingBrand ? t("editBrand") : t("addNewBrand")}
              </DialogTitle>
            </DialogHeader>
            <form key={editingBrand?.id ?? "new"} action={handleSubmit} className="space-y-4">
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
                <Input
                  id="pricePerTube"
                  name="pricePerTube"
                  type="number"
                  defaultValue={editingBrand?.pricePerTube ?? ""}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {editingBrand ? t("update") : tCommon("add")}
              </Button>
            </form>
          </DialogContent>
      </Dialog>

      <div className="grid gap-3">
        {brands.map((brand) => (
          <Card key={brand.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-accent">
                  <CircleDot className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium">{brand.name}</p>
                  <p className="text-sm font-medium text-primary">
                    {formatK(brand.pricePerTube)}{t("perTube")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={brand.isActive ? "default" : "secondary"}>
                  {brand.isActive ? t("active") : t("inactive")}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingBrand(brand);
                    setDialogOpen(true);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <form action={async () => { await toggleBrandActive(brand.id); }}>
                  <Button variant="ghost" size="icon" type="submit">
                    {brand.isActive ? (
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
