"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Flag,
  MapPin,
  Navigation,
  Share2,
  Tag,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { ViewerExtras } from "@/actions/exchange-read";
import { ExchangePayQR } from "@/components/exchange/exchange-pay-qr";
import { nameSeed, shortMoney } from "@/components/exchange/exchange-card";
import { CommentSection } from "@/components/exchange/comments/comment-section";
import { ReportSheet } from "@/components/exchange/report-sheet";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { PublicExchangeEvent } from "@/lib/exchange/public-event";
import type { HeadRates } from "@/lib/exchange-fee";
import type { Gender } from "@/lib/gender";
import { SKILL_BADGE_CLASS } from "@/lib/skill-level";
import { cn, formatVND } from "@/lib/utils";
import { MyRegistrationBar, type RegState } from "./my-registration-bar";
import { RegisterSheet } from "./register-sheet";

const VN_TZ = "Asia/Ho_Chi_Minh";

function whenLabel(startAt: string, endAt: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(startAt));
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: VN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day}, ${time.format(new Date(startAt))}-${time.format(new Date(endAt))}`;
}

function agoLabel(iso: string, locale: string): string {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffMin);
  if (abs < 60) return rtf.format(Math.min(diffMin, 0), "minute");
  if (abs < 60 * 24) return rtf.format(Math.trunc(diffMin / 60), "hour");
  return rtf.format(Math.trunc(diffMin / 1440), "day");
}

const STATUS_CHIP: Record<PublicExchangeEvent["status"], string> = {
  open: "bg-primary/15 text-primary",
  full: "bg-destructive/15 text-destructive",
  locked: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  done: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/15 text-destructive",
};

const STATUS_KEY = {
  open: "statusOpen",
  full: "statusFull",
  locked: "statusLocked",
  done: "statusDone",
  cancelled: "statusCancelled",
} as const;

/** Chỉ cho link http(s): giá trị do host nhập, không để `javascript:` lọt vào href. */
function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw.trim()) ? raw.trim() : null;
}

/**
 * Bài buổi giao lưu kiểu Reddit. Mọi số tiền (`remaining`, `refundDue`) do
 * server tính sẵn trong `viewer.myRegistration`; component này chỉ hiển thị.
 * Liên hệ, link nhóm Zalo và tên người tham gia chỉ có trong `viewer` khi là
 * host hoặc người đã được duyệt, nên ở đây chỉ cần render cái có sẵn.
 */
export function EventPost({
  event,
  viewer,
  memberGender,
}: {
  event: PublicExchangeEvent;
  viewer: ViewerExtras;
  memberGender: Gender | null;
}) {
  const t = useTranslations("exchange.event");
  const tSearch = useTranslations("exchange.search");
  const tSkill = useTranslations("me.skillShort");
  const locale = useLocale();
  const router = useRouter();

  const serverReg: RegState | null = viewer.myRegistration
    ? {
        status: viewer.myRegistration.status,
        waitlistPos: viewer.myRegistration.waitlistPos,
      }
    : null;
  const [reg, setReg] = useState<RegState | null>(serverReg);
  // Đồng bộ lại khi server trả props mới (sau `router.refresh()` hoặc hoàn lại).
  const syncKey = `${serverReg?.status ?? ""}:${serverReg?.waitlistPos ?? ""}`;
  useEffect(() => {
    setReg(serverReg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const { fee, counts, slotsTotal } = event;
  const my = viewer.myRegistration;

  function ratesText(r: HeadRates): string {
    return r.male === r.female
      ? formatVND(r.male)
      : tSearch("feeGender", {
          male: shortMoney(r.male),
          female: shortMoney(r.female),
        });
  }

  let feeLines: string[];
  if (fee.kind === "fixed") {
    feeLines = [
      fee.male === fee.female
        ? t("feePerHead", { amount: formatVND(fee.male) })
        : tSearch("feeGender", {
            male: shortMoney(fee.male),
            female: shortMoney(fee.female),
          }),
    ];
  } else if (fee.kind === "split") {
    feeLines = [
      t(fee.estimateIsCap ? "feeCapPerHead" : "feeAboutPerHead", {
        amount: ratesText(fee.estimate),
      }),
    ];
    if (fee.currentHeads > 0 && fee.current.male !== fee.estimate.male) {
      feeLines.push(t("feeCurrentNow", { amount: ratesText(fee.current) }));
    }
  } else {
    feeLines = [t("feeLockedPerHead", { amount: ratesText(fee.rates) })];
  }

  const { skillMin, skillMax } = event;
  const skillText =
    skillMin && skillMax
      ? skillMin === skillMax
        ? tSkill(skillMin)
        : tSearch("skillRange", {
            min: tSkill(skillMin),
            max: tSkill(skillMax),
          })
      : skillMin
        ? tSearch("skillFrom", { level: tSkill(skillMin) })
        : skillMax
          ? tSearch("skillUpTo", { level: tSkill(skillMax) })
          : tSearch("skillAny");
  const skillKey = skillMin ?? skillMax;

  const filled = Math.max(0, slotsTotal - counts.freeTotal);
  const full = counts.freeTotal <= 0;
  const pct = slotsTotal > 0 ? Math.min(100, (filled / slotsTotal) * 100) : 0;
  const extraAvatars = Math.max(0, filled - event.attendeeAvatars.length);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t("shareCopied"));
      }
    } catch {
      // Người dùng đóng hộp thoại chia sẻ hoặc trình duyệt chặn clipboard: không phải lỗi cần báo.
    }
  }

  const hostContactHref = safeHref(viewer.hostContact);
  const zaloHref = safeHref(viewer.zaloGroupLink);
  const hasPayout =
    !!viewer.payout?.bankBin &&
    !!viewer.payout.accountNo &&
    !!viewer.payout.accountName;
  const sending = reg?.status === "sending";

  function payBlock() {
    if (!my || sending) return null;
    const memo = `GL ${event.code} ${my.id}`;
    const qr = (amount: number) =>
      hasPayout ? (
        <ExchangePayQR
          bankBin={viewer.payout!.bankBin!}
          accountNo={viewer.payout!.accountNo!}
          accountName={viewer.payout!.accountName!}
          amount={amount}
          memo={memo}
        />
      ) : (
        <p className="text-base font-medium">{t("payDirect")}</p>
      );

    if (my.refundDue > 0) {
      return (
        <p className="text-base font-medium">
          {t("refundLine", { amount: formatVND(my.refundDue) })}
        </p>
      );
    }
    if (my.status === "pending" && event.depositAmount > 0 && !my.depositPaid) {
      return (
        <div className="space-y-3">
          <p className="text-base font-medium">
            {t("payDeposit", { amount: formatVND(event.depositAmount) })}
          </p>
          {qr(event.depositAmount)}
        </div>
      );
    }
    if (my.remaining > 0) {
      return (
        <div className="space-y-3">
          <p className="text-base font-medium">
            {t("payRemaining", { amount: formatVND(my.remaining) })}
          </p>
          {qr(my.remaining)}
        </div>
      );
    }
    // Chỉ "Đã trả" khi không còn thiếu: trả đủ phí cũ rồi phí chốt lại tăng
    // thì vẫn phải hiện QR cho phần chênh ở trên.
    if (my.paid) {
      return (
        <p className="text-primary flex items-center gap-2 text-base font-semibold">
          <Check className="h-5 w-5" aria-hidden />
          {t("paidLine")}
        </p>
      );
    }
    return null;
  }
  const pay = payBlock();

  const section = "bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur";
  const chip =
    "bg-muted text-foreground inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-base";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-28 sm:pb-0">
      <Link
        href="/exchanges"
        className="text-muted-foreground inline-flex min-h-11 items-center gap-1 text-base"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </Link>

      <motion.article
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-4"
      >
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <MemberAvatar
              memberId={nameSeed(event.host.name)}
              avatarUrl={event.host.avatarUrl}
              avatarKey={event.host.avatarKey}
              size={32}
            />
            <p className="min-w-0 flex-1 truncate text-base">
              <span className="font-semibold">{event.host.name}</span>
              <span
                className="text-muted-foreground"
                suppressHydrationWarning
              >{` · ${agoLabel(event.createdAt, locale)}`}</span>
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-sm font-semibold",
                STATUS_CHIP[event.status],
              )}
            >
              {t(STATUS_KEY[event.status])}
            </span>
            {event.hidden && (
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-3 py-1 text-sm font-semibold">
                {t("hiddenBadge")}
              </span>
            )}
          </div>
          <h1 className="text-2xl leading-snug font-bold break-words">
            {event.title}
          </h1>
          <div className="flex flex-wrap gap-2">
            <span className={chip}>
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
              {whenLabel(event.startAt, event.endAt, locale)}
            </span>
            <Link
              href={`/venues/${event.venue.id}`}
              className={cn(chip, "hover:bg-accent min-h-11")}
            >
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              {event.venue.name}
            </Link>
            <span
              className={cn(
                chip,
                skillKey && SKILL_BADGE_CLASS[skillKey],
                "border",
              )}
            >
              {skillText}
            </span>
            {event.shuttleType && (
              <span className={chip}>
                <Tag className="h-4 w-4 shrink-0" aria-hidden />
                {t("shuttle", { type: event.shuttleType })}
              </span>
            )}
          </div>
        </header>

        {event.description && (
          <p className="text-base leading-relaxed break-words whitespace-pre-wrap">
            {event.description}
          </p>
        )}

        <section className={section} aria-label={t("feeTitle")}>
          <h2 className="text-lg font-semibold">{t("feeTitle")}</h2>
          {feeLines.map((l) => (
            <p key={l} className="text-base">
              {l}
            </p>
          ))}
          {fee.kind === "locked" && fee.aboveEstimate && (
            <p className="text-base font-medium text-amber-700 dark:text-amber-300">
              {t("feeAboveEstimate")}
            </p>
          )}
          {event.depositAmount > 0 && (
            <p className="text-muted-foreground text-base">
              {t("depositLine", { amount: formatVND(event.depositAmount) })}
            </p>
          )}
        </section>

        <section className={section} aria-label={t("slotsTitle")}>
          <div className="flex items-center justify-between gap-2 text-base">
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">
              <Users className="h-5 w-5" aria-hidden />
              {t("slotsLine", { filled, total: slotsTotal })}
            </h2>
            <span className="text-muted-foreground text-base">
              {full
                ? tSearch("slotsFull")
                : counts.freeFemaleOnly > 0
                  ? tSearch("femaleSlots", { count: counts.freeFemaleOnly })
                  : null}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={slotsTotal}
            aria-valuenow={filled}
            className="bg-muted h-2 overflow-hidden rounded-full"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                full ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          {viewer.attendees ? (
            <ul className="space-y-2">
              {viewer.attendees.map((a, i) => (
                <li key={`${a.name}-${i}`} className="flex items-center gap-2">
                  <MemberAvatar
                    memberId={nameSeed(a.name)}
                    avatarUrl={a.avatarUrl}
                    avatarKey={a.avatarKey}
                    size={32}
                  />
                  <span className="min-w-0 truncate text-base">{a.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center">
              {event.attendeeAvatars.map((a, i) => (
                <MemberAvatar
                  key={i}
                  memberId={i + 1}
                  avatarUrl={a.avatarUrl}
                  avatarKey={a.avatarKey}
                  size={32}
                  className="border-background -ml-2 border-2 first:ml-0"
                />
              ))}
              {extraAvatars > 0 && (
                <span className="bg-muted -ml-2 flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold">
                  {t("attendeesMore", { count: extraAvatars })}
                </span>
              )}
            </div>
          )}
        </section>

        {(viewer.hostContact || zaloHref) && (
          <section className={section} aria-label={t("contactTitle")}>
            <h2 className="text-lg font-semibold">{t("contactTitle")}</h2>
            {viewer.hostContact &&
              (hostContactHref ? (
                <a
                  href={hostContactHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary text-base break-all underline"
                >
                  {viewer.hostContact}
                </a>
              ) : (
                <p className="text-base break-all">{viewer.hostContact}</p>
              ))}
            {zaloHref && (
              <a
                href={zaloHref}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-secondary text-secondary-foreground inline-flex min-h-11 items-center rounded-xl px-4 text-base font-medium"
              >
                {t("zaloGroup")}
              </a>
            )}
          </section>
        )}

        {pay && (
          <section className={section} aria-label={t("payTitle")}>
            <h2 className="text-lg font-semibold">{t("payTitle")}</h2>
            {pay}
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${event.venue.lat},${event.venue.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-secondary text-secondary-foreground inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
          >
            <Navigation className="h-4 w-4" aria-hidden />
            {t("directions")}
          </a>
          <button
            type="button"
            onClick={share}
            className="bg-secondary text-secondary-foreground inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            {t("share")}
          </button>
          {viewer.role !== "guest" && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="text-muted-foreground inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
            >
              <Flag className="h-4 w-4" aria-hidden />
              {t("report")}
            </button>
          )}
        </div>

        <div id="comments">
          <CommentSection
            code={event.code}
            signedIn={viewer.role !== "guest"}
            eventId={viewer.hostEventId}
          />
        </div>
      </motion.article>

      <MyRegistrationBar
        event={event}
        viewer={viewer}
        reg={reg}
        onChange={setReg}
        onRegister={() => setRegisterOpen(true)}
      />

      {viewer.role === "member" && (
        <RegisterSheet
          open={registerOpen}
          onOpenChange={setRegisterOpen}
          event={event}
          viewer={viewer}
          memberGender={memberGender}
          onOptimistic={() => setReg({ status: "sending", waitlistPos: null })}
          onRollback={() => setReg(serverReg)}
          onRegistered={(r) => {
            setReg({ status: r.status, waitlistPos: r.waitlistPos });
            router.refresh();
          }}
        />
      )}
      {viewer.role !== "guest" && (
        <ReportSheet
          open={reportOpen}
          onOpenChange={setReportOpen}
          code={event.code}
        />
      )}
    </div>
  );
}
