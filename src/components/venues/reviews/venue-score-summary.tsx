"use client";

import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { VENUE_CRITERIA } from "@/lib/reputation/constants";
import { formatTenths, type VenueScore } from "@/lib/reputation/score";
import { cn } from "@/lib/utils";

/**
 * Điểm sân: số lớn (1/10 điểm, theo locale), sao, số đánh giá và 6 tiêu chí.
 * Dưới 3 đánh giá server trả `overall = null`: khối tổng chỉ hiện "Chưa đủ đánh
 * giá" và số lượng, không có điểm tổng hay điểm trung bình từng tiêu chí. Điểm
 * của từng đánh giá vẫn hiện trong danh sách bên dưới; chỉ phần gộp bị ẩn.
 */
export function VenueScoreSummary({
  summary,
  venueName,
}: {
  summary: VenueScore;
  venueName: string;
}) {
  const t = useTranslations("venueReviews");
  const locale = useLocale();
  const card =
    "bg-card/80 rounded-2xl border p-4 shadow-sm backdrop-blur space-y-4";

  if (summary.overall === null) {
    return (
      <div className={card}>
        <div className="space-y-1">
          <p className="text-base font-semibold">{t("notEnough")}</p>
          <p className="text-muted-foreground text-sm">
            {t("count", { count: summary.count })}
          </p>
        </div>
      </div>
    );
  }

  const score = formatTenths(summary.overall, locale);
  const filled = Math.round(summary.overall / 10);
  return (
    <div className={card}>
      <div className="flex items-center gap-4">
        <p className="text-4xl leading-none font-bold tabular-nums">{score}</p>
        <div className="min-w-0 space-y-1">
          <div
            role="img"
            aria-label={t("overallAria", { score, venue: venueName })}
            className="flex gap-0.5"
          >
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                aria-hidden
                className={cn(
                  "size-5",
                  i <= filled
                    ? "fill-primary text-primary"
                    : "text-muted-foreground/40",
                )}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            {t("count", { count: summary.count })}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {VENUE_CRITERIA.map((c) => {
          const v = summary.criteria[c];
          return (
            <li key={c} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-sm break-words">
                {t(`criteria.${c}`)}
              </span>
              <div className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
                {v !== null && (
                  <motion.div
                    className="bg-primary h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (v / 50) * 100)}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                )}
              </div>
              <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
                {v !== null ? formatTenths(v, locale) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
