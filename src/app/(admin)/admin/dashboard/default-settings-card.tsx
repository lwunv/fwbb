"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Settings2 } from "lucide-react";
import { CustomSelect } from "@/components/ui/custom-select";
import { SectionCard } from "@/components/shared/section-card";
import { fireAction } from "@/lib/optimistic-action";
import {
  setDefaultCourt,
  setDefaultBrand,
  setSessionDaysOfWeek,
} from "@/actions/settings";
import { formatK, cn } from "@/lib/utils";

interface CourtOpt {
  id: number;
  name: string;
  pricePerSession: number;
}
interface BrandOpt {
  id: number;
  name: string;
  pricePerTube: number;
}

interface Props {
  courts: CourtOpt[];
  brands: BrandOpt[];
  /** Currently-resolved default court (from setting OR fallback). */
  currentCourtId: number | null;
  /** Currently-resolved default brand (from setting OR fallback). */
  currentBrandId: number | null;
  /** Default session days-of-week (0=CN, 1=T2, …, 6=T7). */
  currentSessionDays: number[];
}

// Display order T2..T7, CN. Index → JS day-of-week (Sun=0, Mon=1, …, Sat=6).
const DAY_PILLS: { dow: number; label: string }[] = [
  { dow: 1, label: "Thứ 2" },
  { dow: 2, label: "Thứ 3" },
  { dow: 3, label: "Thứ 4" },
  { dow: 4, label: "Thứ 5" },
  { dow: 5, label: "Thứ 6" },
  { dow: 6, label: "Thứ 7" },
  { dow: 0, label: "CN" },
];

/**
 * Dashboard settings panel — admin chọn sân + hãng cầu mặc định để
 * khi tự động tạo buổi mới, các giá trị đó được pre-fill (admin có thể
 * vẫn đổi qua CourtSelector / ShuttlecockSelector trên session card).
 *
 * Day toggle: chọn các thứ trong tuần được auto-tạo buổi (cron + auto-create
 * today). Default Mon/Wed/Fri.
 */
export function DefaultSettingsCard({
  courts,
  brands,
  currentCourtId,
  currentBrandId,
  currentSessionDays,
}: Props) {
  const td = useTranslations("dashboard");
  const [courtId, setCourtId] = useState<string>(
    currentCourtId ? String(currentCourtId) : "",
  );
  const [brandId, setBrandId] = useState<string>(
    currentBrandId ? String(currentBrandId) : "",
  );
  const [sessionDays, setSessionDays] = useState<Set<number>>(
    new Set(currentSessionDays),
  );

  function handleCourtChange(v: string) {
    const prev = courtId;
    setCourtId(v);
    const id = parseInt(v, 10);
    if (!Number.isFinite(id)) return;
    fireAction(
      () => setDefaultCourt(id),
      () => setCourtId(prev),
    );
  }

  function handleBrandChange(v: string) {
    const prev = brandId;
    setBrandId(v);
    const id = parseInt(v, 10);
    if (!Number.isFinite(id)) return;
    fireAction(
      () => setDefaultBrand(id),
      () => setBrandId(prev),
    );
  }

  function toggleDay(dow: number) {
    const prev = new Set(sessionDays);
    const next = new Set(sessionDays);
    if (next.has(dow)) next.delete(dow);
    else next.add(dow);
    if (next.size === 0) return; // ít nhất 1 ngày — đồng bộ server validate
    setSessionDays(next);
    fireAction(
      () => setSessionDaysOfWeek(Array.from(next)),
      () => setSessionDays(prev),
    );
  }

  if (courts.length === 0 && brands.length === 0) return null;

  return (
    <SectionCard
      tone="primary"
      icon={Settings2}
      title={td("defaultsTitle")}
      className="h-full"
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              {td("defaultsCourtLabel")}
            </label>
            <CustomSelect
              value={courtId}
              onChange={handleCourtChange}
              placeholder={td("defaultsCourtPlaceholder")}
              options={courts.map((c) => ({
                value: String(c.id),
                label: c.name,
                rightLabel: c.pricePerSession
                  ? formatK(c.pricePerSession)
                  : undefined,
              }))}
            />
          </div>
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              {td("defaultsBrandLabel")}
            </label>
            <CustomSelect
              value={brandId}
              onChange={handleBrandChange}
              placeholder={td("defaultsBrandPlaceholder")}
              options={brands.map((b) => ({
                value: String(b.id),
                label: b.name,
                rightLabel: b.pricePerTube
                  ? `${formatK(b.pricePerTube)}${td("defaultsBrandPriceSuffix")}`
                  : undefined,
              }))}
            />
          </div>
        </div>

        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            {td("defaultsDaysLabel")}
          </label>
          <div className="grid grid-cols-7 gap-1">
            {DAY_PILLS.map(({ dow, label }) => {
              const active = sessionDays.has(dow);
              return (
                <button
                  key={dow}
                  type="button"
                  onClick={() => toggleDay(dow)}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center rounded-md border px-1 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
