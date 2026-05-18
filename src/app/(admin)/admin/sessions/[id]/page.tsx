import { getSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveCourts } from "@/actions/courts";
import { getActiveBrands } from "@/actions/shuttlecocks";
import { getActiveMembers } from "@/actions/members";
import { getDefaultCourt, getSessionDaysOfWeek } from "@/actions/settings";
import { getSessionExemptions } from "@/actions/sessions";
import { db } from "@/db";
import { financialTransactions, sessionDebts } from "@/db/schema";
import { computeBalancesForMembers } from "@/lib/fund-core";
import { eq, inArray } from "drizzle-orm";
import { SessionDetail } from "./session-detail";
import { notFound } from "next/navigation";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const [
    session,
    votes,
    courts,
    brands,
    members,
    debts,
    defaultCourt,
    sessionDays,
    exemptions,
  ] = await Promise.all([
    getSession(sessionId),
    getSessionVotes(sessionId),
    getActiveCourts(),
    getActiveBrands(),
    getActiveMembers(),
    db.query.sessionDebts.findMany({
      where: eq(sessionDebts.sessionId, sessionId),
    }),
    getDefaultCourt(),
    getSessionDaysOfWeek(),
    getSessionExemptions(sessionId),
  ]);

  if (!session) notFound();

  const visibleMemberIds = members.map((m) => m.id);
  const memberTxs =
    visibleMemberIds.length > 0
      ? await db
          .select({
            memberId: financialTransactions.memberId,
            type: financialTransactions.type,
            amount: financialTransactions.amount,
            id: financialTransactions.id,
            reversalOfId: financialTransactions.reversalOfId,
          })
          .from(financialTransactions)
          .where(inArray(financialTransactions.memberId, visibleMemberIds))
      : [];

  const memberBalances = computeBalancesForMembers(
    visibleMemberIds,
    memberTxs.filter(
      (tx): tx is typeof tx & { memberId: number } => tx.memberId !== null,
    ),
  );

  const debtMap: Record<
    number,
    { amount: number; adminConfirmed: boolean; debtId: number }
  > = {};
  for (const d of debts) {
    debtMap[d.memberId] = {
      amount: d.totalAmount,
      adminConfirmed: d.adminConfirmed ?? false,
      debtId: d.id,
    };
  }

  return (
    <div>
      <SessionDetail
        session={session}
        votes={votes}
        courts={courts}
        brands={brands}
        members={members}
        debtMap={debtMap}
        defaultCourtId={defaultCourt?.id ?? null}
        sessionDays={sessionDays}
        exemptMemberIds={exemptions}
        memberBalances={memberBalances}
      />
    </div>
  );
}
