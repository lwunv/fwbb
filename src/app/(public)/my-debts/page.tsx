import { getUserFromCookie } from "@/lib/user-identity";
import { getDebtsForMember, getAllDebts } from "@/actions/finance";
import { getActiveMembers } from "@/actions/members";
import { MyDebtsClient } from "./my-debts-client";

export default async function MyDebtsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; member?: string }>;
}) {
  const user = await getUserFromCookie();
  if (!user) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Vui long xac nhan danh tinh truoc.
      </div>
    );
  }

  const { period = "all", member } = await searchParams;
  const members = await getActiveMembers();

  // member=all → show all, member=<id> → specific member, default → current user
  let selectedMemberId: number | "all" = user.memberId;
  if (member === "all") {
    selectedMemberId = "all";
  } else if (member) {
    selectedMemberId = parseInt(member, 10);
  }

  let debts;
  if (selectedMemberId === "all") {
    const allDebts = await getAllDebts(period);
    debts = allDebts.map((d) => ({
      id: d.id,
      sessionId: d.sessionId,
      memberId: d.memberId,
      memberName: d.member?.name ?? "Unknown",
      sessionDate: d.session.date,
      playAmount: d.playAmount ?? 0,
      dineAmount: d.dineAmount ?? 0,
      guestPlayAmount: d.guestPlayAmount ?? 0,
      guestDineAmount: d.guestDineAmount ?? 0,
      totalAmount: d.totalAmount,
      memberConfirmed: d.memberConfirmed ?? false,
      adminConfirmed: d.adminConfirmed ?? false,
    }));
  } else {
    const memberDebts = await getDebtsForMember(selectedMemberId, period);
    const memberInfo = members.find((m) => m.id === selectedMemberId);
    debts = memberDebts.map((d) => ({
      id: d.id,
      sessionId: d.sessionId,
      memberId: d.memberId,
      memberName: memberInfo?.name ?? "Unknown",
      sessionDate: d.session.date,
      playAmount: d.playAmount ?? 0,
      dineAmount: d.dineAmount ?? 0,
      guestPlayAmount: d.guestPlayAmount ?? 0,
      guestDineAmount: d.guestDineAmount ?? 0,
      totalAmount: d.totalAmount,
      memberConfirmed: d.memberConfirmed ?? false,
      adminConfirmed: d.adminConfirmed ?? false,
    }));
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-bold">Du no</h1>
      <MyDebtsClient
        debts={debts}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        currentUserId={user.memberId}
        selectedMemberId={selectedMemberId}
      />
    </div>
  );
}
