import {
  getNextSession,
  getLatestCompletedSession,
  getWeekBadmintonDays,
} from "@/actions/sessions";
import { WeekSessionsView } from "@/components/sessions/week-sessions-view";
import { getSessionVotes } from "@/actions/votes";
import { getActiveMembers } from "@/actions/members";
import { getUserFromCookie } from "@/lib/user-identity";
import { getFundBalance } from "@/lib/fund-calculator";
import { SessionCard } from "@/components/sessions/session-card";
import { SessionVoteOptimisticPanel } from "@/components/sessions/session-vote-optimistic-panel";
import { FundBalanceBanner } from "@/components/finance/fund-balance-banner";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { isVoteOpen, type SessionStatus } from "@/lib/session-status";
import { ymdInVN } from "@/lib/date-format";
import { VOTE_BLOCK_DEBT_THRESHOLD } from "@/lib/fund-core";

export default async function HomePage() {
  const [nextSession, weekDays, user, tDashboard] = await Promise.all([
    getNextSession(),
    getWeekBadmintonDays(),
    getUserFromCookie(),
    getTranslations("dashboard"),
  ]);

  const members = await getActiveMembers();

  // Merged Quỹ + Nợ model: only one number matters per user — the fund
  // balance. Negative = đang nợ, zero = hết quỹ, positive = còn quỹ.
  let userFundBalance = 0;
  if (user) {
    userFundBalance = (await getFundBalance(user.memberId)).balance;
  }
  // Nợ dưới VOTE_BLOCK_DEBT_THRESHOLD (100K) vẫn cho vote bình thường — chỉ
  // chặn vote, ưu tiên màn thanh toán khi nợ đã đủ lớn (quyết định 2026-07-06).
  const hasBlockingDebt = userFundBalance <= -VOTE_BLOCK_DEBT_THRESHOLD;

  // Còn nợ đủ lớn → ưu tiên buổi đã chơi gần đây + thanh toán (không vote)
  if (nextSession && user && hasBlockingDebt) {
    const latestSession = await getLatestCompletedSession();

    return (
      <div className="mx-auto max-w-lg space-y-6">
        <AutoRefresh />
        <FundBalanceBanner balance={userFundBalance} memberId={user.memberId} />
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          {latestSession ? (
            <SessionCard
              date={latestSession.date}
              startTime={latestSession.startTime}
              endTime={latestSession.endTime}
              courtName={latestSession.court?.name}
              courtMapLink={latestSession.court?.mapLink ?? null}
              status={latestSession.status}
              playerCount={0}
              dinerCount={0}
              guestPlayCount={0}
              guestDineCount={0}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {tDashboard("noUpcoming")}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Selector ĐỦ các thứ cầu lông của tuần đích (T2/4/6 theo setting; T7/CN →
  // tuần sau) — kể cả ngày Admin chưa tạo buổi. Chỉ cho khách / member đã hết
  // nợ (member còn nợ đi nhánh trả tiền ở trên). Hiện khi tuần có ≥ 1 buổi.
  if (weekDays.some((d) => d.session) && !(user && hasBlockingDebt)) {
    const days = await Promise.all(
      weekDays.map(async (d) => {
        if (!d.session) return { date: d.date, session: null };
        const s = d.session;
        return {
          date: d.date,
          session: {
            id: s.id,
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            courtName: s.court?.name ?? null,
            courtMapLink: s.court?.mapLink ?? null,
            status: s.status,
            voteDeadline: s.voteDeadline ?? null,
            isVotingOpen: isVoteOpen({
              status: s.status as SessionStatus,
              voteDeadline: s.voteDeadline ?? null,
            }).open,
            adminGuestPlayCount: s.adminGuestPlayCount ?? 0,
            adminGuestDineCount: s.adminGuestDineCount ?? 0,
            votes: await getSessionVotes(s.id),
          },
        };
      }),
    );

    // defaultDate tính SERVER-SIDE (hydration-safe) — thứ sắp tới gần nhất có
    // buổi; nếu không có → thứ sắp tới gần nhất; cuối cùng → thứ cuối tuần.
    const today = ymdInVN();
    const upcoming = days.filter((d) => d.date >= today);
    const defaultDate =
      upcoming.find((d) => d.session)?.date ??
      upcoming[0]?.date ??
      [...days].reverse().find((d) => d.session)?.date ??
      days[days.length - 1]?.date ??
      null;

    return (
      <div className="mx-auto max-w-lg space-y-4">
        <AutoRefresh />
        {user && (
          <FundBalanceBanner
            balance={userFundBalance}
            memberId={user.memberId}
          />
        )}
        <WeekSessionsView
          days={days}
          defaultDate={defaultDate}
          members={members}
          currentMemberId={user?.memberId ?? null}
        />
      </div>
    );
  }

  // Fallback: buổi sắp tới đơn lẻ (vd buổi lẻ không rơi vào ngày cầu lông).
  if (nextSession) {
    const votes = await getSessionVotes(nextSession.id);

    // Helper canonical (deadline-aware) — khớp gate server-side submitVote.
    const isVotingOpen = isVoteOpen({
      status: nextSession.status as SessionStatus,
      voteDeadline: nextSession.voteDeadline ?? null,
    }).open;

    return (
      <div className="mx-auto max-w-lg space-y-4">
        <AutoRefresh />
        {user && (
          <FundBalanceBanner
            balance={userFundBalance}
            memberId={user.memberId}
          />
        )}

        <SessionVoteOptimisticPanel
          sessionId={nextSession.id}
          session={{
            date: nextSession.date,
            startTime: nextSession.startTime,
            endTime: nextSession.endTime,
            courtName: nextSession.court?.name,
            courtMapLink: nextSession.court?.mapLink ?? null,
            status: nextSession.status,
          }}
          votes={votes}
          members={members}
          currentMemberId={user?.memberId ?? null}
          isVotingOpen={isVotingOpen}
          voteDeadline={nextSession.voteDeadline}
          adminGuestPlayCount={nextSession.adminGuestPlayCount ?? 0}
          adminGuestDineCount={nextSession.adminGuestDineCount ?? 0}
        />
      </div>
    );
  }

  const latestSession = await getLatestCompletedSession();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <AutoRefresh />
      {user && (
        <FundBalanceBanner balance={userFundBalance} memberId={user.memberId} />
      )}
      {latestSession ? (
        <div className="space-y-4">
          <h1 className="text-lg font-bold">{tDashboard("latestSession")}</h1>
          <SessionCard
            date={latestSession.date}
            startTime={latestSession.startTime}
            endTime={latestSession.endTime}
            courtName={latestSession.court?.name}
            courtMapLink={latestSession.court?.mapLink ?? null}
            status={latestSession.status}
            playerCount={0}
            dinerCount={0}
            guestPlayCount={0}
            guestDineCount={0}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center space-y-4 py-8">
          <div className="text-4xl">🏸</div>
          <h2 className="text-xl font-bold">{tDashboard("noUpcoming")}</h2>
        </div>
      )}
    </div>
  );
}
