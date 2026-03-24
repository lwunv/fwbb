"use server";

import { db } from "@/db";
import { sessions, courts, sessionShuttlecocks, shuttlecockBrands } from "@/db/schema";
import { eq, desc, and, gte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
  return db.query.sessions.findFirst({
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

export async function createSessionManually(date: string) {
  // Check if session already exists for this date
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, date),
  });
  if (existing) return { error: "Da co buoi choi vao ngay nay" };

  await db.insert(sessions).values({ date, status: "voting" });
  revalidatePath("/admin/sessions");
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
