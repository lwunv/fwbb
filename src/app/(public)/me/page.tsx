import { getUserFromCookie } from "@/lib/user-identity";
import { db } from "@/db";
import { members, sessionAttendees, sessionDebts, sessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { MeClient } from "./me-client";

export default async function MePage() {
  const user = await getUserFromCookie();
  if (!user) redirect("/");

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });

  if (!member) redirect("/");

  // Get quick stats for this member
  // Total sessions played
  const attendances = await db.query.sessionAttendees.findMany({
    where: and(
      eq(sessionAttendees.memberId, user.memberId),
      eq(sessionAttendees.isGuest, false)
    ),
    with: {
      session: true,
    },
  });

  const completedAttendances = attendances.filter(
    (a) => a.session.status === "completed"
  );

  const totalPlayed = completedAttendances.filter(
    (a) => a.attendsPlay
  ).length;
  const totalDined = completedAttendances.filter(
    (a) => a.attendsDine
  ).length;

  // Total spent
  const debts = await db.query.sessionDebts.findMany({
    where: eq(sessionDebts.memberId, user.memberId),
  });

  const totalSpent = debts.reduce((sum, d) => sum + d.totalAmount, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Ca nhan</h1>
      <MeClient
        memberName={member.name}
        memberPhone={member.phone}
        totalPlayed={totalPlayed}
        totalDined={totalDined}
        totalSpent={totalSpent}
      />
    </div>
  );
}
