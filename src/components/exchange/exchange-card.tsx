"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, MapPin, Users } from "lucide-react";
import type { ExchangeCard as ExchangeCardData } from "@/lib/exchange/public-event";
import { SKILL_BADGE_CLASS } from "@/lib/skill-level";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { cn, formatVND } from "@/lib/utils";

const VN_TZ = "Asia/Ho_Chi_Minh";

/** "80K" khi tròn nghìn, còn lại hiện đủ số tiền. */
export function shortMoney(amount: number): string {
  return amount % 1000 === 0 ? `${amount / 1000}K` : formatVND(amount);
}

function whenLabel(startAt: string, endAt: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(startAt));
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day}, ${time.format(new Date(startAt))}-${time.format(new Date(endAt))}`;
}

// Avatar mặc định chọn theo memberId; payload công khai không có id của host
// nên lấy một số ổn định từ tên để cùng một host luôn ra cùng một avatar.
export function nameSeed(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Thẻ một buổi giao lưu trong danh sách tìm kiếm. Cả thẻ là một link (vùng
 * chạm lớn). Không có dữ liệu cá nhân ngoài tên và avatar host, vốn đã công khai.
 */
export function ExchangeCard({ event }: { event: ExchangeCardData }) {
  const t = useTranslations("exchange.search");
  const tSkill = useTranslations("me.skillShort");
  const locale = useLocale();

  const { fee, counts, slotsTotal } = event;
  let feeText: string;
  if (fee.kind === "fixed") {
    feeText =
      fee.male === fee.female
        ? shortMoney(fee.male)
        : t("feeGender", {
            male: shortMoney(fee.male),
            female: shortMoney(fee.female),
          });
  } else if (fee.kind === "split") {
    const amount = shortMoney(fee.estimate.male);
    feeText = t(fee.estimateIsCap ? "feeCap" : "feeAbout", { amount });
  } else {
    feeText = t("feeLocked", { amount: shortMoney(fee.rates.male) });
  }

  const { skillMin, skillMax } = event;
  let skillText: string;
  if (skillMin && skillMax) {
    skillText =
      skillMin === skillMax
        ? tSkill(skillMin)
        : t("skillRange", { min: tSkill(skillMin), max: tSkill(skillMax) });
  } else if (skillMin) {
    skillText = t("skillFrom", { level: tSkill(skillMin) });
  } else if (skillMax) {
    skillText = t("skillUpTo", { level: tSkill(skillMax) });
  } else {
    skillText = t("skillAny");
  }
  const skillKey = skillMin ?? skillMax;

  const filled = Math.max(0, slotsTotal - counts.freeTotal);
  const full = counts.freeTotal <= 0;
  const pct = slotsTotal > 0 ? Math.min(100, (filled / slotsTotal) * 100) : 0;
  // Không biết vị trí người xem (Giao lưu của tôi, trang sân) thì ẩn nhãn, đừng hiện "0,0 km".
  const km =
    event.distanceM === null
      ? null
      : (event.distanceM / 1000).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });

  return (
    <Link
      href={`/giao-luu/${event.code}`}
      className="bg-card/80 hover:bg-accent/40 focus-visible:outline-ring block min-h-11 space-y-3 rounded-2xl border p-4 shadow-sm backdrop-blur transition-colors focus-visible:outline-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-primary flex items-center gap-1.5 text-base font-medium">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
            {whenLabel(event.startAt, event.endAt, locale)}
          </p>
          <h3 className="text-lg leading-snug font-semibold break-words">
            {event.title}
          </h3>
        </div>
        <span className="bg-primary/15 text-primary shrink-0 rounded-full px-3 py-1 text-base font-semibold">
          {feeText}
        </span>
      </div>

      <p className="text-muted-foreground flex items-center gap-1.5 text-base">
        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{event.venue.name}</span>
        {km !== null && (
          <span className="shrink-0">{t("distance", { km })}</span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-sm font-semibold",
            skillKey
              ? SKILL_BADGE_CLASS[skillKey]
              : "bg-muted text-muted-foreground",
          )}
        >
          {skillText}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1.5 font-medium">
            <Users className="h-4 w-4" aria-hidden />
            {t("slotsFilled", { filled, total: slotsTotal })}
          </span>
          <span className="text-muted-foreground text-sm">
            {full
              ? t("slotsFull")
              : counts.freeFemaleOnly > 0
                ? t("femaleSlots", { count: counts.freeFemaleOnly })
                : null}
          </span>
        </div>
        <div
          className="bg-muted h-2 overflow-hidden rounded-full"
          aria-hidden="true"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              full ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <MemberAvatar
          memberId={nameSeed(event.host.name)}
          avatarUrl={event.host.avatarUrl}
          avatarKey={event.host.avatarKey}
          size={28}
        />
        <span className="text-muted-foreground min-w-0 truncate text-base">
          {t("hostedBy", { name: event.host.name })}
        </span>
      </div>
    </Link>
  );
}
