import { getSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getSettings } from "@/actions/settings";
import { getApprovedViewer } from "@/lib/member-auth";
import { SessionVoteOptimisticPanel } from "@/components/sessions/session-vote-optimistic-panel";
import { VoteContactInfo } from "@/components/sessions/vote-contact-info";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import { Card, CardContent } from "@/components/ui/card";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTranslations } from "next-intl/server";
import { formatVND } from "@/lib/utils";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";
import { getFundBalance } from "@/lib/fund-calculator";
import { isVoteBlockedByDebt } from "@/lib/fund-core";
import { FundBalanceBanner } from "@/components/finance/fund-balance-banner";

export default async function VoteSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const [session, viewer, t] = await Promise.all([
    getSession(sessionId),
    getApprovedViewer(),
    getTranslations("sessions"),
  ]);

  // Chỉ trang chủ mở public; link vote 1 buổi vẫn cần đăng nhập (scope "chỉ
  // trang chủ"). Có thể mở public sau nếu muốn dùng cho link chia sẻ.
  // Danh sách vote của bất kỳ buổi nào chỉ cho member đã duyệt xem.
  if (viewer.status === "anonymous") redirect("/login");
  if (viewer.status === "blocked") return null;
  const { user } = viewer;

  if (!session) notFound();

  const [votes, members, settings, fund] = await Promise.all([
    getSessionVotes(session.id),
    getActiveMembers(),
    getSettings(),
    getFundBalance(user.memberId),
  ]);

  // Helper canonical (deadline-aware) — khớp gate server-side của submitVote.
  // KHÔNG chỉ check status: tránh controls render enabled quá deadline khi JS
  // tắt / client timer regress (defense-in-depth).
  const isVotingOpen = isVoteOpen({
    status: session.status as SessionStatus,
    voteDeadline: session.voteDeadline ?? null,
  }).open;
  // Link này hay được admin gửi vào nhóm: phải chặn giống trang chủ khi member
  // nợ quá hạn mức (spec 2026-11-06-debt-vote-block-design.md mục 4.2).
  const blockedByDebt =
    isVotingOpen &&
    isVoteBlockedByDebt(fund.balance, settings.voteBlockDebtThreshold);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="flex-1 text-lg font-bold">{t("session")}</h1>
        <CopyLinkButton sessionId={session.id} />
      </div>

      {!isVotingOpen && (
        <Card>
          <CardContent className="text-muted-foreground p-4 text-center">
            {session.status === "cancelled"
              ? t("sessionCancelled")
              : t("sessionCompleted")}
          </CardContent>
        </Card>
      )}

      {blockedByDebt && (
        <div className="space-y-2">
          <FundBalanceBanner balance={fund.balance} memberId={user.memberId} />
          <p className="text-muted-foreground px-1 text-base">
            {t("voteBlockedByDebt", {
              limit: formatVND(settings.voteBlockDebtThreshold),
            })}
          </p>
        </div>
      )}

      <SessionVoteOptimisticPanel
        sessionId={session.id}
        session={{
          date: session.date,
          startTime: session.startTime,
          endTime: session.endTime,
          courtName: session.court?.name,
          courtMapLink: session.court?.mapLink ?? null,
          status: session.status,
        }}
        votes={votes}
        members={members}
        currentMemberId={user?.memberId ?? null}
        isVotingOpen={isVotingOpen && !blockedByDebt}
        voteDeadline={session.voteDeadline}
        adminGuestPlayCount={session.adminGuestPlayCount ?? 0}
        adminGuestDineCount={session.adminGuestDineCount ?? 0}
        maxPlayers={session.maxPlayers ?? 16}
        // Đi qua footerSlot (không phải sibling sau component) để spacer h-28
        // chừa chỗ cho thanh sticky đáy luôn nằm SAU khối liên hệ này — nếu
        // không, thanh sticky (fixed, z-40) đè lên che mất link gọi/mail.
        footerSlot={
          <VoteContactInfo
            hotline={settings.contactHotline}
            email={settings.contactEmail}
          />
        }
      />
    </div>
  );
}
