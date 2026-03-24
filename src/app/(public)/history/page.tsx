import { db } from "@/db";
import { sessions } from "@/db/schema";
import { desc, or, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { HistoryClient } from "./history-client";

export default async function HistoryPage() {
  const t = await getTranslations("nav");
  const tSessions = await getTranslations("sessions");

  const pastSessions = await db.query.sessions.findMany({
    where: or(
      eq(sessions.status, "completed"),
      eq(sessions.status, "cancelled")
    ),
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
      (sum, sc) => sum + Math.round((sc.quantityUsed * sc.pricePerTube) / 12),
      0
    );
    const totalCost =
      (s.courtPrice || 0) + shuttlecockCost + (s.diningBill || 0);

    const attendees = s.attendees.map((a) => ({
      id: a.id,
      name: a.isGuest ? a.guestName || "Guest" : a.member?.name || "Unknown",
      memberId: a.memberId,
      isGuest: a.isGuest ?? false,
      attendsPlay: a.attendsPlay ?? false,
      attendsDine: a.attendsDine ?? false,
    }));

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
    };
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t("history")}</h1>
      {sessionCards.length === 0 ? (
        <p className="text-muted-foreground text-sm">{tSessions("noSessions")}</p>
      ) : (
        <HistoryClient sessions={sessionCards} />
      )}
    </div>
  );
}
