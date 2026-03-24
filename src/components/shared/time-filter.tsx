"use client";

import { useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const filterKeys = ["week", "month", "year", "all"] as const;

export type TimeFilterValue = (typeof filterKeys)[number];

interface TimeFilterProps {
  value?: TimeFilterValue;
  onChange?: (value: TimeFilterValue) => void;
}

/**
 * Time filter tabs: Week / Month / Year / All.
 * Uses nuqs for URL state when no explicit value/onChange provided.
 */
export function TimeFilter({ value: controlledValue, onChange }: TimeFilterProps) {
  const t = useTranslations("timeFilter");
  const [queryValue, setQueryValue] = useQueryState("period", {
    defaultValue: "all",
  });

  const currentValue = controlledValue ?? queryValue;
  const handleChange = onChange ?? setQueryValue;

  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {filterKeys.map((key) => (
        <button
          key={key}
          onClick={() => handleChange(key)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            currentValue === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}
