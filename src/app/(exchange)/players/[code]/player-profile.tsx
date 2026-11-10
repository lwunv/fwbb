"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Flag, Search } from "lucide-react";
import { nameSeed } from "@/components/exchange/exchange-card";
import { ReportSheet } from "@/components/exchange/report-sheet";
import { NewBadge } from "@/components/reputation/new-badge";
import { PeerKudos } from "@/components/reputation/peer-kudos";
import {
  HostStats,
  ReputationStats,
} from "@/components/reputation/reputation-stats";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { PublicPlayerProfile } from "@/lib/reputation/public-profile";

/**
 * Hồ sơ công khai: chỉ tên, ảnh, nhãn và số liệu (quyết định 16), không có
 * buổi nào, ở đâu, với ai. Mọi chữ lấy từ payload whitelist
 * `PublicPlayerProfile`.
 */
export function PlayerProfile({
  profile: p,
  canReport,
}: {
  profile: PublicPlayerProfile;
  /** Người xem đã đăng nhập và không phải chính chủ hồ sơ. */
  canReport: boolean;
}) {
  const t = useTranslations("exchange.reputation");
  const tEvent = useTranslations("exchange.event");
  const tSkill = useTranslations("me.skillShort");
  const [reportOpen, setReportOpen] = useState(false);

  const a = p.attendance;
  const isEmpty =
    a.attended === 0 &&
    a.approvedPast === 0 &&
    a.lateCancels === 0 &&
    a.noShows === 0 &&
    p.host === null;

  const self = p.selfSkill ? tSkill(p.selfSkill) : t("skillUnset");
  const skillLine = p.peer.skill
    ? t("skillBoth", {
        self,
        peer: tSkill(p.peer.skill.level),
        count: p.peer.skill.raters,
      })
    : t("skillSelfOnly", { self });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mx-auto w-full max-w-2xl space-y-4"
    >
      <header
        data-testid="profile-header"
        className="bg-card/80 flex items-start gap-4 rounded-2xl border p-4 shadow-sm backdrop-blur"
      >
        <MemberAvatar
          memberId={nameSeed(p.name)}
          avatarUrl={p.avatarUrl}
          avatarKey={p.avatarKey}
          size={64}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-xl font-bold break-words">{p.name}</h1>
          {(p.isNew || p.referred) && (
            <div className="flex flex-wrap gap-2">
              {p.isNew && <NewBadge />}
              {p.referred && (
                <span className="bg-secondary text-secondary-foreground inline-flex min-h-7 items-center rounded-full px-2.5 text-sm font-semibold">
                  {t("referred")}
                </span>
              )}
            </div>
          )}
          <p className="text-muted-foreground text-base break-words">
            {skillLine}
          </p>
        </div>
      </header>

      {isEmpty ? (
        <section className="bg-card/80 flex flex-col items-center gap-3 rounded-2xl border p-6 text-center shadow-sm backdrop-blur">
          <p className="text-base">{t("emptyTitle")}</p>
          <Link
            href="/exchanges"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-base font-semibold transition-transform active:scale-95"
          >
            <Search className="h-4 w-4" aria-hidden />
            {t("findExchanges")}
          </Link>
        </section>
      ) : (
        <>
          <ReputationStats attendance={a} />
          <PeerKudos peer={p.peer} />
        </>
      )}
      <HostStats host={p.host} />

      {canReport && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="text-muted-foreground hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm transition-colors"
            >
              <Flag className="h-4 w-4" aria-hidden />
              {tEvent("report")}
            </button>
          </div>
          <ReportSheet
            open={reportOpen}
            onOpenChange={setReportOpen}
            target={{ type: "player", code: p.code }}
          />
        </>
      )}
    </motion.div>
  );
}
