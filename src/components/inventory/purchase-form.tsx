"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { recordPurchase } from "@/actions/inventory";
import { formatVND } from "@/lib/utils";
import { Plus, Loader2 } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { shuttlecockBrands as brandsTable } from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;

interface PurchaseFormProps {
  brands: Brand[];
}

export function PurchaseForm({ brands }: PurchaseFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<number | "">(
    brands.length > 0 ? brands[0].id : "",
  );
  const [tubes, setTubes] = useState(1);
  const [pricePerTube, setPricePerTube] = useState<number>(
    brands.length > 0 ? brands[0].pricePerTube : 0,
  );
  const [purchasedAt, setPurchasedAt] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");

  function handleBrandChange(brandId: number) {
    setSelectedBrandId(brandId);
    const brand = brands.find((b) => b.id === brandId);
    if (brand) {
      setPricePerTube(brand.pricePerTube);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBrandId) return;

    setIsLoading(true);
    setError("");
    setSuccess(false);

    const formData = new FormData();
    formData.set("brandId", String(selectedBrandId));
    formData.set("tubes", String(tubes));
    formData.set("pricePerTube", String(pricePerTube));
    formData.set("purchasedAt", purchasedAt);
    formData.set("notes", notes);

    const result = await recordPurchase(formData);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setTubes(1);
      setNotes("");
      setTimeout(() => setSuccess(false), 3000);
    }
    setIsLoading(false);
  }

  const totalPrice = tubes * pricePerTube;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-semibold mb-3">Nhập mua cầu</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Brand */}
          <div>
            <Label className="text-xs">Hãng cầu</Label>
            <select
              value={selectedBrandId}
              onChange={(e) => handleBrandChange(Number(e.target.value))}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">Chọn hãng...</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({formatVND(b.pricePerTube)}/ống)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Tubes */}
            <div>
              <Label className="text-xs">Số ống</Label>
              <Input
                type="number"
                value={tubes}
                onChange={(e) => setTubes(Number(e.target.value) || 1)}
                min={1}
              />
            </div>

            {/* Price per tube */}
            <div>
              <Label className="text-xs">Giá/ống (VND)</Label>
              <Input
                type="number"
                value={pricePerTube || ""}
                onChange={(e) => setPricePerTube(Number(e.target.value) || 0)}
                min={0}
                step={1000}
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <Label className="text-xs">Ngày mua</Label>
            <Input
              type="date"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs">Ghi chú</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú (tùy chọn)"
            />
          </div>

          {/* Total */}
          {totalPrice > 0 && (
            <div className="text-sm text-muted-foreground">
              Tổng: <strong className="text-foreground">{formatVND(totalPrice)}</strong>
            </div>
          )}

          <Button type="submit" disabled={isLoading || !selectedBrandId} className="w-full">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Nhập mua
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-primary">Đã lưu thành công!</p>}
        </form>
      </CardContent>
    </Card>
  );
}
