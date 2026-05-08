"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Settings2 } from "lucide-react";
import { CustomSelect } from "@/components/ui/custom-select";
import { SectionCard } from "@/components/shared/section-card";
import { fireAction } from "@/lib/optimistic-action";
import { setDefaultCourt, setDefaultBrand } from "@/actions/settings";
import { formatK } from "@/lib/utils";

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
}

/**
 * Dashboard settings panel — admin chọn sân + hãng cầu mặc định để
 * khi tự động tạo buổi mới, các giá trị đó được pre-fill (admin có thể
 * vẫn đổi qua CourtSelector / ShuttlecockSelector trên session card).
 */
export function DefaultSettingsCard({
  courts,
  brands,
  currentCourtId,
  currentBrandId,
}: Props) {
  const td = useTranslations("dashboard");
  const [courtId, setCourtId] = useState<string>(
    currentCourtId ? String(currentCourtId) : "",
  );
  const [brandId, setBrandId] = useState<string>(
    currentBrandId ? String(currentBrandId) : "",
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

  if (courts.length === 0 && brands.length === 0) return null;

  return (
    <SectionCard tone="primary" icon={Settings2} title={td("defaultsTitle")}>
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
              label: `${c.name}${
                c.pricePerSession ? ` · ${formatK(c.pricePerSession)}` : ""
              }`,
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
              label: `${b.name}${
                b.pricePerTube
                  ? ` · ${formatK(b.pricePerTube)}${td("defaultsBrandPriceSuffix")}`
                  : ""
              }`,
            }))}
          />
        </div>
      </div>
    </SectionCard>
  );
}
