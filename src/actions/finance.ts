"use server";

import { db } from "@/db";
import {
  sessions,
  sessionAttendees,
  sessionShuttlecocks,
  sessionDebts,
  admins,
  members,
} from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getUserFromCookie } from "@/lib/user-identity";
import {
  calculateSessionCosts,
  type AttendeeInput,
} from "@/lib/cost-calculator";
import { sendGroupMessage, buildDebtReminderMessage } from "@/lib/messenger";

export interface FinalizeAttendee {
  memberId: number | null;
  guestName?: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
}

export async function finalizeSession(
  sessionId: number,
  attendeeList: FinalizeAttendee[],
  diningBill: number,
) {
  // 1. Load session with shuttlecocks
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: { shuttlecocks: true },
  });

  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status === "completed") return { error: "Buoi choi da hoan thanh" };
  if (!session.courtPrice) return { error: "Chua thiet lap gia san" };

  // 2. Delete old attendees + debts for this session (in case of re-finalization)
  await db.delete(sessionAttendees).where(eq(sessionAttendees.sessionId, sessionId));
  await db.delete(sessionDebts).where(eq(sessionDebts.sessionId, sessionId));

  // 3. Insert attendees
  for (const a of attendeeList) {
    await db.insert(sessionAttendees).values({
      sessionId,
      memberId: a.memberId,
      guestName: a.guestName ?? null,
      invitedById: a.invitedById,
      isGuest: a.isGuest,
      attendsPlay: a.attendsPlay,
      attendsDine: a.attendsDine,
    });
  }

  // 4. Calculate costs
  const attendeeInputs: AttendeeInput[] = attendeeList.map((a) => ({
    memberId: a.memberId,
    guestName: a.guestName,
    invitedById: a.invitedById,
    isGuest: a.isGuest,
    attendsPlay: a.attendsPlay,
    attendsDine: a.attendsDine,
  }));

  const shuttlecockInputs = session.shuttlecocks.map((s) => ({
    quantityUsed: s.quantityUsed,
    pricePerTube: s.pricePerTube,
  }));

  const breakdown = calculateSessionCosts(
    { courtPrice: session.courtPrice, diningBill },
    attendeeInputs,
    shuttlecockInputs,
  );

  // 5. Find admin's member record
  // Admin table stores admin accounts. We need to find if any member matches the admin.
  // Convention: admin's member record has the same name or phone. We look for members
  // whose id is referenced in the admins table via a matching username/name.
  // Simpler approach: query admins table, then check if any member's name matches.
  // The spec says "admin cung la thanh vien trong bang members" - we need a reliable way.
  // We check admins table for username, then find a member with matching name.
  const admin = await db.query.admins.findFirst();
  let adminMemberId: number | null = null;
  if (admin) {
    // Try to find a member whose name matches admin username
    const adminMember = await db.query.members.findFirst({
      where: eq(members.name, admin.username),
    });
    if (adminMember) {
      adminMemberId = adminMember.id;
    }
  }

  // 6. Insert debt records
  const now = new Date().toISOString();
  for (const debt of breakdown.memberDebts) {
    const isAdminDebt = debt.memberId === adminMemberId;
    await db.insert(sessionDebts).values({
      sessionId,
      memberId: debt.memberId,
      playAmount: debt.playAmount,
      dineAmount: debt.dineAmount,
      guestPlayAmount: debt.guestPlayAmount,
      guestDineAmount: debt.guestDineAmount,
      totalAmount: debt.totalAmount,
      memberConfirmed: isAdminDebt ? true : false,
      memberConfirmedAt: isAdminDebt ? now : null,
      adminConfirmed: isAdminDebt ? true : false,
      adminConfirmedAt: isAdminDebt ? now : null,
    });
  }

  // 7. Update session: set dining bill and status to completed
  await db
    .update(sessions)
    .set({
      diningBill,
      status: "completed",
      updatedAt: now,
    })
    .where(eq(sessions.id, sessionId));

  // Non-blocking Messenger notification
  const totalDebts = breakdown.memberDebts.reduce((sum, d) => sum + d.totalAmount, 0);
  const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/my-debts`;
  sendGroupMessage(buildDebtReminderMessage(session.date, totalDebts, link));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/finance");
  revalidatePath("/my-debts");
  return { success: true, breakdown };
}

export async function confirmPaymentByMember(debtId: number) {
  const user = await getUserFromCookie();
  if (!user) return { error: "Vui lòng xác định danh tính trước" };

  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
  });
  if (!debt) return { error: "Khong tim thay cong no" };
  if (debt.memberId !== user.memberId) {
    return { error: "Không thể xác nhận thay người khác" };
  }
  if (debt.memberConfirmed) return { success: true };

  await db
    .update(sessionDebts)
    .set({
      memberConfirmed: true,
      memberConfirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessionDebts.id, debtId));

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/history");
  revalidatePath("/");
  return { success: true };
}

export async function confirmPaymentByAdmin(debtId: number) {
  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
  });
  if (!debt) return { error: "Khong tim thay cong no" };

  await db
    .update(sessionDebts)
    .set({
      adminConfirmed: true,
      adminConfirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessionDebts.id, debtId));

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/members");
  return { success: true };
}

export async function undoPaymentByAdmin(debtId: number) {
  const debt = await db.query.sessionDebts.findFirst({
    where: eq(sessionDebts.id, debtId),
  });
  if (!debt) return { error: "Không tìm thấy công nợ" };

  await db
    .update(sessionDebts)
    .set({
      memberConfirmed: false,
      memberConfirmedAt: null,
      adminConfirmed: false,
      adminConfirmedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessionDebts.id, debtId));

  revalidatePath("/my-debts");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/members");
  return { success: true };
}

function getDateFilterStart(filter: string): string | null {
  const now = new Date();
  switch (filter) {
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    case "year":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    default:
      return null; // "all" - no filter
  }
}

export async function getDebtsForMember(
  memberId: number,
  filter: string = "all",
) {
  const dateStart = getDateFilterStart(filter);

  const debts = await db.query.sessionDebts.findMany({
    where: eq(sessionDebts.memberId, memberId),
    with: {
      session: true,
      member: true,
    },
    orderBy: [desc(sessionDebts.id)],
  });

  // Filter by session date if needed
  if (dateStart) {
    return debts.filter((d) => d.session.date >= dateStart);
  }
  return debts;
}

export async function getAllDebts(filter: string = "all") {
  const dateStart = getDateFilterStart(filter);

  const debts = await db.query.sessionDebts.findMany({
    with: {
      session: true,
      member: true,
    },
    orderBy: [desc(sessionDebts.id)],
  });

  if (dateStart) {
    return debts.filter((d) => d.session.date >= dateStart);
  }
  return debts;
}

export async function getDebtSummary() {
  // Get all unpaid debts grouped by member
  const debts = await db.query.sessionDebts.findMany({
    with: { member: true },
  });

  const summary: Record<
    number,
    { memberId: number; memberName: string; totalOutstanding: number; totalPaid: number }
  > = {};

  for (const debt of debts) {
    if (!summary[debt.memberId]) {
      summary[debt.memberId] = {
        memberId: debt.memberId,
        memberName: debt.member.name,
        totalOutstanding: 0,
        totalPaid: 0,
      };
    }
    if (debt.adminConfirmed) {
      summary[debt.memberId].totalPaid += debt.totalAmount;
    } else {
      summary[debt.memberId].totalOutstanding += debt.totalAmount;
    }
  }

  return Object.values(summary).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}
