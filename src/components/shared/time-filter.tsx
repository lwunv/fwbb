"use client";

import { useQueryState } from "nuqs";
import { cn } from "@/lib/utils";

const filters = [
  { key: "week", label: "Tuan" },
  { key: "month", label: "Thang" },
  { key: "year", label: "Nam" },
  { key: "all", label: "Tat ca" },
] as const;

export type TimeFilterValue = (typeof filters)[number]["key"];

interface TimeFilterProps {
  value?: TimeFilterValue;
  onChange?: (value: TimeFilterValue) => void;
}

/**
 * Time filter tabs: Tuan / Thang / Nam / Tat ca.
 * Uses nuqs for URL state when no explicit value/onChange provided.
 */
export function TimeFilter({ value: controlledValue, onChange }: TimeFilterProps) {
  const [queryValue, setQueryValue] = useQueryState("period", {
    defaultValue: "all",
  });

  const currentValue = controlledValue ?? queryValue;
  const handleChange = onChange ?? setQueryValue;

  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {filters.map((f) => (
        <button
          key={f.key}
          onClick={() => handleChange(f.key)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            currentValue === f.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
