"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Calculator } from "lucide-react";
import {
  exchangeFeeEstimate,
  type ExchangeFeeConfig,
} from "@/lib/exchange-fee";
import { formatVND } from "@/lib/utils";

/**
 * Xem trước phí bằng ĐÚNG hàm server dùng (`exchangeFeeEstimate`), nên số host
 * thấy khớp số hệ thống tính sau này. `split_equal` là mức tối đa thật;
 * `split_female_discount` chỉ là ước tính (quyết định 32), phải nói rõ.
 */
export function FeePreview({ cfg }: { cfg: ExchangeFeeConfig }) {
  const t = useTranslations("exchange.form");
  const est = exchangeFeeEstimate(cfg);
  const count = cfg.minHeads ?? 0;

  let line: string | null = null;
  let note: string | null = null;
  switch (cfg.feeMode) {
    case "fixed":
      line = t("previewFixed", { amount: formatVND(est.male) });
      break;
    case "fixed_gender":
      line = t("previewGender", {
        male: formatVND(est.male),
        female: formatVND(est.female),
      });
      break;
    case "split_equal":
      if ((cfg.estimatedTotalCost ?? 0) > 0) {
        line = t("previewSplitEqual", { amount: formatVND(est.male), count });
        note = t("previewSplitEqualNote");
      }
      break;
    case "split_female_discount":
      if ((cfg.estimatedTotalCost ?? 0) > 0) {
        line = t("previewSplitFemale", { amount: formatVND(est.male), count });
        note = t("previewSplitFemaleNote");
      }
      break;
  }

  return (
    <motion.div
      data-testid="fee-preview"
      layout
      className="bg-primary/10 border-primary/20 space-y-1 rounded-2xl border p-4"
    >
      <p className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
        <Calculator className="h-4 w-4" aria-hidden />
        {t("previewTitle")}
      </p>
      <p className="text-lg font-semibold tabular-nums">
        {line ?? t("previewEmpty")}
      </p>
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
    </motion.div>
  );
}
