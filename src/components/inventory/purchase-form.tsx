"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { NumberStepper } from "@/components/ui/number-stepper";
import { CustomSelect } from "@/components/ui/custom-select";
import { recordPurchase } from "@/actions/inventory";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { shuttlecockBrands as brandsTable } from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;

interface PurchaseFormProps {
  brands: Brand[];
}

export function PurchaseForm({ brands }: PurchaseFormProps) {
  const t = useTranslations("inventory");
  const [success, setSuccess] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<string>(
    brands.length > 0 ? String(brands[0].id) : "",
  );
  const [tubes, setTubes] = useState(1);
  const [pricePerTube, setPricePerTube] = useState<number>(
    brands.length > 0 ? brands[0].pricePerTube : 0,
  );
  const [purchasedAt, setPurchasedAt] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");

  function handleBrandChange(val: string) {
    setSelectedBrandId(val);
    const brand = brands.find((b) => b.id === Number(val));
    if (brand) {
      setPricePerTube(brand.pricePerTube);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBrandId || selectedBrandId === "") return;

    const formData = new FormData();
    formData.set("brandId", String(selectedBrandId));
    formData.set("tubes", String(tubes));
    formData.set("pricePerTube", String(pricePerTube));
    formData.set("purchasedAt", purchasedAt);
    formData.set("notes", notes);

    // Capture current values for rollback
    const prevTubes = tubes;
    const prevNotes = notes;

    // Optimistic: reset form and show success immediately
    setTubes(1);
    setNotes("");
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);

    fireAction(
      () => recordPurchase(formData),
      () => {
        setTubes(prevTubes);
        setNotes(prevNotes);
        setSuccess(false);
      },
    );
  }

  const totalPrice = tubes * pricePerTube;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 font-semibold">{t("purchaseShuttle")}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Brand */}
          <div>
            <Label>{t("brandField")}</Label>
            <CustomSelect
              value={selectedBrandId}
              onChange={handleBrandChange}
              placeholder={t("selectBrand")}
              options={brands.map((b) => ({
                value: String(b.id),
                label: `${b.name} (${formatK(b.pricePerTube)}/${t("tube")})`,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Tubes */}
            <div className="space-y-1">
              <Label>{t("tubesCount")}</Label>
              <NumberStepper
                value={tubes}
                onChange={setTubes}
                min={1}
                max={99}
              />
            </div>

            {/* Price per tube */}
            <div className="space-y-1">
              <Label>{t("pricePerTubeShort")}</Label>
              <NumberStepper
                value={pricePerTube}
                onChange={setPricePerTube}
                min={0}
                step={5000}
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <Label>{t("purchaseDate")}</Label>
            <Input
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <Label>{t("notesLabel")}</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesOptional")}
            />
          </div>

          {/* Total */}
          {totalPrice > 0 && (
            <div className="text-muted-foreground text-sm">
              {t("totalWithAmount", { amount: formatK(totalPrice) })}
            </div>
          )}

          <Button type="submit" disabled={!selectedBrandId} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            {t("recordPurchase")}
          </Button>

          {success && <p className="text-primary text-sm">{t("savedOk")}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
