import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members, sessionDebts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getFundBalance, isFundMember } from "@/lib/fund-calculator";
import { MeClient } from "./me-client";

export default async function MePage() {
  const user = await getUserFromCookie();
  if (!user) redirect("/");

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });

  if (!member) redirect("/");

  const debts = await db.query.sessionDebts.findMany({
    where: eq(sessionDebts.memberId, user.memberId),
    with: { session: true },
  });

  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalSpentThisMonth = debts
    .filter((d) => d.session?.date?.startsWith(monthPrefix))
    .reduce((sum, d) => sum + d.totalAmount, 0);

  const outstandingDebt = debts
    .filter((d) => !d.adminConfirmed && !d.memberConfirmed)
    .reduce((sum, d) => sum + d.totalAmount, 0);

  const isInFund = await isFundMember(user.memberId);
  const fundBalance = isInFund
    ? (await getFundBalance(user.memberId)).balance
    : null;

  return (
    <div className="space-y-6">
      <MeClient
        key={`${member.id}-${member.name}-${member.nickname ?? ""}-${member.avatarKey ?? ""}`}
        memberId={member.id}
        avatarKey={member.avatarKey ?? null}
        avatarUrl={member.avatarUrl ?? null}
        memberName={member.name}
        memberNickname={member.nickname ?? null}
        totalSpentThisMonth={totalSpentThisMonth}
        outstandingDebt={outstandingDebt}
        fundBalance={fundBalance}
      />
    </div>
  );
}
