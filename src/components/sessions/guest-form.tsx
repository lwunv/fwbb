"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
    guestPlayCount > 0 || guestDineCount > 0
  );

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        type="button"
      >
        <UserPlus className="h-4 w-4" />
        <span>Them khach</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {!expanded && (guestPlayCount > 0 || guestDineCount > 0) && (
          <span className="text-primary font-medium">
            ({guestPlayCount + guestDineCount} khach)
          </span>
        )}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-3 pl-6">
          <div className="space-y-1">
            <Label className="text-xs">Khach choi</Label>
            <Input
              type="number"
              min={0}
              max={10}
              value={guestPlayCount}
              onChange={(e) => onGuestPlayChange(Math.max(0, Number(e.target.value)))}
              disabled={disabled}
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Khach an</Label>
            <Input
              type="number"
              min={0}
              max={10}
              value={guestDineCount}
              onChange={(e) => onGuestDineChange(Math.max(0, Number(e.target.value)))}
              disabled={disabled}
              className="h-8"
            />
          </div>
        </div>
      )}
    </div>
  );
}
