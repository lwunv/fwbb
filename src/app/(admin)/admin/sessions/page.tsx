import { db } from "@/db";
import { sessions, votes, sessionDebts, sessionShuttlecocks } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { SessionList } from "./session-list";

export default async function SessionsPage() {
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
    const totalDebt = s.debts.reduce((sum, d) => sum + d.totalAmount, 0);
    const paidDebt = s.debts.filter((d) => d.adminConfirmed).reduce((sum, d) => sum + d.totalAmount, 0);
    const unpaidDebts = s.debts.filter((d) => !d.adminConfirmed).map((d) => ({
      memberId: d.memberId,
      memberName: d.member.name,
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
      totalDebt,
      paidDebt,
      unpaidDebts,
      shuttlecockInfo,
    };
  });

  return (
    <div>
      <SessionList sessions={sessionCards} />
    </div>
  );
}
