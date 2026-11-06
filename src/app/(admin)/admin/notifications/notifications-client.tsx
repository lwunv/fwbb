"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { BellOff, CheckCheck } from "lucide-react";
import type {
  DebtHistoryItem,
  OwingMember,
} from "@/actions/admin-notifications";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { SearchInput } from "@/components/shared/search-input";
import { TabSegment } from "@/components/shared/tab-segment";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import {
  filterHistory,
  filterOwing,
  groupByRecency,
  latestCrossingByMember,
  ledgerTimeToDate,
  notificationHref,
  type OwingLevelFilter,
} from "@/lib/admin-notifications-view";
import {
  isNotificationUnread,
  markAllNotificationsSeen,
  markNotificationRead,
  notificationKey,
  useNotificationReadState,
} from "@/lib/notification-read-state";
import { cn, formatVND } from "@/lib/utils";

const PAGE_STEP = 20;
const TABS = ["activity", "owing"] as const;
const LEVELS = ["all", "over", "under"] as const;
const RANGES = ["7", "30", "90", "all"] as const;
/**
 * Trang thông báo admin kiểu Facebook (yêu cầu user 6/11/2026): 3 ô tổng
 * quan, tab "Hoạt động" (dòng thời gian gom Hôm nay / Hôm qua / Tuần này /
 * Trước đó, chấm xanh cho tin chưa xem) và tab "Đang nợ"; tìm theo tên, lọc,
 * "Xem thêm" 20 dòng/lần. Bộ lọc nằm trên URL (nuqs) để gửi link được.
 */
export function NotificationsClient({
  owing,
  history,
  voteBlockDebtThreshold,
}: {
  owing: OwingMember[];
  history: DebtHistoryItem[];
  voteBlockDebtThreshold: number;
}) {
  const t = useTranslations("adminNotifications");
  const locale = useLocale();
  const dfLocale = getDateFnsLocale(locale);
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("activity"),
  );
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [level, setLevel] = useQueryState(
    "level",
    parseAsStringLiteral(LEVELS).withDefault("all"),
  );
  const [range, setRange] = useQueryState(
    "range",
    parseAsStringLiteral(RANGES).withDefault("30"),
  );
  const [shown, setShown] = useState(PAGE_STEP);
  // Trạng thái đã đọc lưu trên trình duyệt, dùng chung với chuông.
  const readState = useNotificationReadState();
  const [now] = useState(() => new Date());

  const totalDebt = owing.reduce((s, o) => s - o.balance, 0);
  const overCount = owing.filter((o) => o.overLimit).length;

  const owingView = useMemo(
    () => filterOwing(owing, { q, level: level as OwingLevelFilter }),
    [owing, q, level],
  );
  const historyView = useMemo(
    () =>
      filterHistory(history, {
        q,
        rangeDays: range === "all" ? null : Number(range),
        now,
      }),
    [history, q, range, now],
  );
  const isUnread = (h: { memberId: number; txId: number; at: string }) =>
    isNotificationUnread(readState, notificationKey(h), h.at, now);
  const unreadCount = history.filter(isUnread).length;
  const latestByMember = useMemo(
    () => latestCrossingByMember(history),
    [history],
  );

  const resetPaging = () => setShown(PAGE_STEP);
  const groups = groupByRecency(historyView.slice(0, shown), now);
  const owingShown = owingView.slice(0, shown);
  const hasMore =
    tab === "activity" ? historyView.length > shown : owingView.length > shown;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllNotificationsSeen}
            className="text-primary hover:bg-primary/10 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium"
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
            {t("markAllSeen")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t("statOwing"), value: String(owing.length) },
          { label: t("statTotalDebt"), value: formatVND(totalDebt) },
          { label: t("statOverLimit"), value: String(overCount) },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-card/80 border-border/60 rounded-xl border p-3 backdrop-blur"
          >
            <div className="text-muted-foreground text-sm">{s.label}</div>
            <div className="text-lg font-bold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <TabSegment
        variant="rounded"
        value={tab}
        onChange={(v) => {
          void setTab(v);
          resetPaging();
        }}
        options={[
          {
            value: "activity",
            label: t("tabActivity"),
            badge: unreadCount > 0 ? unreadCount : undefined,
          },
          { value: "owing", label: t("tabOwing"), badge: owing.length },
        ]}
        ariaLabel={t("pageTitle")}
      />

      <SearchInput
        value={q}
        onChange={(v) => {
          void setQ(v || null);
          resetPaging();
        }}
        placeholder={t("searchPlaceholder")}
      />

      {tab === "owing" ? (
        <TabSegment
          variant="pills"
          value={level}
          onChange={(v) => {
            void setLevel(v);
            resetPaging();
          }}
          options={[
            { value: "all", label: t("levelAll") },
            { value: "over", label: t("levelOver") },
            { value: "under", label: t("levelUnder") },
          ]}
        />
      ) : (
        <TabSegment
          variant="pills"
          value={range}
          onChange={(v) => {
            void setRange(v);
            resetPaging();
          }}
          options={RANGES.map((r) => ({
            value: r,
            label: r === "all" ? t("rangeAll") : t("rangeDays", { days: r }),
          }))}
        />
      )}

      {tab === "owing" && (
        <p className="text-muted-foreground text-sm">
          {t("limitNote", { limit: formatVND(voteBlockDebtThreshold) })}
        </p>
      )}

      <div className="bg-card/80 border-border/60 overflow-hidden rounded-xl border backdrop-blur">
        {tab === "activity" ? (
          groups.length === 0 ? (
            range !== "all" && !q ? (
              // Lọc theo ngày mà trống: KHÔNG nói "chưa ai từng âm quỹ".
              <EmptyState
                text={t("historyEmptyRange", { days: range })}
                action={{
                  label: t("rangeAll"),
                  onClick: () => {
                    void setRange("all");
                    resetPaging();
                  },
                }}
              />
            ) : (
              <EmptyState text={q ? t("noMatch") : t("historyEmpty")} />
            )
          ) : (
            groups.map((g) => (
              <section key={g.key}>
                <h2 className="text-muted-foreground px-4 pt-3 pb-1 text-sm font-semibold">
                  {t(`group.${g.key}`)}
                </h2>
                <ul>
                  <AnimatePresence initial={false}>
                    {g.items.map((h) => {
                      const unread = isUnread(h);
                      return (
                        <motion.li
                          key={`${h.memberId}-${h.txId}`}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={cn(unread && "bg-primary/[0.06]")}
                        >
                          <Link
                            href={notificationHref(h.name)}
                            onClick={() =>
                              markNotificationRead(notificationKey(h))
                            }
                            className="hover:bg-muted/60 flex items-start gap-3 px-4 py-3 transition-colors"
                          >
                            <MemberAvatar
                              memberId={h.memberId}
                              avatarKey={h.avatarKey}
                              avatarUrl={h.avatarUrl}
                              size={44}
                              className="shrink-0"
                            />
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="text-base leading-snug">
                                <span className="font-semibold">{h.name}</span>{" "}
                                {t("crossedNegative")}
                              </p>
                              {h.description && (
                                // Trong link: xuống tối đa 2 dòng thay vì cắt cụt
                                // (không lồng nút xem-đủ vào trong link).
                                <p className="text-muted-foreground line-clamp-2 text-sm break-words">
                                  {h.description}
                                </p>
                              )}
                              <p className="text-sm tabular-nums">
                                {t("historyItem", {
                                  before: formatVND(h.balanceBefore),
                                  after: formatVND(h.balanceAfter),
                                })}
                              </p>
                              <time
                                dateTime={ledgerTimeToDate(h.at).toISOString()}
                                className={cn(
                                  "text-sm",
                                  unread
                                    ? "text-primary font-semibold"
                                    : "text-muted-foreground",
                                )}
                              >
                                {formatDistanceToNow(ledgerTimeToDate(h.at), {
                                  addSuffix: true,
                                  locale: dfLocale,
                                })}
                              </time>
                            </div>
                            {unread && (
                              <span
                                className="bg-primary mt-4 h-3 w-3 shrink-0 rounded-full"
                                aria-label={t("unread")}
                              />
                            )}
                          </Link>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </section>
            ))
          )
        ) : owingShown.length === 0 ? (
          <EmptyState text={q || level !== "all" ? t("noMatch") : t("empty")} />
        ) : (
          <ul className="divide-border/60 divide-y">
            {owingShown.map((o) => (
              <motion.li key={o.memberId} layout>
                <Link
                  href={notificationHref(o.name)}
                  onClick={() => {
                    const latest = latestByMember.get(o.memberId);
                    if (latest) markNotificationRead(notificationKey(latest));
                  }}
                  className="hover:bg-muted/60 flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors"
                >
                  <MemberAvatar
                    memberId={o.memberId}
                    avatarKey={o.avatarKey}
                    avatarUrl={o.avatarUrl}
                    size={44}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-base font-medium break-words">
                      {o.nickname ? `${o.name} (${o.nickname})` : o.name}
                    </p>
                    {o.overLimit && (
                      <span className="border-destructive/40 bg-destructive/10 text-destructive mt-0.5 inline-block rounded border px-1.5 text-sm font-semibold">
                        {t("overLimit")}
                      </span>
                    )}
                  </div>
                  <span className="text-destructive shrink-0 text-base font-semibold tabular-nums">
                    {formatVND(o.balance)}
                  </span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE_STEP)}
          className="bg-muted hover:bg-muted/70 flex min-h-11 w-full items-center justify-center rounded-xl text-base font-medium"
        >
          {t("loadMore")}
        </button>
      )}
    </div>
  );
}

function EmptyState({
  text,
  action,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <BellOff className="text-muted-foreground h-8 w-8" aria-hidden />
      <p className="text-muted-foreground text-base">{text}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="border-border hover:bg-muted min-h-11 rounded-lg border px-4 text-base font-medium"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
