import {
  getMembers,
  getCurrentAdminMemberId,
  findDuplicateMembers,
} from "@/actions/members";
import { getAllDebts } from "@/actions/finance";
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
      />
    </div>
  );
}
