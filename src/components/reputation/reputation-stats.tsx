import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PublicPlayerProfile } from "@/lib/reputation/public-profile";
import { percent } from "@/lib/reputation/score";

/** Một dòng nhãn và giá trị; giá trị luôn text-base (≥ 16px). */
export function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1">
      <dt className="text-muted-foreground min-w-0 text-sm break-words">
        {label}
      </dt>
      <dd className="shrink-0 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Khung kính chung của các khối số liệu trên hồ sơ. */
export function StatCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-card/80 rounded-2xl border p-4 shadow-sm backdrop-blur">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Số liệu đến của người chơi (quyết định 12, 13). Tỉ lệ đến chỉ có khi đã có
 * đăng ký được duyệt ở buổi đã qua; trả đúng hạn chỉ khi đã từng bị tính phí.
 * Không có mẫu số thì ẩn dòng, không hiện "0%".
 */
export function ReputationStats({
  attendance: a,
}: {
  attendance: PublicPlayerProfile["attendance"];
}) {
  const t = useTranslations("exchange.reputation");
  const rate = a.approvedPast > 0 ? percent(a.attended, a.approvedPast) : null;
  const paid = a.charged > 0 ? percent(a.paidOnTime, a.charged) : null;
  return (
    <StatCard title={t("statsTitle")}>
      <dl className="divide-y">
        <StatRow
          label={t("statAttended")}
          value={t("valueSessions", { count: a.attended })}
        />
        {rate !== null && (
          <StatRow label={t("statRate")} value={t("valuePct", { pct: rate })} />
        )}
        <StatRow
          label={t("statLateCancels")}
          value={t("valueTimes", { count: a.lateCancels })}
        />
        <StatRow
          label={t("statNoShows")}
          value={t("valueTimes", { count: a.noShows })}
        />
        {paid !== null && (
          <StatRow
            label={t("statPaidOnTime")}
            value={t("valuePct", { pct: paid })}
          />
        )}
      </dl>
    </StatCard>
  );
}

/**
 * Uy tín khi làm host (quyết định 14). Người chưa từng tổ chức hay huỷ buổi
 * nào (`host: null`) không có khối. Phần trăm null nghĩa là chưa đủ người
 * chấm, nên ẩn dòng thay vì hiện 0%.
 */
export function HostStats({ host }: { host: PublicPlayerProfile["host"] }) {
  const t = useTranslations("exchange.reputation");
  if (!host) return null;
  return (
    <StatCard title={t("hostTitle")}>
      <dl className="divide-y">
        <StatRow
          label={t("hostOrganizedLabel")}
          value={t("valueSessions", { count: host.organized })}
        />
        {host.cancelPct !== null && (
          <StatRow
            label={t("hostCancelRate")}
            value={t("valuePct", { pct: host.cancelPct })}
          />
        )}
        {host.asDescribedPct !== null && (
          <StatRow
            label={t("hostAsDescribedLabel")}
            value={t("valuePct", { pct: host.asDescribedPct })}
          />
        )}
        {host.feeAsPromisedPct !== null && (
          <StatRow
            label={t("hostFeeLabel")}
            value={t("valuePct", { pct: host.feeAsPromisedPct })}
          />
        )}
      </dl>
    </StatCard>
  );
}
