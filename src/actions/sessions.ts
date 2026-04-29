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
  financialTransactions,
  paymentNotifications,
} from "@/db/schema";
import { eq, desc, and, gte, ne, isNull, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  sendGroupMessage,
  buildNewSessionMessage,
  buildConfirmedMessage,
} from "@/lib/messenger";
import { requireAdmin } from "@/lib/auth";
import { admins } from "@/db/schema";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
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

  // Tính giá: sân thứ 1 = giá tháng (pricePerSession), sân thứ 2..N = giá lẻ.
  // Nếu chưa cấu hình giá lẻ → fallback giá tháng (an toàn về phía admin: không underprice).
  const monthlyPrice = court.pricePerSession;
  const retailPrice = court.pricePerSessionRetail ?? monthlyPrice;
  const qty = Math.max(1, data.courtQuantity);
  const totalCourtPrice = monthlyPrice + retailPrice * (qty - 1);

  await db
    .update(sessions)
    .set({
      courtId: data.courtId,
      courtQuantity: qty,
      courtPrice: totalCourtPrice,
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

/**
 * Cancel session với option pass sân.
 * - passed=false: hủy bình thường, không tác động tài chính.
 * - passed=true + passRevenue>0: ghi nhận admin đã thu được tiền pass sân,
 *   tự động ghi vào quỹ admin (fund_contribution direction=in memberId=admin.memberId).
 */
export async function cancelSession(
  sessionId: number,
  options?: { passed?: boolean; passRevenue?: number },
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: "Khong tim thay buoi choi" };
  if (session.status === "completed")
    return { error: "Khong the huy buoi da hoan thanh" };

  const passed = options?.passed === true;
  const passRevenue =
    passed &&
    Number.isInteger(options?.passRevenue) &&
    options!.passRevenue! > 0
      ? options!.passRevenue!
      : 0;

  // Validate amount within sane bounds
  if (passed && (passRevenue < 0 || passRevenue > 1_000_000_000)) {
    return { error: "Số tiền pass sân không hợp lệ" };
  }

  // Resolve admin's linked memberId for fund credit
  let adminMemberId: number | null = null;
  if (passed && passRevenue > 0) {
    const adminId = parseInt(auth.admin.sub ?? "", 10);
    if (Number.isFinite(adminId)) {
      const adminRow = await db.query.admins.findFirst({
        where: eq(admins.id, adminId),
        columns: { memberId: true },
      });
      adminMemberId = adminRow?.memberId ?? null;
    }
    if (adminMemberId === null) {
      return {
        error:
          "Admin chưa được liên kết với member — không thể ghi vào quỹ. Vào /admin/members để gắn member của admin trước.",
      };
    }
  }

  // Atomic: update session + record fund contribution (if any)
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({
          status: "cancelled",
          passRevenue: passRevenue > 0 ? passRevenue : null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, sessionId));

      if (passed && passRevenue > 0 && adminMemberId !== null) {
        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: passRevenue,
            memberId: adminMemberId,
            sessionId,
            description: `Pass sân buổi ${session.date} — admin nhận lại`,
            metadata: { source: "session_passed", sessionId },
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không hủy được buổi",
    };
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  if (passed && passRevenue > 0) {
    revalidatePath("/admin/fund");
    revalidatePath("/admin/finance");
    revalidatePath("/my-fund");
  }
  return { success: true };
}

/**
 * Delete a session — atomic + financially safe.
 *
 * Trước fix: 5 lệnh DELETE nối tiếp ngoài transaction. Hai vấn đề:
 *  1. Fail giữa chừng → orphan rows.
 *  2. Với session đã `completed`, các `fund_deduction` đã trừ quỹ thật của
 *     từng member KHÔNG được hoàn lại — member mất tiền không lý do.
 *
 * Sau fix:
 *  - Toàn bộ thao tác wrap `db.transaction`.
 *  - Mọi `fund_deduction` (chưa-reversed) của session được phát hành
 *    `fund_contribution reversalOfId=...` để hoàn lại quỹ TRƯỚC khi xóa.
 *  - **Pass-revenue contribution** (admin nhận lại tiền pass sân khi
 *    `cancelSession({passed:true})`) cũng phải được reverse — nếu không
 *    admin giữ tiền vĩnh viễn dù session đã biến mất. Reversal là một
 *    `fund_refund direction=out reversalOfId=originalContribution.id`.
 *  - **paymentNotifications.matchedDebtId** trỏ tới session_debts của
 *    session sắp xóa được NULL out để tránh dangling FK reference.
 *  - NULL out `sessionId/debtId` trên ledger rows session-scoped còn lại
 *    (giữ làm audit).
 *  - Xóa theo thứ tự an toàn FK:
 *      session_debts → session_attendees → session_shuttlecocks → votes →
 *      sessions.
 *  - Không cố reverse với session "voting"/"confirmed" (chưa có deduction).
 */
export async function deleteSession(sessionId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: "Không tìm thấy buổi chơi" };

  try {
    await db.transaction(async (tx) => {
      // Reverse any fund_deduction that hasn't been reversed yet, so members
      // who already paid this session via their fund balance get the money
      // back when the session is deleted. The reversal row stays in the
      // ledger (sessionId=null) for audit, with reversalOfId pointing at the
      // original.
      const liveDeductions = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.sessionId, sessionId),
          eq(financialTransactions.type, "fund_deduction"),
          isNull(financialTransactions.reversalOfId),
        ),
      });
      for (const ftx of liveDeductions) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ftx.id),
        });
        if (alreadyReversed) continue;

        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: ftx.amount,
            memberId: ftx.memberId,
            sessionId: null,
            reversalOfId: ftx.id,
            description: `Hoàn quỹ do xóa buổi ${session.date}`,
            metadata: { reversedDueToSessionDelete: true, sessionId },
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      // Reverse any pass-revenue fund_contribution attributed to this
      // session. Use a `fund_refund` (direction=out) so the balance math
      // cancels out the original `+amount` contribution. Audit trail is
      // preserved via reversalOfId.
      const liveContributions = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.sessionId, sessionId),
          eq(financialTransactions.type, "fund_contribution"),
          isNull(financialTransactions.reversalOfId),
        ),
      });
      for (const ftx of liveContributions) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ftx.id),
        });
        if (alreadyReversed) continue;

        const r = await recordFinancialTransaction(
          {
            type: "fund_refund",
            direction: "out",
            amount: ftx.amount,
            memberId: ftx.memberId,
            sessionId: null,
            reversalOfId: ftx.id,
            description: `Rút lại tiền pass do xóa buổi ${session.date}`,
            metadata: { reversedDueToSessionDelete: true, sessionId },
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      // NULL out `paymentNotifications.matchedDebtId` for all debts being
      // deleted — libsql doesn't enforce FK by default so these would
      // become dangling references otherwise. The notification row itself
      // stays for audit (sender, amount, date).
      const debtIdsToDelete = (
        await tx.query.sessionDebts.findMany({
          where: eq(sessionDebts.sessionId, sessionId),
          columns: { id: true },
        })
      ).map((d) => d.id);
      if (debtIdsToDelete.length > 0) {
        await tx
          .update(paymentNotifications)
          .set({ matchedDebtId: null })
          .where(inArray(paymentNotifications.matchedDebtId, debtIdsToDelete));
      }

      // Detach session-scoped ledger rows from FK targets we're about to
      // delete. We DO NOT delete the rows — they remain as audit (the
      // reversals above cancel out originals in the balance math). NULL'ing
      // sessionId/debtId keeps those rows off post-delete queries that
      // filter by sessionId.
      await tx
        .update(financialTransactions)
        .set({ sessionId: null, debtId: null })
        .where(eq(financialTransactions.sessionId, sessionId));

      // Delete in FK-safe order.
      await tx
        .delete(sessionDebts)
        .where(eq(sessionDebts.sessionId, sessionId));
      await tx
        .delete(sessionAttendees)
        .where(eq(sessionAttendees.sessionId, sessionId));
      await tx
        .delete(sessionShuttlecocks)
        .where(eq(sessionShuttlecocks.sessionId, sessionId));
      await tx.delete(votes).where(eq(votes.sessionId, sessionId));
      await tx.delete(sessions).where(eq(sessions.id, sessionId));
    });
  } catch (err) {
    return {
      error:
        "Không xóa được buổi: " +
        (err instanceof Error ? err.message : "lỗi không xác định"),
    };
  }

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/fund");
  revalidatePath("/my-fund");
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
