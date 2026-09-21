"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { MoneyInput } from "@/components/shared/money-input";
import { fireAction } from "@/lib/optimistic-action";
import { useWriteQueue } from "@/lib/use-write-queue";
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

  const enqueue = useWriteQueue();

  function commit(key: ThresholdKey, next: number) {
    const prev = values[key];
    if (next === prev) return;
    setValues((v) => ({ ...v, [key]: next }));
    fireAction(
      () => enqueue(key, () => updateSetting(key, next)),
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
            <MoneyInput
              value={values[f.key]}
              onCommit={(next) => commit(f.key, next)}
              suffix={f.suffix}
              aria-label={f.label}
            />
          </label>
        ))}
      </div>
    </SectionCard>
  );
}
