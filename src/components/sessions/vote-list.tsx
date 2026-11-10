"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { SkillChip } from "@/components/shared/skill-chip";
import { TruncatedName } from "@/components/shared/truncated-name";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/shared/empty-state";
import { Users, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { splitMembersByVote } from "@/lib/vote-list-utils";
import type { InferSelectModel } from "drizzle-orm";
import type { votes as votesTable, members as membersTable } from "@/db/schema";

type Vote = InferSelectModel<typeof votesTable> & {
  member: import("@/lib/optimistic-votes").PublicMember;
};

type Member = InferSelectModel<typeof membersTable>;

export function VoteList({
  votes,
  members,
  currentMemberId = null,
}: {
  votes: Vote[];
  members: Member[];
  /** Đã vote tham gia → đưa lên đầu danh sách */
  currentMemberId?: number | null;
}) {
  const t = useTranslations("voting");
  // Danh sách "Chưa vote" mặc định ĐÓNG (accordion) — buổi đông thì phần đã
  // vote là trọng tâm, danh sách chưa vote dài không chiếm chỗ.
  const [notVotedOpen, setNotVotedOpen] = useState(false);
  const voteMap = new Map(votes.map((v) => [v.memberId, v]));

  // "Đã vote" = có dòng với willPlay/willDine; "Chưa vote" = còn lại, GỒM member
  // đã bỏ vote (dòng false/false). Tách ở helper thuần để một chỗ quyết định,
  // tránh lặp lại lỗi "có dòng = đã vote" làm người bỏ vote biến mất cả hai cột.
  const { voted: votedMembers, notVoted: notVotedMembers } = splitMembersByVote(
    members,
    votes,
  );
  const votedSorted =
    currentMemberId != null
      ? [...votedMembers].sort((a, b) => {
          const aSelf = a.id === currentMemberId ? 0 : 1;
          const bSelf = b.id === currentMemberId ? 0 : 1;
          return aSelf - bSelf;
        })
      : votedMembers;

  return (
    <div className="space-y-4">
      {votedSorted.length > 0 && (
        <div className="bg-background/60 dark:bg-background/40 ring-border/60 divide-border/60 divide-y overflow-hidden rounded-xl shadow-sm ring-1">
          <AnimatePresence initial={false}>
            {votedSorted.map((member) => {
              const vote = voteMap.get(member.id)!;
              return (
                <motion.div
                  key={member.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  /* `data-slot` là chỗ bám cho bài e2e đo chiều cao các dòng,
                     đặt theo đúng lối sẵn có của bộ UI trong dự án.

                     `min-h` để MỌI dòng cao bằng nhau: người có biệt danh thì
                     hai dòng chữ, người không có chỉ một, mà cụm badge bên
                     phải lúc một hàng lúc hai. Không chốt chiều cao thì danh
                     sách lệch nhấp nhô. 72px là ca cao nhất: avatar 40 + phần
                     nhãn trình độ thò xuống dưới avatar 14 (kể cả viền) + padding
                     16, dư vài pixel. */
                  data-slot="vote-row"
                  className="flex min-h-[72px] items-center gap-2.5 px-2 py-2 sm:px-3"
                >
                  <AvatarWithSkill member={member} />
                  <div className="min-w-0 flex-1">
                    {/* Biệt danh XUỐNG DÒNG riêng. Tên vẫn có thể bị cắt khi
                        quá dài, chạm/rê vào thì hiện đủ. */}
                    <TruncatedName
                      name={member.name}
                      className="text-base font-semibold"
                    />
                    {member.nickname && (
                      <p className="text-muted-foreground truncate text-sm font-normal">
                        ({member.nickname})
                      </p>
                    )}
                  </div>
                  {/* Cụm badge sang hẳn bên phải và tự xuống thành hai hàng.
                      Chặn bề ngang ở 46% để ba badge không nằm thành một hàng
                      dài đẩy tên member cụt mất. */}
                  <div
                    data-slot="vote-row-badges"
                    className="flex max-w-[46%] shrink-0 flex-wrap justify-end gap-1"
                  >
                    {vote.willPlay && (
                      <Badge
                        variant="votePlay"
                        className="h-6 px-2 py-0 text-sm font-semibold"
                      >
                        🏸 {t("badmintonShort")}
                        {(vote.guestPlayCount ?? 0) > 0 &&
                          ` ${t("plusGuest", { count: vote.guestPlayCount ?? 0 })}`}
                      </Badge>
                    )}
                    {vote.willDine && (
                      <Badge
                        variant="voteDine"
                        className="h-6 px-2 py-0 text-sm font-semibold"
                      >
                        🍻 {t("diningShort")}
                        {(vote.guestDineCount ?? 0) > 0 &&
                          ` ${t("plusGuest", { count: vote.guestDineCount ?? 0 })}`}
                      </Badge>
                    )}
                    {/* Đi 2 người → 1 chip gọn "👫 +2" (badge Cầu/Nhậu giữ sạch). */}
                    {vote.withPartner && (vote.willPlay || vote.willDine) && (
                      <span className="border-primary/40 bg-primary/10 text-primary inline-flex h-6 items-center gap-1 rounded-md border px-2 text-sm font-semibold">
                        👫 +2
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {notVotedMembers.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setNotVotedOpen((v) => !v)}
            aria-expanded={notVotedOpen}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
          >
            <span className="text-muted-foreground text-base font-semibold tracking-wider uppercase">
              {t("notVoted")} ({notVotedMembers.length})
            </span>
            <ChevronDown
              className={cn(
                "text-muted-foreground h-5 w-5 shrink-0 transition-transform",
                notVotedOpen && "rotate-180",
              )}
            />
          </button>
          <AnimatePresence initial={false}>
            {notVotedOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="bg-background/60 dark:bg-background/40 ring-border/60 divide-border/60 divide-y overflow-hidden rounded-xl shadow-sm ring-1">
                  {notVotedMembers.map((member) => (
                    <div
                      key={member.id}
                      /* Cùng lý do min-h như danh sách đã vote: người có biệt
                         danh thì hai dòng, người không có thì một; người có nhãn
                         trình độ dưới avatar thì cao 72px. */
                      className="flex min-h-[72px] items-center gap-2.5 px-2 py-2 opacity-60 sm:px-3"
                    >
                      <AvatarWithSkill member={member} />
                      <div className="min-w-0">
                        <TruncatedName
                          name={member.name}
                          className="text-base font-medium"
                        />
                        {member.nickname && (
                          <p className="text-muted-foreground truncate text-sm font-normal">
                            ({member.nickname})
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {members.length === 0 && (
        <EmptyState icon={Users} title={t("noMembers")} />
      )}
    </div>
  );
}

/**
 * Avatar kèm nhãn trình độ đè lên mép dưới.
 *
 * Cột có bề ngang CỐ ĐỊNH để avatar mọi dòng thẳng một hàng dọc: nếu để cột
 * co giãn theo nhãn thì "Tập chơi" rộng hơn avatar còn "TB" hẹp hơn, avatar bị
 * xô lệch từng dòng. Cột rộng 48px (hơn avatar 40) và nhãn bớt lề trong, để
 * nhãn dài nhất ("Tập chơi", "Learning") chỉ tràn vài pixel, không chạm viền
 * danh sách khi lề dòng hẹp trên điện thoại. Nhãn đặt dưới avatar (không cạnh tên) vì trên điện thoại
 * cột tên chỉ còn vài chữ, nhãn chen vào là tên bị cắt còn "Trần ...".
 */
function AvatarWithSkill({
  member,
}: {
  member: Pick<Member, "id" | "avatarKey" | "avatarUrl" | "skillLevel">;
}) {
  return (
    <div
      data-slot="vote-row-avatar"
      className="flex w-12 shrink-0 flex-col items-center"
    >
      <MemberAvatar
        memberId={member.id}
        avatarKey={member.avatarKey}
        avatarUrl={member.avatarUrl}
        size={40}
      />
      <SkillChip
        level={member.skillLevel}
        withBlurb
        // Nền đặc bên dưới: màu nhãn hơi trong, đè lên avatar thì lộ hình
        // avatar phía sau, chữ khó đọc.
        className="bg-card relative z-10 -mt-2 rounded-md whitespace-nowrap [&>button]:px-1"
      />
    </div>
  );
}
