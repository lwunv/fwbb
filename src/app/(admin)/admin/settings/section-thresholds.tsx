"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";

type ThresholdKey =
  | "lowFundThreshold"
  | "voteBlockDebtThreshold"
  | "lowStockThresholdQua";

export function SectionThresholds({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");
  const [values, setValues] = useState<Record<ThresholdKey, number>>({
    lowFundThreshold: settings.lowFundThreshold,
    voteBlockDebtThreshold: settings.voteBlockDebtThreshold,
    lowStockThresholdQua: settings.lowStockThresholdQua,
  });

  function commit(key: ThresholdKey, raw: string) {
    const next = Number(raw);
    if (!Number.isInteger(next) || next < 0) return;
    const prev = values[key];
    setValues((v) => ({ ...v, [key]: next }));
    fireAction(
      () => updateSetting(key, next),
      () => setValues((v) => ({ ...v, [key]: prev })),
    );
  }

  const fields: { key: ThresholdKey; label: string; suffix: string }[] = [
    { key: "lowFundThreshold", label: t("lowFund"), suffix: "đ" },
    { key: "voteBlockDebtThreshold", label: t("voteBlockDebt"), suffix: "đ" },
    { key: "lowStockThresholdQua", label: t("lowStock"), suffix: t("quaUnit") },
  ];

  return (
    <SectionCard tone="amber" icon={TriangleAlert} title={t("thresholds")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {f.label}
            </span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={values[f.key]}
                className="min-h-11"
                onChange={(e) => commit(f.key, e.target.value)}
              />
              <span className="text-muted-foreground shrink-0 text-sm">
                {f.suffix}
              </span>
            </div>
          </label>
        ))}
      </div>
    </SectionCard>
  );
}
