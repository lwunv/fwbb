"use client";

import { useState, useEffect } from "react";
import {
  addSessionShuttlecocks,
  removeSessionShuttlecock,
} from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { formatK } from "@/lib/utils";
import { calculateShuttlecockCost } from "@/lib/cost-calculator";
import { NumberStepper } from "@/components/ui/number-stepper";
import { CustomSelect } from "@/components/ui/custom-select";
import { X } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type {
  shuttlecockBrands as brandsTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Brand = InferSelectModel<typeof brandsTable>;
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable> & {
  brand: Brand;
};

export function ShuttlecockSelector({
  sessionId,
  brands,
  currentShuttlecocks,
}: {
  sessionId: number;
  brands: Brand[];
  currentShuttlecocks: SessionShuttlecock[];
}) {
  const [items, setItems] = useState<SessionShuttlecock[]>(currentShuttlecocks);

  useEffect(() => {
    setItems(currentShuttlecocks);
  }, [currentShuttlecocks]);

  // Brands already in use
  const usedBrandIds = new Set(items.map((s) => s.brandId));
  const availableBrands = brands.filter((b) => !usedBrandIds.has(b.id));

  function handleQuantityChange(item: SessionShuttlecock, newQty: number) {
    const prevItems = items;
    setItems((prev) =>
      prev.map((s) => (s.id === item.id ? { ...s, quantityUsed: newQty } : s)),
    );
    fireAction(
      () => addSessionShuttlecocks(sessionId, item.brandId, newQty),
      () => {
        setItems(prevItems);
      },
    );
  }

  function handleRemove(item: SessionShuttlecock) {
    const prevItems = items;
    setItems((prev) => prev.filter((s) => s.id !== item.id));
    fireAction(
      () => removeSessionShuttlecock(item.id),
      () => {
        setItems(prevItems);
      },
    );
  }

  function handleAddBrand(val: string) {
    const brandId = Number(val);
    const brand = brands.find((b) => b.id === brandId);
    if (!brand) return;

    const optimisticEntry = {
      id: -Date.now(),
      sessionId,
      brandId,
      quantityUsed: 1,
      pricePerTube: brand.pricePerTube,
      brand,
    } as SessionShuttlecock;

    const prevItems = items;
    setItems((prev) => [...prev, optimisticEntry]);
    fireAction(
      () => addSessionShuttlecocks(sessionId, brandId, 1),
      () => {
        setItems(prevItems);
      },
    );
  }

  if (brands.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Chưa có hãng cầu nào.</p>
    );
  }

  const totalCost = items.reduce(
    (sum, s) => sum + calculateShuttlecockCost(s.quantityUsed, s.pricePerTube),
    0,
  );

  return (
    <div className="space-y-2">
      {/* Each brand = 1 row */}
      {items.map((sc) => (
        <div key={sc.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">
              🏸 {sc.brand.name}
            </div>
            <div className="text-primary text-base font-bold tabular-nums">
              {formatK(
                calculateShuttlecockCost(sc.quantityUsed, sc.pricePerTube),
              )}
            </div>
          </div>
          <NumberStepper
            value={sc.quantityUsed}
            onChange={(v) => handleQuantityChange(sc, v)}
            min={1}
            max={99}
          />
          <button
            type="button"
            onClick={() => handleRemove(sc)}
            className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {/* Add new brand + Total on same row */}
      <div className="flex items-center gap-3">
        {availableBrands.length > 0 && (
          <CustomSelect
            value=""
            onChange={handleAddBrand}
            placeholder={
              items.length === 0 ? "Chọn hãng cầu..." : "+ Thêm hãng cầu..."
            }
            className="min-w-0 flex-1"
            options={availableBrands.map((b) => ({
              value: String(b.id),
              label: `${b.name} — ${formatK(b.pricePerTube)}/ống`,
            }))}
          />
        )}
        {totalCost > 0 && (
          <span className="text-muted-foreground shrink-0 text-base">
            Tổng:{" "}
            <span className="text-primary text-lg font-bold tabular-nums">
              {formatK(totalCost)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
