import {
  getMembers,
  getCurrentAdminMemberId,
  findDuplicateMembers,
} from "@/actions/members";
import { getAllDebts } from "@/actions/finance";
import { db } from "@/db";
import {
  financialTransactions,
  fundMembers as fundMembersTable,
  members as membersTable,
} from "@/db/schema";
import { eq, inArray, asc } from "drizzle-orm";
import { computeBalancesForMembers } from "@/lib/fund-core";
import { getNameMatches } from "@/actions/member-approval";
import { MemberList } from "./member-list";
import { DuplicateMembersBanner } from "./duplicate-members-banner";
import {
  PendingMembersSection,
  type PendingMember,
} from "./pending-members-section";

export default async function MembersPage() {
  const [
    members,
    allDebts,
    currentAdminMemberId,
    dupGroups,
    fundMemberRows,
    pendingRows,
  ] = await Promise.all([
    getMembers(),
    getAllDebts(),
    getCurrentAdminMemberId(),
    findDuplicateMembers(),
    db.query.fundMembers.findMany({
      where: eq(fundMembersTable.isActive, true),
      columns: { memberId: true },
    }),
    db.query.members.findMany({
      where: eq(membersTable.approvalStatus, "pending"),
      orderBy: [asc(membersTable.createdAt)],
    }),
  ]);

  // Build pending list with name-match suggestions per row.
  const pendingMembers: PendingMember[] = await Promise.all(
    pendingRows.map(async (p) => ({
      id: p.id,
      name: p.name,
      nickname: p.nickname,
      email: p.email,
      phoneNumber: p.phoneNumber,
      bankAccountNo: p.bankAccountNo,
      avatarKey: p.avatarKey,
      avatarUrl: p.avatarUrl,
      facebookId: p.facebookId,
      googleId: p.googleId,
      createdAt: p.createdAt,
      suggestions: await getNameMatches(p.id),
    })),
  );

  const fundMemberIdList = fundMemberRows.map((r) => r.memberId);

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
      {pendingMembers.length > 0 && (
        <PendingMembersSection pendingMembers={pendingMembers} />
      )}
      {dupGroups.length > 0 && <DuplicateMembersBanner groups={dupGroups} />}
      <MemberList
        members={members}
        debtsByMember={debtsByMember}
        currentAdminMemberId={currentAdminMemberId}
        memberBalances={memberBalances}
        fundMemberIds={fundMemberIdList}
      />
    </div>
  );
}
