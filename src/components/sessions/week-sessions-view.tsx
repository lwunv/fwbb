"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { CalendarX2 } from "lucide-react";
import { formatSessionDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { SessionVoteOptimisticPanel } from "./session-vote-optimistic-panel";
import { countVoteParticipation } from "@/lib/vote-list-utils";
import type { AppLocale } from "@/lib/date-fns-locale";
import type { VoteWithMember } from "@/lib/optimistic-votes";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

export interface WeekSessionItem {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  courtName?: string | null;
  courtMapLink?: string | null;
  status: string | null;
  voteDeadline: string | null;
  /** Đã tính sẵn server-side (status + deadline). Buổi xong → false → view-only. */
  isVotingOpen: boolean;
  /** Khách của admin (tính vào tổng người + sức chứa 16). */
  adminGuestPlayCount: number;
  adminGuestDineCount: number;
  votes: VoteWithMember[];
}

export interface WeekDayItem {
  /** YYYY-MM-DD của thứ cầu lông trong tuần đích. */
  date: string;
  /** null = Admin CHƯA tạo buổi cho thứ này (chip vẫn hiện → click ra empty state). */
  session: WeekSessionItem | null;
}

/**
 * Trang user: chip selector ĐỦ các thứ cầu lông của tuần đích (T2/4/6 theo
 * setting; T7/CN → tuần sau) — kể cả ngày Admin chưa tạo buổi. Chip nằm BÊN
 * TRONG thẻ buổi chơi. Click thứ có buổi → vote/xem; thứ chưa có buổi → empty
 * state. Heading + nút "Sao chép link" trên cùng 1 hàng.
 */
export function WeekSessionsView({
  days,
  defaultDate,
  members,
  currentMemberId,
}: {
  days: WeekDayItem[];
  /** Tính server-side (page.tsx) → init hydration-safe (không đọc đồng hồ lúc
   *  render trong client, tránh lệch SSR/hydrate qua mốc nửa đêm). */
  defaultDate: string | null;
  members: Member[];
  currentMemberId: number | null;
}) {
  const locale = useLocale() as AppLocale;
  const tS = useTranslations("sessions");

  // selectedDate giữ lại qua các lần refresh (polling) vì state không re-init.
  const [selectedDate, setSelectedDate] = useState<string | null>(defaultDate);
  // Optimistic votes của buổi ĐANG CHỌN, panel báo lên → badge chip cập nhật
  // NGAY khi vote (không chờ server). Gắn sessionId để chỉ dùng đúng buổi.
  const [optSel, setOptSel] = useState<{
    sessionId: number;
    votes: VoteWithMember[];
  } | null>(null);

  if (days.length === 0) return null;
  const selected = days.find((d) => d.date === selectedDate) ?? days[0];

  // Hàng chip ĐỦ các thứ — render BÊN TRONG thẻ (topSlot/headerSlot). Divider
  // dưới để tách khỏi tiêu đề ngày của buổi (giữ focal point là ngày buổi chơi).
  const chipRow = (
    <div className="border-border/50 flex gap-2 border-b pb-3">
      {days.map((d) => {
        const active = d.date === selected.date;
        const done =
          d.session?.status === "completed" ||
          d.session?.status === "cancelled";
        const noSession = !d.session;
        // Số người đi chơi cầu cho thứ đó = member willPlay (gồm 2-mình) + khách
        // admin. Buổi ĐANG CHỌN dùng optimisticVotes (badge cập nhật ngay khi
        // vote); các buổi khác dùng server votes. Khớp "N người" trên thẻ.
        const votesForChip =
          d.session &&
          d.date === selected.date &&
          optSel?.sessionId === d.session.id
            ? optSel.votes
            : (d.session?.votes ?? []);
        const playCount = d.session
          ? countVoteParticipation(votesForChip).totalPlayers +
            d.session.adminGuestPlayCount
          : 0;
        return (
          <motion.button
            key={d.date}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => setSelectedDate(d.date)}
            aria-pressed={active}
            className={cn(
              "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-medium capitalize transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : noSession
                  ? "text-muted-foreground hover:bg-accent border-dashed"
                  : done
                    ? "bg-muted text-muted-foreground border-transparent"
                    : "bg-card hover:bg-accent",
            )}
          >
            <span className="truncate">
              {formatSessionDate(d.date, "weekdayName", locale)}
            </span>
            {d.session && (
              <span
                title={tS("playCountTitle")}
                // Badge số người chơi: LUÔN màu cam (accent đếm người của app),
                // nổi bật trên cả chip thường (nền tối) lẫn chip active (nền tím).
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-lg bg-orange-500 px-1.5 text-sm font-extrabold text-white tabular-nums shadow-sm"
              >
                {playCount}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      {selected.session ? (
        <SessionVoteOptimisticPanel
          key={selected.session.id}
          headerSlot={chipRow}
          sessionId={selected.session.id}
          session={{
            date: selected.session.date,
            startTime: selected.session.startTime,
            endTime: selected.session.endTime,
            courtName: selected.session.courtName,
            courtMapLink: selected.session.courtMapLink,
            status: selected.session.status,
          }}
          votes={selected.session.votes}
          members={members}
          currentMemberId={currentMemberId}
          isVotingOpen={selected.session.isVotingOpen}
          voteDeadline={selected.session.voteDeadline}
          adminGuestPlayCount={selected.session.adminGuestPlayCount}
          adminGuestDineCount={selected.session.adminGuestDineCount}
          onOptimisticVotesChange={(votes) =>
            setOptSel({ sessionId: selected.session!.id, votes })
          }
        />
      ) : (
        <Card className="bg-card/80 supports-[backdrop-filter]:bg-card/70 backdrop-blur">
          <CardContent className="space-y-4 p-4">
            {chipRow}
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <CalendarX2 className="text-muted-foreground/60 h-12 w-12" />
              <p className="text-base font-semibold capitalize">
                {formatSessionDate(selected.date, "weekdayLong", locale)}
              </p>
              <p className="text-muted-foreground text-sm">
                {tS("noSessionYet")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
