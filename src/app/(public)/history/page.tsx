import { db } from "@/db";
import { sessions } from "@/db/schema";
import { desc, or, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";
import { calculateShuttlecockCost } from "@/lib/cost-calculator";
import { HistoryClient } from "./history-client";

export default async function HistoryPage() {
  const tSessions = await getTranslations("sessions");
  const user = await getUserFromCookie();

  const pastWhere = or(
    eq(sessions.status, "completed"),
    eq(sessions.status, "cancelled"),
  );

  const pastSessions = await db.query.sessions.findMany({
    where: pastWhere,
    orderBy: [desc(sessions.date)],
    with: {
      court: true,
      attendees: {
        with: {
          member: true,
        },
      },
      shuttlecocks: {
        with: { brand: true },
      },
      debts: true,
    },
  });

  const sessionCards = pastSessions.map((s) => {
    const playerCount = s.attendees.filter((a) => a.attendsPlay).length;
    const dinerCount = s.attendees.filter((a) => a.attendsDine).length;

    const shuttlecockCost = s.shuttlecocks.reduce(
      (sum, sc) =>
        sum + calculateShuttlecockCost(sc.quantityUsed, sc.pricePerTube),
      0,
    );
    const totalCost =
      (s.courtPrice || 0) + shuttlecockCost + (s.diningBill || 0);

    const attendees = s.attendees.map((a) => {
      const rowDebt = a.memberId
        ? s.debts.find((d) => d.memberId === a.memberId)
        : undefined;
      return {
        id: a.id,
        name: a.isGuest ? a.guestName || "Guest" : a.member?.name || "Unknown",
        memberId: a.memberId,
        memberAvatarKey: a.member?.avatarKey ?? null,
        memberAvatarUrl: a.member?.avatarUrl ?? null,
        isGuest: a.isGuest ?? false,
        attendsPlay: a.attendsPlay ?? false,
        attendsDine: a.attendsDine ?? false,
        debt: rowDebt
          ? {
              totalAmount: rowDebt.totalAmount,
              playAmount:
                (rowDebt.playAmount ?? 0) + (rowDebt.guestPlayAmount ?? 0),
              dineAmount:
                (rowDebt.dineAmount ?? 0) + (rowDebt.guestDineAmount ?? 0),
              memberConfirmed: rowDebt.memberConfirmed ?? false,
              adminConfirmed: rowDebt.adminConfirmed ?? false,
            }
          : null,
      };
    });

    const myAttendee = user
      ? s.attendees.find((a) => a.memberId === user.memberId)
      : undefined;
    const myDebtRow = user
      ? s.debts.find((d) => d.memberId === user.memberId)
      : undefined;

    const playShare =
      (myDebtRow?.playAmount ?? 0) + (myDebtRow?.guestPlayAmount ?? 0);
    const dineShare =
      (myDebtRow?.dineAmount ?? 0) + (myDebtRow?.guestDineAmount ?? 0);

    const attendsPlay = !!myAttendee?.attendsPlay || playShare > 0;
    const attendsDine = !!myAttendee?.attendsDine || dineShare > 0;
    const hasMeaningfulDebt = !!myDebtRow && (myDebtRow.totalAmount ?? 0) > 0;

    const mySummary =
      user &&
      (myAttendee || myDebtRow) &&
      (attendsPlay || attendsDine || hasMeaningfulDebt)
        ? {
            attendsPlay,
            attendsDine,
            playShare,
            dineShare,
            totalShare: myDebtRow?.totalAmount ?? 0,
            memberConfirmed: myDebtRow?.memberConfirmed ?? false,
            adminConfirmed: myDebtRow?.adminConfirmed ?? false,
            hasDebtRow: !!myDebtRow,
            debtId: myDebtRow?.id ?? null,
          }
        : null;

    return {
      id: s.id,
      date: s.date,
      status: s.status as string,
      courtName: s.court?.name || "-",
      courtPrice: s.courtPrice || 0,
      shuttlecockCost,
      diningBill: s.diningBill || 0,
      totalCost,
      playerCount,
      dinerCount,
      attendees,
      mySummary,
    };
  });

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {sessionCards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tSessions("noSessions")}
        </p>
      ) : (
        <HistoryClient
          sessions={sessionCards}
          isIdentified={!!user}
          currentMemberId={user?.memberId ?? null}
        />
      )}
    </div>
  );
}
