"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { AnimatePresence, motion } from "framer-motion";
import { SlidersHorizontal } from "lucide-react";
import { SKILL_LEVELS } from "@/lib/skill-level";
import { cn } from "@/lib/utils";
import { shortMoney } from "@/components/exchange/exchange-card";

export const TIMES_OF_DAY = ["morning", "afternoon", "evening"] as const;
const FEE_STEPS = [50_000, 100_000, 150_000, 200_000] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const filterParsers = {
  d: parseAsString,
  t: parseAsStringLiteral(TIMES_OF_DAY),
  skill: parseAsStringLiteral(SKILL_LEVELS),
  slot: parseAsBoolean,
  nu: parseAsBoolean,
  fee: parseAsInteger,
};

/**
 * Bộ lọc nằm trong URL (chia sẻ được). Chỉ giữ giá trị hợp lệ: ngày sai định
 * dạng hay phí không dương bị bỏ, để không gửi rác lên server.
 */
export function useExchangeFilters() {
  const [raw, setRaw] = useQueryStates(filterParsers);
  const filters = {
    date: raw.d && DATE_RE.test(raw.d) ? raw.d : undefined,
    timeOfDay: raw.t ?? undefined,
    skill: raw.skill ?? undefined,
    hasSlot: raw.slot === true ? true : undefined,
    hasFemaleSlot: raw.nu === true ? true : undefined,
    maxFee: raw.fee !== null && raw.fee > 0 ? raw.fee : undefined,
  };
  const activeCount = Object.values(filters).filter(
    (v) => v !== undefined,
  ).length;
  return {
    filters,
    activeCount,
    set: setRaw,
    clear: () =>
      setRaw({
        d: null,
        t: null,
        skill: null,
        slot: null,
        nu: null,
        fee: null,
      }),
  };
}

export type ExchangeFilterState = ReturnType<typeof useExchangeFilters>;

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-full border px-4 text-base transition-colors",
        on
          ? "bg-primary/15 border-primary text-primary font-medium"
          : "bg-card/80 hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** Nút "Bộ lọc" mở rộng ra bảng chip; số bộ lọc đang bật hiện ngay trên nút. */
export function ExchangeFilters({ state }: { state: ExchangeFilterState }) {
  const t = useTranslations("exchange.search");
  const tSkill = useTranslations("me.skillShort");
  const [open, setOpen] = useState(false);
  const { filters, activeCount, set, clear } = state;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="bg-card/80 inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-medium"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          {activeCount > 0
            ? t("filtersWithCount", { count: activeCount })
            : t("filters")}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-primary min-h-11 px-2 text-base"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-card/80 space-y-4 rounded-2xl border p-4 backdrop-blur">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t("date")}</span>
                <input
                  type="date"
                  value={filters.date ?? ""}
                  onChange={(e) => set({ d: e.target.value || null })}
                  className="bg-background min-h-11 w-full rounded-lg border px-3 text-base"
                />
              </label>

              <div
                role="group"
                aria-label={t("timeOfDay")}
                className="flex flex-wrap gap-2"
              >
                <Chip on={!filters.timeOfDay} onClick={() => set({ t: null })}>
                  {t("anyTime")}
                </Chip>
                {TIMES_OF_DAY.map((v) => (
                  <Chip
                    key={v}
                    on={filters.timeOfDay === v}
                    onClick={() => set({ t: v })}
                  >
                    {t(v)}
                  </Chip>
                ))}
              </div>

              <div
                role="group"
                aria-label={t("skill")}
                className="flex flex-wrap gap-2"
              >
                <Chip on={!filters.skill} onClick={() => set({ skill: null })}>
                  {t("anySkill")}
                </Chip>
                {SKILL_LEVELS.map((v) => (
                  <Chip
                    key={v}
                    on={filters.skill === v}
                    onClick={() => set({ skill: v })}
                  >
                    {tSkill(v)}
                  </Chip>
                ))}
              </div>

              <div
                role="group"
                aria-label={t("maxFee")}
                className="flex flex-wrap gap-2"
              >
                <Chip on={!filters.maxFee} onClick={() => set({ fee: null })}>
                  {t("anyFee")}
                </Chip>
                {FEE_STEPS.map((v) => (
                  <Chip
                    key={v}
                    on={filters.maxFee === v}
                    onClick={() => set({ fee: v })}
                  >
                    {t("feeUpTo", { amount: shortMoney(v) })}
                  </Chip>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Chip
                  on={filters.hasSlot === true}
                  onClick={() => set({ slot: filters.hasSlot ? null : true })}
                >
                  {t("hasSlot")}
                </Chip>
                <Chip
                  on={filters.hasFemaleSlot === true}
                  onClick={() =>
                    set({ nu: filters.hasFemaleSlot ? null : true })
                  }
                >
                  {t("hasFemaleSlot")}
                </Chip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
