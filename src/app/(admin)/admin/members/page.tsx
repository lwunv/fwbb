import {
  getMembers,
  getCurrentAdminMemberId,
  findDuplicateMembers,
} from "@/actions/members";
import { getAllDebts } from "@/actions/finance";
import { db } from "@/db";
import { financialTransactions } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { computeBalancesForMembers } from "@/lib/fund-core";
import { MemberList } from "./member-list";
import { DuplicateMembersBanner } from "./duplicate-members-banner";

export default async function MembersPage() {
  const [members, allDebts, currentAdminMemberId, dupGroups] =
    await Promise.all([
      getMembers(),
      getAllDebts(),
      getCurrentAdminMemberId(),
      findDuplicateMembers(),
    ]);

  const memberIds = members.map((m) => m.id);
  const memberTxs =
    memberIds.length > 0
      ? await db
          .select({
            memberId: financialTransactions.memberId,
            type: financialTransactions.type,
            amount: financialTransactions.amount,
            id: financialTransactions.id,
            reversalOfId: financialTransactions.reversalOfId,
          })
          .from(financialTransactions)
          .where(inArray(financialTransactions.memberId, memberIds))
      : [];

  const memberTxsFiltered = memberTxs.filter(
    (tx): tx is typeof tx & { memberId: number } => tx.memberId !== null,
  );
  const memberBalances = computeBalancesForMembers(
    memberIds,
    memberTxsFiltered,
  );

  // Group unpaid debts by memberId
  const debtsByMember: Record<
    number,
    Array<{
      id: number;
      sessionId: number;
      sessionDate: string;
      totalAmount: number;
      memberConfirmed: boolean;
    }>
  > = {};

  for (const d of allDebts) {
    if (d.adminConfirmed) continue;
    if (!debtsByMember[d.memberId]) debtsByMember[d.memberId] = [];
    debtsByMember[d.memberId].push({
      id: d.id,
      sessionId: d.sessionId,
      sessionDate: d.session.date,
      totalAmount: d.totalAmount,
      memberConfirmed: d.memberConfirmed ?? false,
    });
  }

  return (
    <div className="space-y-3">
      {dupGroups.length > 0 && <DuplicateMembersBanner groups={dupGroups} />}
      <MemberList
        members={members}
        debtsByMember={debtsByMember}
        currentAdminMemberId={currentAdminMemberId}
        memberBalances={memberBalances}
      />
    </div>
  );
}
