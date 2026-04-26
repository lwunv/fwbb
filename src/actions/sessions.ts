"use server";

import { db } from "@/db";
import {
  sessions,
  courts,
  sessionShuttlecocks,
  shuttlecockBrands,
  sessionDebts,
  sessionAttendees,
  votes,
} from "@/db/schema";
import { eq, desc, and, gte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  sendGroupMessage,
  buildNewSessionMessage,
  buildConfirmedMessage,
} from "@/lib/messenger";
import { requireAdmin } from "@/lib/auth";
import {
  selectCourtSchema,
  addShuttlecockSchema,
  adminGuestCountSchema,
} from "@/lib/validators";

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
    const altDate = new Date(now);
    altDate.setDate(
      now.getDate() +
        daysUntilNext +
        (daysUntilNext === 0 && dayOfWeek === 1
          ? 4
          : daysUntilNext === 0 && dayOfWeek === 5
            ? 3
            : 0),
    );
    if (
      existingForDate.status === "completed" ||
      existingForDate.status === "cancelled"
    ) {
      // Find next available Mon/Fri
      const d = new Date(dateStr + "T00:00:00");
      for (let i = 1; i <= 7; i++) {
        d.setDate(d.getDate() + 1);
        const dow = d.getDay();
        if (dow === 1 || dow === 5) {
          targetDate = d.toISOString().split("T")[0];
          const check = await db.query.sessions.findFirst({
            where: eq(sessions.date, targetDate),
          });
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

  const [newSession] = await db
    .insert(sessions)
    .values({
      date: targetDate,
      status: "voting",
    })
    .returning();

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

export async function selectCourt(
  sessionId: number,
  courtId: number,
  courtQuantity: number = 1,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = selectCourtSchema.safeParse({
    sessionId,
    courtId,
    courtQuantity,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const court = await db.query.courts.findFirst({
    where: eq(courts.id, data.courtId),
  });
  if (!court) return { error: "San khong ton tai" };

  await db
    .update(sessions)
    .set({
      courtId: data.courtId,
      courtQuantity: data.courtQuantity,
      courtPrice: court.pricePerSession * data.courtQuantity,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, data.sessionId));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  return { success: true };
}

export async function confirmSession(sessionId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status !== "voting")
    return { error: "Buoi choi khong o trang thai voting" };
  if (!session.courtId) return { error: "Chua chon san" };

  // Check shuttlecocks are configured
  const shuttles = await db.query.sessionShuttlecocks.findMany({
    where: eq(sessionShuttlecocks.sessionId, sessionId),
  });
  if (shuttles.length === 0) return { error: "Chua chon cau" };

  await db
    .update(sessions)
    .set({
      status: "confirmed",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, sessionId));

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
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status === "completed")
    return { error: "Khong the huy buoi da hoan thanh" };

  await db
    .update(sessions)
    .set({
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

export async function deleteSession(sessionId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: "Không tìm thấy buổi chơi" };

  // Delete related data first (FK constraints)
  await db.delete(sessionDebts).where(eq(sessionDebts.sessionId, sessionId));
  await db
    .delete(sessionAttendees)
    .where(eq(sessionAttendees.sessionId, sessionId));
  await db
    .delete(sessionShuttlecocks)
    .where(eq(sessionShuttlecocks.sessionId, sessionId));
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
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  // Check if session already exists for this date
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, date),
  });
  if (existing) return { error: "Da co buoi choi vao ngay nay" };

  let courtPrice: number | null = null;
  if (courtId) {
    const court = await db.query.courts.findFirst({
      where: eq(courts.id, courtId),
    });
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
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = addShuttlecockSchema.safeParse({
    sessionId,
    brandId,
    quantityUsed,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const brand = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.id, data.brandId),
  });
  if (!brand) return { error: "Khong tim thay hang cau" };

  // Check if this brand already exists for this session
  const existing = await db.query.sessionShuttlecocks.findFirst({
    where: and(
      eq(sessionShuttlecocks.sessionId, data.sessionId),
      eq(sessionShuttlecocks.brandId, data.brandId),
    ),
  });

  if (existing) {
    // CRITICAL: do NOT overwrite pricePerTube on existing rows.
    // pricePerTube is a snapshot at the time the shuttle was first added to the
    // session — overwriting it would back-date a brand price change onto a
    // session that already used the old price. Only update quantityUsed.
    await db
      .update(sessionShuttlecocks)
      .set({ quantityUsed: data.quantityUsed })
      .where(eq(sessionShuttlecocks.id, existing.id));
  } else {
    await db.insert(sessionShuttlecocks).values({
      sessionId: data.sessionId,
      brandId: data.brandId,
      quantityUsed: data.quantityUsed,
      pricePerTube: brand.pricePerTube,
    });
  }

  revalidatePath(`/admin/sessions/${data.sessionId}`);
  return { success: true };
}

export async function removeSessionShuttlecock(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const record = await db.query.sessionShuttlecocks.findFirst({
    where: eq(sessionShuttlecocks.id, id),
  });
  if (!record) return { error: "Khong tim thay" };

  await db.delete(sessionShuttlecocks).where(eq(sessionShuttlecocks.id, id));
  revalidatePath(`/admin/sessions/${record.sessionId}`);
  return { success: true };
}

export async function setAdminGuestCount(
  sessionId: number,
  guestPlayCount: number,
  guestDineCount: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const parsed = adminGuestCountSchema.safeParse({
    sessionId,
    guestPlayCount,
    guestDineCount,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  await db
    .update(sessions)
    .set({
      adminGuestPlayCount: data.guestPlayCount,
      adminGuestDineCount: data.guestDineCount,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, data.sessionId));

  revalidatePath(`/admin/sessions`);
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  revalidatePath("/");
  return { success: true };
}
