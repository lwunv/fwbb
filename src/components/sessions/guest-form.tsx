"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { ChevronDown, ChevronUp, UserPlus } from "lucide-react";

interface GuestFormProps {
  guestPlayCount: number;
  guestDineCount: number;
  onGuestPlayChange: (count: number) => void;
  onGuestDineChange: (count: number) => void;
  disabled?: boolean;
}

export function GuestForm({
  guestPlayCount,
  guestDineCount,
  onGuestPlayChange,
  onGuestDineChange,
  disabled = false,
}: GuestFormProps) {
  const [expanded, setExpanded] = useState(
    guestPlayCount > 0 || guestDineCount > 0,
  );

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
        type="button"
      >
        <UserPlus className="h-4 w-4" />
        <span>Them khach</span>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        {!expanded && (guestPlayCount > 0 || guestDineCount > 0) && (
          <span className="text-primary font-medium">
            ({guestPlayCount + guestDineCount} khach)
          </span>
        )}
      </button>

      {expanded && (
        <div className="flex flex-wrap items-end gap-4 pl-6">
          <div className="space-y-1">
            <Label>Khách chơi</Label>
            <NumberStepper
              value={guestPlayCount}
              onChange={onGuestPlayChange}
              min={0}
              max={10}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label>Khách ăn</Label>
            <NumberStepper
              value={guestDineCount}
              onChange={onGuestDineChange}
              min={0}
              max={10}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
