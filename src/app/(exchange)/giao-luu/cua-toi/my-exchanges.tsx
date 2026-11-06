"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarSearch,
  MessageCircle,
  Settings2,
  UserRoundX,
} from "lucide-react";
import { unblockMember } from "@/actions/exchange-host";
import type { MyExchanges as MyExchangesData } from "@/actions/exchange-mine";
import { ExchangeCard } from "@/components/exchange/exchange-card";
import { Card, CardContent } from "@/components/ui/card";
import { CHARGEABLE_STATUSES } from "@/lib/exchange/constants";
import { fireAction } from "@/lib/optimistic-action";
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
      href={`/giao-luu/${code}#binh-luan`}
      className="bg-primary/10 text-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium"
    >
      <MessageCircle className="h-5 w-5" aria-hidden />
      {t("newComments", { count })}
    </Link>
  );
}

const CHARGEABLE = new Set<string>(CHARGEABLE_STATUSES);

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
 * là lạc quan: gỡ dòng ngay, lỗi thì trả lại và báo.
 */
export function MyExchanges({
  registrations,
  hosting,
  blocks: initialBlocks,
}: MyExchangesData) {
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
            <Link href="/giao-luu" className={cardLink}>
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
                  href={`/giao-luu/${h.code}/quan-ly`}
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
