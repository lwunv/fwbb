import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members, sessionDebts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getFundBalance, isFundMember } from "@/lib/fund-calculator";
import { getMemberIdentities, isUsablePassword } from "@/lib/oauth-identity";
import { MeClient } from "./me-client";
import { SetPasswordSection } from "./set-password-section";
import { LinkedAccountsSection } from "./linked-accounts-section";

export default async function MePage() {
  const user = await getUserFromCookie();
  if (!user) redirect("/login");

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
  const linkedIdentities = await getMemberIdentities(user.memberId);
  const rawBalance = (await getFundBalance(user.memberId)).balance;
  // Hiển thị balance nếu còn trong quỹ HOẶC còn số dư đóng băng (member đã khóa
  // nhưng chưa hoàn) — tránh member tưởng mất tiền.
  const fundBalance = isInFund || rawBalance !== 0 ? rawBalance : null;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <MeClient
        key={`${member.id}-${member.name}-${member.nickname ?? ""}-${member.avatarKey ?? ""}-${member.username ?? ""}-${member.phoneNumber ?? ""}-${member.email ?? ""}`}
        memberId={member.id}
        avatarKey={member.avatarKey ?? null}
        avatarUrl={member.avatarUrl ?? null}
        memberName={member.name}
        memberNickname={member.nickname ?? null}
        memberUsername={member.username ?? null}
        memberPhone={member.phoneNumber ?? null}
        memberEmail={member.email ?? null}
        defaultWithPartner={member.defaultWithPartner}
        totalSpentThisMonth={totalSpentThisMonth}
        outstandingDebt={outstandingDebt}
        fundBalance={fundBalance}
      />
      <SetPasswordSection
        hasPassword={!!member.passwordHash}
        hasEmail={!!member.email}
      />
      <LinkedAccountsSection
        identities={linkedIdentities}
        hasPassword={isUsablePassword(
          member.passwordHash ?? null,
          member.passwordResetExpiresAt ?? null,
        )}
      />
    </div>
  );
}
