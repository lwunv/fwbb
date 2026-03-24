"use client";

import { useState } from "react";
import { selectCourt } from "@/actions/sessions";
import { formatVND } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MapPin, Check } from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type { courts as courtsTable } from "@/db/schema";

type Court = InferSelectModel<typeof courtsTable>;

export function CourtSelector({
  sessionId,
  courts,
  currentCourtId,
}: {
  sessionId: number;
  courts: Court[];
  currentCourtId: number | null;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSelect(courtId: number) {
    setIsLoading(true);
    setError("");
    const result = await selectCourt(sessionId, courtId);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  if (courts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Chua co san nao. Vui long them san truoc.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2">
        {courts.map((court) => {
          const isSelected = court.id === currentCourtId;
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
                  <p className="font-medium text-sm">{court.name}</p>
                  {court.address && (
                    <p className="text-xs text-muted-foreground">{court.address}</p>
                  )}
                  <p className="text-xs font-medium text-primary">
                    {formatVND(court.pricePerSession)}/buoi
                  </p>
                </div>
              </div>
              {isSelected && <Check className="h-4 w-4 text-primary" />}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
