import { db } from "@/db";
import { sessions, courts, votes, sessionDebts, sessionShuttlecocks } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { SessionList } from "./session-list";

export default async function SessionsPage() {
  const activeCourts = await db.query.courts.findMany({
    where: eq(courts.isActive, true),
    orderBy: [courts.name],
  });

  const allSessions = await db.query.sessions.findMany({
    orderBy: [desc(sessions.date)],
    with: {
      court: true,
      votes: true,
      debts: { with: { member: true } },
      shuttlecocks: { with: { brand: true } },
    },
  });

  const sessionCards = allSessions.map((s) => {
    const playerCount = s.votes.filter((v) => v.willPlay).length;
    const dinerCount = s.votes.filter((v) => v.willDine).length;
    const guestPlayCount = s.votes.reduce((sum, v) => sum + (v.guestPlayCount ?? 0), 0);
    const guestDineCount = s.votes.reduce((sum, v) => sum + (v.guestDineCount ?? 0), 0);
    const totalDebt = s.debts.reduce((sum, d) => sum + d.totalAmount, 0);
    const paidDebt = s.debts.filter((d) => d.adminConfirmed).reduce((sum, d) => sum + d.totalAmount, 0);
    const unpaidDebts = s.debts.filter((d) => !d.adminConfirmed).map((d) => ({
      debtId: d.id,
      memberId: d.memberId,
      memberName: d.member.name,
      memberAvatarKey: d.member.avatarKey ?? null,
      amount: d.totalAmount,
    }));
    const shuttlecockInfo = s.shuttlecocks.map((sc) => ({
      brandName: sc.brand.name,
      quantity: sc.quantityUsed,
    }));

    return {
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      courtName: s.court?.name ?? null,
      courtMapLink: s.court?.mapLink ?? null,
      courtPrice: s.courtPrice,
      playerCount,
      dinerCount,
      guestPlayCount,
      guestDineCount,
      totalDebt,
      paidDebt,
      unpaidDebts,
      shuttlecockInfo,
    };
  });

  return (
    <div>
      <SessionList
        sessions={sessionCards}
        courts={activeCourts.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
