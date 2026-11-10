"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarSearch,
  Loader2,
  MessageCircle,
  Settings2,
  Share2,
  ShieldAlert,
  Star,
  UserRound,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { toast } from "sonner";
import { unblockMember } from "@/actions/exchange-host";
import type { MyExchanges as MyExchangesData } from "@/actions/exchange-mine";
import { ensureMyPublicCode } from "@/actions/referrals";
import { ExchangeCard } from "@/components/exchange/exchange-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  CHARGEABLE_STATUSES,
  NEW_ACCOUNT_MAX_WAITING,
  RL_COMMENT_DAY_NEW,
} from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
import { REFERRAL_MIN_ATTENDED } from "@/lib/reputation/constants";
import { formatVND } from "@/lib/utils";

const cardLink =
  "bg-primary text-primary-foreground flex min-h-12 w-full items-center justify-center rounded-xl px-6 text-base font-medium sm:w-auto";

type StatusKey =
  | "statusPending"
  | "statusApproved"
  | "statusWaitlist"
  | "statusRejected"
  | "statusCancelled"
  | "statusLateCancelled"
  | "statusNoShow";

/** Huy hiệu dẫn thẳng tới khu bình luận; chỉ hiện khi có bình luận chưa đọc. */
function NewCommentsBadge({ code, count }: { code: string; count: number }) {
  const t = useTranslations("exchange.mine");
  if (count <= 0) return null;
  return (
    <Link
      href={`/exchanges/${code}#comments`}
      className="bg-primary/10 text-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium"
    >
      <MessageCircle className="h-5 w-5" aria-hidden />
      {t("newComments", { count })}
    </Link>
  );
}

const CHARGEABLE = new Set<string>(CHARGEABLE_STATUSES);

/** Trạng thái giới thiệu của chính người xem, server đã định dạng ngày khoá. */
export type MyReferralCard = {
  limited: boolean;
  eligible: boolean;
  used: number;
  limit: number;
  /** `dd/MM/yyyy` giờ Việt Nam khi đang bị khoá giới thiệu. */
  blockedDate: string | null;
};

/**
 * Thẻ cho nick mới: nói rõ đang bị giới hạn gì và cho chia sẻ hồ sơ để người
 * quen mở ra giới thiệu. Mã hồ sơ chỉ được tạo khi bấm chia sẻ (quyết định 50).
 */
function NewcomerCard() {
  const t = useTranslations("exchange.reputation.referral");
  const [sharing, setSharing] = useState(false);

  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await ensureMyPublicCode();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const url = `${window.location.origin}/players/${res.code}`;
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: t("share"), url });
          return;
        } catch (err) {
          // Người dùng tự đóng bảng chia sẻ: không phải lỗi, không chép link.
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("shareFailed"));
    } finally {
      setSharing(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 backdrop-blur">
      <p className="flex gap-2 text-base">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden
        />
        <span>
          {t("limitedCard", {
            pending: NEW_ACCOUNT_MAX_WAITING,
            comments: RL_COMMENT_DAY_NEW.limit,
            sessions: REFERRAL_MIN_ATTENDED,
          })}
        </span>
      </p>
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={share}
        disabled={sharing}
        className="bg-primary text-primary-foreground flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold disabled:opacity-70 sm:w-auto"
      >
        {sharing ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <Share2 className="h-5 w-5" aria-hidden />
        )}
        {t("share")}
      </motion.button>
    </section>
  );
}

/** Thẻ cho người giới thiệu được: lượt đã dùng trong tháng và ngày hết khoá. */
function ReferrerCard({ r }: { r: MyReferralCard }) {
  const t = useTranslations("exchange.reputation.referral");
  return (
    <section className="bg-card/80 space-y-1 rounded-2xl border p-4 backdrop-blur">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <UserRoundCheck className="text-primary h-5 w-5" aria-hidden />
        {t("title")}
      </h2>
      {r.eligible && (
        <p className="text-base">
          {t("used", { used: r.used, limit: r.limit })}
        </p>
      )}
      {r.blockedDate && (
        <p className="text-destructive text-base font-medium">
          {t("blocked", { date: r.blockedDate })}
        </p>
      )}
    </section>
  );
}

const STATUS_KEY: Record<string, StatusKey> = {
  pending: "statusPending",
  approved: "statusApproved",
  waitlist: "statusWaitlist",
  rejected: "statusRejected",
  cancelled: "statusCancelled",
  late_cancelled: "statusLateCancelled",
  no_show: "statusNoShow",
};

/**
 * Nội dung "Giao lưu của tôi": buổi đã đăng ký (kèm trạng thái và tiền còn
 * thiếu hoặc cần hoàn, lấy từ server), buổi mình mở, và người đã chặn. Bỏ chặn
 * là lạc quan: gỡ dòng ngay, lỗi thì trả lại và báo. Buổi còn chưa chấm có
 * huy hiệu "Chưa đánh giá" mở thẳng phiếu chấm.
 */
export function MyExchanges({
  registrations,
  hosting,
  blocks: initialBlocks,
  myCode = null,
  referral = null,
}: Omit<MyExchangesData, "myCode"> & {
  myCode?: string | null;
  referral?: MyReferralCard | null;
}) {
  const t = useTranslations("exchange.mine");
  const [blocks, setBlocks] = useState(initialBlocks);

  function unblock(b: { id: number; name: string }) {
    const prev = blocks;
    setBlocks((cur) => cur.filter((x) => x.id !== b.id));
    fireAction(
      () => unblockMember({ blockId: b.id }),
      () => setBlocks(prev),
    );
  }

  return (
    <div className="space-y-8">
      {myCode && (
        <Link
          href={`/players/${myCode}`}
          className="bg-card/80 hover:bg-accent flex min-h-11 w-full items-center gap-2 rounded-xl border px-4 text-base font-medium backdrop-blur sm:w-auto"
        >
          <UserRound className="h-5 w-5 shrink-0" aria-hidden />
          {t("myProfile")}
        </Link>
      )}

      {referral?.limited && <NewcomerCard />}
      {referral && (referral.eligible || referral.blockedDate) && (
        <ReferrerCard r={referral} />
      )}

      <section className="space-y-3" aria-labelledby="mine-regs">
        <h2 id="mine-regs" className="text-lg font-semibold">
          {t("registrationsTitle")}
        </h2>
        {registrations.length === 0 ? (
          <div className="bg-card/80 flex flex-col items-center gap-3 rounded-2xl border p-6 text-center backdrop-blur">
            <CalendarSearch
              className="text-muted-foreground h-10 w-10"
              aria-hidden
            />
            <p className="text-base font-medium">{t("emptyRegistrations")}</p>
            <p className="text-muted-foreground text-base">
              {t("emptyRegistrationsBody")}
            </p>
            <Link href="/exchanges" className={cardLink}>
              {t("browse")}
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {registrations.map((r) => {
              const key = STATUS_KEY[r.myStatus];
              return (
                <div key={r.code} className="space-y-2">
                  <ExchangeCard event={r} />
                  <NewCommentsBadge code={r.code} count={r.newComments} />
                  {r.feedback === "todo" && (
                    <Link
                      href={`/exchanges/${r.code}?feedback=1`}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500/15 px-4 text-base font-medium text-amber-700 dark:text-amber-300"
                    >
                      <Star className="h-5 w-5" aria-hidden />
                      {t("feedbackTodo")}
                    </Link>
                  )}
                  <div className="bg-card/80 space-y-1 rounded-xl border px-3 py-2 text-base backdrop-blur">
                    <p className="font-medium">
                      {key ? t(key, { pos: r.waitlistPos ?? 0 }) : r.myStatus}
                    </p>
                    {r.feeAmount !== null &&
                      r.feeAmount > 0 &&
                      CHARGEABLE.has(r.myStatus) &&
                      r.status !== "cancelled" && (
                        <p className="text-muted-foreground">
                          {t("feeLine", { amount: formatVND(r.feeAmount) })}
                        </p>
                      )}
                    {r.remaining > 0 && (
                      <p className="text-destructive font-medium">
                        {t("remainingLine", {
                          amount: formatVND(r.remaining),
                        })}
                      </p>
                    )}
                    {r.refundDue > 0 && (
                      <p className="font-medium">
                        {t("refundLine", { amount: formatVND(r.refundDue) })}
                      </p>
                    )}
                    {r.paid && r.remaining === 0 && r.refundDue === 0 && (
                      <p className="text-muted-foreground">{t("paidLine")}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="mine-hosting">
        <h2 id="mine-hosting" className="text-lg font-semibold">
          {t("hostingTitle")}
        </h2>
        {hosting.length === 0 ? (
          <p className="text-muted-foreground text-base">{t("emptyHosting")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {hosting.map((h) => (
              <div key={h.code} className="space-y-2">
                <ExchangeCard event={h} />
                <NewCommentsBadge code={h.code} count={h.newComments} />
                <Link
                  href={`/exchanges/${h.code}/manage`}
                  className="bg-muted flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium"
                >
                  <Settings2 className="h-5 w-5" aria-hidden />
                  {t("manage")}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="mine-blocks">
        <div>
          <h2 id="mine-blocks" className="text-lg font-semibold">
            {t("blocksTitle")}
          </h2>
          <p className="text-muted-foreground text-base">{t("blocksHint")}</p>
        </div>
        {blocks.length === 0 ? (
          <p className="text-muted-foreground text-base">{t("emptyBlocks")}</p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {blocks.map((b) => (
                <motion.li
                  key={b.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <Card className="bg-card/80 backdrop-blur">
                    <CardContent className="flex items-center gap-3 p-3">
                      <UserRoundX
                        className="text-muted-foreground h-5 w-5 shrink-0"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-base">
                        {b.name}
                      </span>
                      <button
                        type="button"
                        aria-label={t("unblockLabel", { name: b.name })}
                        onClick={() => unblock(b)}
                        className="hover:bg-muted min-h-11 shrink-0 rounded-xl border px-4 text-base font-medium"
                      >
                        {t("unblock")}
                      </button>
                    </CardContent>
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
}
