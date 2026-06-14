"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { formatSessionDate, ymdInVN } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { SessionVoteOptimisticPanel } from "./session-vote-optimistic-panel";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
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
  votes: VoteWithMember[];
}

/**
 * Trang user: chip selector các thứ cầu lông CÓ buổi trong tuần đích (T2/4/6
 * theo setting; T7/CN hiển tuần sau). Click chip → active → hiện buổi đó. Buổi
 * đang mở → vote ngay; buổi đã chơi xong → chip muted + chỉ xem (panel tự ẩn
 * nút vote khi isVotingOpen=false).
 */
export function WeekSessionsView({
  sessions,
  members,
  currentMemberId,
}: {
  sessions: WeekSessionItem[];
  members: Member[];
  currentMemberId: number | null;
}) {
  const locale = useLocale() as AppLocale;
  const today = ymdInVN();

  // Mặc định chọn buổi sắp tới gần nhất (date >= hôm nay); nếu cả tuần đã qua
  // thì chọn buổi cuối.
  const defaultId =
    sessions.find((s) => s.date >= today)?.id ??
    sessions[sessions.length - 1]?.id ??
    null;
  const [selectedId, setSelectedId] = useState<number | null>(defaultId);

  if (sessions.length === 0) return null;
  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0];

  return (
    <div className="space-y-4">
      {/* Chip selector — chỉ các thứ cầu lông có buổi trong tuần */}
      <div className="flex flex-wrap gap-2">
        {sessions.map((s) => {
          const active = s.id === selected.id;
          const done = s.status === "completed" || s.status === "cancelled";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              aria-pressed={active}
              className={cn(
                "min-h-11 rounded-xl border px-4 py-2 text-sm font-medium capitalize transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : done
                    ? "bg-muted text-muted-foreground border-transparent opacity-70"
                    : "bg-card hover:bg-accent",
              )}
            >
              {formatSessionDate(s.date, "weekdayName", locale)}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <CopyLinkButton sessionId={selected.id} />
      </div>

      <SessionVoteOptimisticPanel
        key={selected.id}
        sessionId={selected.id}
        session={{
          date: selected.date,
          startTime: selected.startTime,
          endTime: selected.endTime,
          courtName: selected.courtName,
          courtMapLink: selected.courtMapLink,
          status: selected.status,
        }}
        votes={selected.votes}
        members={members}
        currentMemberId={currentMemberId}
        isVotingOpen={selected.isVotingOpen}
        voteDeadline={selected.voteDeadline}
      />
    </div>
  );
}
