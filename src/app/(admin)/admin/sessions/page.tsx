import { db } from "@/db";
import { sessions, courts, members, shuttlecockBrands } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { SessionList } from "./session-list";

const PAGE_SIZE = 10;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // 2-wave fetch: count trước để clamp page, rồi fetch slice theo safePage.
  // Tránh case URL `?page=99` nhưng thực tế chỉ có 3 trang → fetch empty slice.
  const [activeCourts, activeMembers, activeBrands, totalRows] =
    await Promise.all([
      db.query.courts.findMany({
        where: eq(courts.isActive, true),
        orderBy: [courts.name],
      }),
      db.query.members.findMany({
        where: eq(members.isActive, true),
        orderBy: [members.name],
      }),
      db.query.shuttlecockBrands.findMany({
        where: eq(shuttlecockBrands.isActive, true),
        orderBy: [shuttlecockBrands.name],
      }),
      db
        .select({ count: sql<number>`count(*)` })
        .from(sessions)
        .then((r) => Number(r[0]?.count ?? 0)),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(pageNum, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const allSessions = await db.query.sessions.findMany({
    orderBy: [desc(sessions.date)],
    limit: PAGE_SIZE,
    offset,
    with: {
      court: true,
      votes: { with: { member: true } },
      debts: { with: { member: true } },
      shuttlecocks: { with: { brand: true } },
    },
  });

  const sessionCards = allSessions.map((s) => {
    const playerCount = s.votes.filter((v) => v.willPlay).length;
    const dinerCount = s.votes.filter((v) => v.willDine).length;
    const guestPlayCount =
      s.votes.reduce((sum, v) => sum + (v.guestPlayCount ?? 0), 0) +
      (s.adminGuestPlayCount ?? 0);
    const guestDineCount =
      s.votes.reduce((sum, v) => sum + (v.guestDineCount ?? 0), 0) +
      (s.adminGuestDineCount ?? 0);
    const totalDebt = s.debts.reduce((sum, d) => sum + d.totalAmount, 0);
    const paidDebt = s.debts
      .filter((d) => d.adminConfirmed)
      .reduce((sum, d) => sum + d.totalAmount, 0);
    const unpaidDebts = s.debts
      .filter((d) => !d.adminConfirmed)
      .map((d) => ({
        debtId: d.id,
        memberId: d.memberId,
        memberName: d.member.name,
        memberAvatarKey: d.member.avatarKey ?? null,
        memberAvatarUrl: d.member.avatarUrl ?? null,
        amount: d.totalAmount,
      }));
    const shuttlecockInfo = s.shuttlecocks.map((sc) => ({
      brandName: sc.brand.name,
      quantity: sc.quantityUsed,
    }));

    const debtMap: Record<
      number,
      { amount: number; adminConfirmed: boolean; debtId: number }
    > = {};
    for (const d of s.debts) {
      debtMap[d.memberId] = {
        amount: d.totalAmount,
        adminConfirmed: d.adminConfirmed ?? false,
        debtId: d.id,
      };
    }

    return {
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      courtId: s.courtId,
      courtQuantity: s.courtQuantity ?? 1,
      courtName: s.court?.name ?? null,
      courtMapLink: s.court?.mapLink ?? null,
      courtPrice: s.courtPrice,
      diningBill: s.diningBill ?? 0,
      adminGuestPlayCount: s.adminGuestPlayCount ?? 0,
      adminGuestDineCount: s.adminGuestDineCount ?? 0,
      playerCount,
      dinerCount,
      guestPlayCount,
      guestDineCount,
      totalDebt,
      paidDebt,
      unpaidDebts,
      shuttlecockInfo,
      votes: s.votes,
      shuttlecocks: s.shuttlecocks,
      debtMap,
    };
  });

  return (
    <div>
      <SessionList
        sessions={sessionCards}
        courts={activeCourts}
        members={activeMembers}
        brands={activeBrands}
        currentPage={safePage}
        totalPages={totalPages}
      />
    </div>
  );
}
