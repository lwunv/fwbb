"use server";

import { db } from "@/db";
import { sessions, courts, sessionShuttlecocks, shuttlecockBrands, sessionDebts, sessionAttendees, votes } from "@/db/schema";
import { eq, desc, and, gte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sendGroupMessage, buildNewSessionMessage, buildConfirmedMessage } from "@/lib/messenger";

export async function getSessions() {
  return db.query.sessions.findMany({
    orderBy: [desc(sessions.date)],
    with: { court: true },
  });
}

export async function getSession(id: number) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, id),
    with: {
      court: true,
      shuttlecocks: {
        with: { brand: true },
      },
    },
  });
}

export async function getNextSession() {
  const today = new Date().toISOString().split("T")[0];
  const existing = await db.query.sessions.findFirst({
    where: and(
      gte(sessions.date, today),
      ne(sessions.status, "completed"),
      ne(sessions.status, "cancelled"),
    ),
    orderBy: [sessions.date],
    with: {
      court: true,
      shuttlecocks: {
        with: { brand: true },
      },
    },
  });

  if (existing) return existing;

  // Auto-create next Mon(1) or Fri(5) session
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  let daysUntilNext: number;
  if (dayOfWeek <= 1) {
    daysUntilNext = 1 - dayOfWeek; // days until Monday
  } else if (dayOfWeek <= 5) {
    daysUntilNext = 5 - dayOfWeek; // days until Friday
  } else {
    daysUntilNext = 2; // Saturday → Monday
  }
  if (daysUntilNext === 0) daysUntilNext = 0; // today is Mon or Fri

  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntilNext);
  const dateStr = nextDate.toISOString().split("T")[0];

  // Check if that date already has a session (completed/cancelled)
  const existingForDate = await db.query.sessions.findFirst({
    where: eq(sessions.date, dateStr),
  });

  let targetDate = dateStr;
  if (existingForDate) {
    // Skip to next session day
    const skip = dayOfWeek <= 1 ? 4 : dayOfWeek <= 5 ? (7 - dayOfWeek + 1) : 2;
    const altDate = new Date(now);
    altDate.setDate(now.getDate() + daysUntilNext + (daysUntilNext === 0 && dayOfWeek === 1 ? 4 : daysUntilNext === 0 && dayOfWeek === 5 ? 3 : 0));
    if (existingForDate.status === "completed" || existingForDate.status === "cancelled") {
      // Find next available Mon/Fri
      const d = new Date(dateStr + "T00:00:00");
      for (let i = 1; i <= 7; i++) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay();
        if (dow === 1 || dow === 5) {
          targetDate = d.toISOString().split("T")[0];
          const check = await db.query.sessions.findFirst({ where: eq(sessions.date, targetDate) });
          if (!check) break;
        }
      }
    } else {
      // There's an active session for that date, return it
      return db.query.sessions.findFirst({
        where: eq(sessions.id, existingForDate.id),
        with: { court: true, shuttlecocks: { with: { brand: true } } },
      });
    }
  }

  const [newSession] = await db.insert(sessions).values({
    date: targetDate,
    status: "voting",
  }).returning();

  return db.query.sessions.findFirst({
    where: eq(sessions.id, newSession.id),
    with: {
      court: true,
      shuttlecocks: {
        with: { brand: true },
      },
    },
  });
}

export async function getLatestCompletedSession() {
  return db.query.sessions.findFirst({
    where: eq(sessions.status, "completed"),
    orderBy: [desc(sessions.date)],
    with: {
      court: true,
      shuttlecocks: {
        with: { brand: true },
      },
    },
  });
}

export async function selectCourt(sessionId: number, courtId: number, courtQuantity: number = 1) {
  const court = await db.query.courts.findFirst({ where: eq(courts.id, courtId) });
  if (!court) return { error: "San khong ton tai" };

  const qty = Math.max(1, courtQuantity);
  await db.update(sessions).set({
    courtId,
    courtQuantity: qty,
    courtPrice: court.pricePerSession * qty,
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

export async function confirmSession(sessionId: number) {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status !== "voting") return { error: "Buoi choi khong o trang thai voting" };
  if (!session.courtId) return { error: "Chua chon san" };

  // Check shuttlecocks are configured
  const shuttles = await db.query.sessionShuttlecocks.findMany({
    where: eq(sessionShuttlecocks.sessionId, sessionId),
  });
  if (shuttles.length === 0) return { error: "Chua chon cau" };

  await db.update(sessions).set({
    status: "confirmed",
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId));

  // Count voters for notification
  const sessionVotes = await db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
  });
  const playCount = sessionVotes.filter((v) => v.willPlay).length;
  const dineCount = sessionVotes.filter((v) => v.willDine).length;
  sendGroupMessage(buildConfirmedMessage(session.date, playCount, dineCount));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

export async function cancelSession(sessionId: number) {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status === "completed") return { error: "Khong the huy buoi da hoan thanh" };

  await db.update(sessions).set({
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  }).where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

export async function deleteSession(sessionId: number) {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) return { error: "Không tìm thấy buổi chơi" };

  // Delete related data first (FK constraints)
  await db.delete(sessionDebts).where(eq(sessionDebts.sessionId, sessionId));
  await db.delete(sessionAttendees).where(eq(sessionAttendees.sessionId, sessionId));
  await db.delete(sessionShuttlecocks).where(eq(sessionShuttlecocks.sessionId, sessionId));
  await db.delete(votes).where(eq(votes.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function createSessionManually(
  date: string,
  startTime?: string,
  endTime?: string,
  courtId?: number,
) {
  // Check if session already exists for this date
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, date),
  });
  if (existing) return { error: "Da co buoi choi vao ngay nay" };

  let courtPrice: number | null = null;
  if (courtId) {
    const court = await db.query.courts.findFirst({ where: eq(courts.id, courtId) });
    if (court) courtPrice = court.pricePerSession;
  }

  await db.insert(sessions).values({
    date,
    status: "voting",
    startTime: startTime || "20:30",
    endTime: endTime || "22:30",
    courtId: courtId || null,
    courtPrice,
  });
  revalidatePath("/admin/sessions");
  revalidatePath("/");

  // Non-blocking Messenger notification
  const court = courtId
    ? await db.query.courts.findFirst({ where: eq(courts.id, courtId) })
    : null;
  const link = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/vote/${date}`;
  sendGroupMessage(buildNewSessionMessage(date, court?.name ?? null, link));

  return { success: true };
}

export async function addSessionShuttlecocks(
  sessionId: number,
  brandId: number,
  quantityUsed: number,
) {
  const brand = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.id, brandId),
  });
  if (!brand) return { error: "Khong tim thay hang cau" };

  // Check if this brand already exists for this session
  const existing = await db.query.sessionShuttlecocks.findFirst({
    where: and(
      eq(sessionShuttlecocks.sessionId, sessionId),
      eq(sessionShuttlecocks.brandId, brandId),
    ),
  });

  if (existing) {
    await db.update(sessionShuttlecocks).set({
      quantityUsed,
      pricePerTube: brand.pricePerTube,
    }).where(eq(sessionShuttlecocks.id, existing.id));
  } else {
    await db.insert(sessionShuttlecocks).values({
      sessionId,
      brandId,
      quantityUsed,
      pricePerTube: brand.pricePerTube,
    });
  }

  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

export async function removeSessionShuttlecock(id: number) {
  const record = await db.query.sessionShuttlecocks.findFirst({
    where: eq(sessionShuttlecocks.id, id),
  });
  if (!record) return { error: "Khong tim thay" };

  await db.delete(sessionShuttlecocks).where(eq(sessionShuttlecocks.id, id));
  revalidatePath(`/admin/sessions/${record.sessionId}`);
  return { success: true };
}
