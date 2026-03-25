"use client";

import { useState } from "react";
import { selectCourt } from "@/actions/sessions";
import { formatK } from "@/lib/utils";
import { MapPin, Check, Minus, Plus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InferSelectModel } from "drizzle-orm";
import type { courts as courtsTable } from "@/db/schema";

type Court = InferSelectModel<typeof courtsTable>;

export function CourtSelector({
  sessionId,
  courts,
  currentCourtId,
  currentCourtQuantity = 1,
}: {
  sessionId: number;
  courts: Court[];
  currentCourtId: number | null;
  currentCourtQuantity?: number;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(currentCourtQuantity);

  async function handleSelect(courtId: number) {
    setIsLoading(true);
    setError("");
    const result = await selectCourt(sessionId, courtId, quantity);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  async function handleQuantityChange(newQty: number) {
    const q = Math.max(1, newQty);
    setQuantity(q);
    if (currentCourtId) {
      setIsLoading(true);
      await selectCourt(sessionId, currentCourtId, q);
      setIsLoading(false);
    }
  }

  if (courts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Chưa có sân nào. Vui lòng thêm sân trước.
      </p>
    );
  }

  const selectedCourt = courts.find((c) => c.id === currentCourtId);
  const totalPrice = selectedCourt ? selectedCourt.pricePerSession * quantity : 0;

  return (
    <div className="space-y-3">
      {/* Court quantity */}
      <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
        <span className="text-sm font-medium">Số lượng sân</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleQuantityChange(quantity - 1)}
            disabled={quantity <= 1 || isLoading}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-8 text-center font-bold">{quantity}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleQuantityChange(quantity + 1)}
            disabled={isLoading}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Court list */}
      <div className="grid gap-2">
        {courts.map((court) => {
          const isSelected = court.id === currentCourtId;
          const courtTotal = court.pricePerSession * quantity;
          return (
            <button
              key={court.id}
              onClick={() => handleSelect(court.id)}
              disabled={isLoading}
              className={`flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              }`}
            >
              <div className="flex items-center gap-3">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="flex items-center gap-1">
                    <p className="font-medium text-sm">{court.name}</p>
                    {court.mapLink && (
                      <a
                        href={court.mapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:text-primary/80"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {court.address && (
                    <p className="text-xs text-muted-foreground">{court.address}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {formatK(court.pricePerSession)}/sân
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-primary">
                  {formatK(courtTotal)}
                </span>
                {isSelected && <Check className="h-4 w-4 text-primary" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Total price */}
      {selectedCourt && (
        <div className="flex items-center justify-between text-sm p-2 rounded bg-primary/10">
          <span>Tổng tiền sân:</span>
          <span className="font-bold text-primary">{formatK(totalPrice)}</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
