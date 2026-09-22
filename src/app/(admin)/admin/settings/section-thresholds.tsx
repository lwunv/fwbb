"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { MoneyInput } from "@/components/shared/money-input";
import { useSettingsDraft } from "./settings-draft";

type ThresholdKey =
  | "lowFundThreshold"
  | "voteBlockDebtThreshold"
  | "lowStockThresholdQua";

export function SectionThresholds() {
  const t = useTranslations("adminSettings");
  // Ghi vào bản nháp chung, server chỉ nhận khi admin bấm Lưu.
  const { get, set } = useSettingsDraft();

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
              value={get(f.key)}
              onCommit={(next) => set(f.key, next)}
              suffix={f.suffix}
              aria-label={f.label}
            />
          </label>
        ))}
      </div>
    </SectionCard>
  );
}
