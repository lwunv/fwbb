import { getUserFromCookie } from "@/lib/user-identity";
import { getDebtsForMember } from "@/actions/finance";
import { MyDebtsClient } from "./my-debts-client";

export default async function MyDebtsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getUserFromCookie();
  if (!user) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Vui long xac nhan danh tinh truoc.
      </div>
    );
  }

  const { period = "all" } = await searchParams;
  const debts = await getDebtsForMember(user.memberId, period);

  const debtCards = debts.map((d) => ({
    id: d.id,
    sessionId: d.sessionId,
    memberId: d.memberId,
    sessionDate: d.session.date,
    playAmount: d.playAmount ?? 0,
    dineAmount: d.dineAmount ?? 0,
    guestPlayAmount: d.guestPlayAmount ?? 0,
    guestDineAmount: d.guestDineAmount ?? 0,
    totalAmount: d.totalAmount,
    memberConfirmed: d.memberConfirmed ?? false,
    adminConfirmed: d.adminConfirmed ?? false,
  }));

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-lg font-bold">Cong no cua ban</h1>
      <MyDebtsClient debts={debtCards} />
    </div>
  );
}
