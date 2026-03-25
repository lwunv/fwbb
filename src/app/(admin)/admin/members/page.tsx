import { getMembers } from "@/actions/members";
import { getAllDebts } from "@/actions/finance";
import { MemberList } from "./member-list";

export default async function MembersPage() {
  const [members, allDebts] = await Promise.all([
    getMembers(),
    getAllDebts(),
  ]);

  // Group unpaid debts by memberId
  const debtsByMember: Record<number, Array<{
    id: number;
    sessionId: number;
    sessionDate: string;
    totalAmount: number;
    memberConfirmed: boolean;
  }>> = {};

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
    <div>
      <MemberList members={members} debtsByMember={debtsByMember} />
    </div>
  );
}
