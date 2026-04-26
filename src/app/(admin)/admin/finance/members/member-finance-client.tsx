"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Search, ChevronLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK, cn } from "@/lib/utils";
import { usePolling } from "@/lib/use-polling";
import type { MemberFinanceRow } from "@/actions/finance";
import { Badge } from "@/components/ui/badge";

type Props = { rows: MemberFinanceRow[] };

export function MemberFinanceClient({ rows }: Props) {
  const t = useTranslations("finance");
  const tCommon = useTranslations("common");
  const tVoting = useTranslations("voting");
  usePolling();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.memberName.toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.outstanding += r.totalOutstanding;
        acc.pending += r.totalPendingReview;
        acc.paid += r.totalPaid;
        return acc;
      },
      { outstanding: 0, pending: 0, paid: 0 },
    );
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href="/admin/finance"
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg py-2 pr-2 text-sm transition-colors"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {t("backToFinance")}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">
            {t("memberSummaryTitle")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("memberCount", { count: rows.length })}
          </p>
        </div>
      </div>

      <Card className="bg-card/80 border backdrop-blur">
        <CardContent className="p-4">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div>
              <div className="text-muted-foreground text-sm">
                {t("colStillOwed")}
              </div>
              <div className="text-destructive text-lg font-semibold tabular-nums">
                {formatK(totals.outstanding)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-sm">
                {t("colAwaitingAdmin")}
              </div>
              <div className="text-lg font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                {formatK(totals.pending)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-sm">
                {t("colCollected")}
              </div>
              <div className="text-lg font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                {formatK(totals.paid)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchMemberPlaceholder")}
          className="border-border bg-background focus:ring-primary h-12 w-full rounded-xl border pr-4 pl-11 text-base outline-none focus:ring-1"
          type="search"
          autoComplete="off"
        />
      </div>

      <ul className="space-y-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((r) => (
            <motion.li
              key={r.memberId}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              <Card className="bg-card/80 overflow-hidden border backdrop-blur">
                <CardContent className="p-4">
                  <div className="flex min-h-11 items-center gap-3">
                    <MemberAvatar
                      memberId={r.memberId}
                      avatarKey={r.memberAvatarKey}
                      avatarUrl={r.memberAvatarUrl}
                      size={44}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-medium">
                          {r.memberName}
                        </span>
                        {!r.isActive && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-sm"
                          >
                            {tCommon("inactive")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="border-border/60 mt-4 grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-3">
                    <div>
                      <div className="text-muted-foreground text-sm">
                        {t("colStillOwed")}
                      </div>
                      <div
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          r.totalOutstanding > 0
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatK(r.totalOutstanding)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-sm">
                        {t("colAwaitingAdmin")}
                      </div>
                      <div
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          r.totalPendingReview > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatK(r.totalPendingReview)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-sm">
                        {t("colCollected")}
                      </div>
                      <div
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          r.totalPaid > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatK(r.totalPaid)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {filtered.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-base">
          {rows.length === 0 ? tVoting("noMembers") : t("noMemberMatch")}
        </p>
      )}
    </div>
  );
}
