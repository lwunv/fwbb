"use client";

import { useState } from "react";
import { addSessionShuttlecocks, removeSessionShuttlecock } from "@/actions/sessions";
import { formatVND } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CircleDot, Plus, Trash2 } from "lucide-react";
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
  const [selectedBrandId, setSelectedBrandId] = useState<number | "">(
    brands.length > 0 ? brands[0].id : ""
  );
  const [quantity, setQuantity] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd() {
    if (!selectedBrandId || quantity <= 0) return;
    setIsLoading(true);
    setError("");
    const result = await addSessionShuttlecocks(sessionId, Number(selectedBrandId), quantity);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  async function handleRemove(id: number) {
    setIsLoading(true);
    const result = await removeSessionShuttlecock(id);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  const totalCost = currentShuttlecocks.reduce(
    (sum, s) => sum + s.quantityUsed * s.pricePerTube,
    0
  );

  return (
    <div className="space-y-4">
      {/* Current shuttlecocks */}
      {currentShuttlecocks.length > 0 && (
        <div className="space-y-2">
          {currentShuttlecocks.map((sc) => (
            <div
              key={sc.id}
              className="flex items-center justify-between p-3 rounded-lg border"
            >
              <div className="flex items-center gap-3">
                <CircleDot className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{sc.brand.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {sc.quantityUsed} quả x {formatVND(sc.pricePerTube)} = {formatVND(sc.quantityUsed * sc.pricePerTube)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemove(sc.id)}
                disabled={isLoading}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="text-sm font-medium text-right pt-2 border-t">
            Tổng: {formatVND(totalCost)}
          </div>
        </div>
      )}

      {/* Add new shuttlecock */}
      {brands.length > 0 ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block sr-only">
              Hãng cầu
            </label>
            <select
              value={selectedBrandId}
              onChange={(e) => setSelectedBrandId(Number(e.target.value))}
              className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm"
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name} - {formatVND(brand.pricePerTube)}/quả
                </option>
              ))}
            </select>
          </div>
          <div className="w-20">
            <label className="text-xs text-muted-foreground mb-1 block">
              Số quả
            </label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="h-8"
            />
          </div>
          <Button
            size="default"
            onClick={handleAdd}
            disabled={isLoading}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Chưa có hãng cầu nào. Vui lòng thêm hãng cầu trước.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
