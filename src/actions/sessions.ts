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
import {
  eq,
  desc,
  asc,
  and,
  gt,
  gte,
  lt,
  lte,
  ne,
  isNull,
  inArray,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  sendGroupMessage,
  buildNewSessionMessage,
  buildConfirmedMessage,
} from "@/lib/messenger";
import { requireAdmin } from "@/lib/auth";
import { ymdInVN, ymdInVNAddDays, dayOfWeekVN } from "@/lib/date-format";
import { admins } from "@/db/schema";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { computeCourtTotal } from "@/lib/cost-calculator";
import {
  getDefaultCourt,
  getDefaultBrand,
  getSessionDaysOfWeek,
} from "@/actions/settings";
import { assertEditable, type SessionStatus } from "@/lib/session-status";
import {
  selectCourtSchema,
  addShuttlecockSchema,
  adminGuestCountSchema,
  courtPriceOverrideSchema,
  shuttlecockPriceOverrideSchema,
} from "@/lib/validators";
import { getTranslations } from "next-intl/server";

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

/**
 * "Buổi sắp tới" cho user side — chỉ trả session ở khoảng [todayVN, todayVN+1]
 * (theo spec của user: 00:00 UTC+7 ngày X-1 mới hiện buổi X). Nếu khoảng đó
 * chưa có session active, auto-create cho ngày Mon/Wed/Fri gần nhất trong
 * khoảng đó.
 */
// Lịch chơi giờ là setting động (`appSettings.sessionDaysOfWeek` qua
// /admin/dashboard). Default fallback Mon/Wed/Fri lo trong getSessionDaysOfWeek().
async function getSessionDaysSet(): Promise<Set<number>> {
  const days = await getSessionDaysOfWeek();
  return new Set(days);
}

export async function getNextSession() {
  const today = ymdInVN();
  const tomorrow = ymdInVNAddDays(1);

  const existing = await db.query.sessions.findFirst({
    where: and(
      gte(sessions.date, today),
      lte(sessions.date, tomorrow),
      ne(sessions.status, "completed"),
      ne(sessions.status, "cancelled"),
    ),
    orderBy: [sessions.date],
    with: {
      court: true,
      shuttlecocks: { with: { brand: true } },
    },
  });

  if (existing) return existing;

  // Không có session active trong [today, tomorrow] → auto-create nếu trong
  // khoảng đó có ngày Mon/Wed/Fri và chưa có row nào (kể cả completed/cancelled).
  // Pre-fill court + brand mặc định — admin có thể đổi qua CourtSelector /
  // ShuttlecockSelector.
  const [defaultCourt, defaultBrand, sessionDays] = await Promise.all([
    getDefaultCourt(),
    getDefaultBrand(),
    getSessionDaysSet(),
  ]);
  for (const candidate of [today, tomorrow]) {
    if (!sessionDays.has(dayOfWeekVN(candidate))) continue;
    const exists = await db.query.sessions.findFirst({
      where: eq(sessions.date, candidate),
    });
    if (exists) continue; // có rồi (chắc completed/cancelled) → bỏ qua
    const [newSession] = await db
      .insert(sessions)
      .values({
        date: candidate,
        status: "voting",
        courtId: defaultCourt?.id ?? null,
        courtPrice: defaultCourt?.pricePerSession ?? null,
      })
      .returning();
    if (defaultBrand) {
      await db.insert(sessionShuttlecocks).values({
        sessionId: newSession.id,
        brandId: defaultBrand.id,
        quantityUsed: 1,
        pricePerTube: defaultBrand.pricePerTube,
      });
    }
    return db.query.sessions.findFirst({
      where: eq(sessions.id, newSession.id),
      with: { court: true, shuttlecocks: { with: { brand: true } } },
    });
  }

  return undefined;
}

/**
 * Buổi cần admin chú ý trên dashboard. Khác `getNextSession` ở chỗ:
 * - Ưu tiên buổi của hôm nay (active).
 * - KHÔNG hiện buổi tương lai (đợi đến đúng ngày mới hiện) — theo spec
 *   user: "ngày 30/4 thì cần hiện buổi 29/4 chứ. đến 1/5 mới hiện buổi tiếp".
 * - Nếu hôm nay là Mon/Wed/Fri và chưa có row, auto-create cho hôm nay.
 * - Nếu vẫn không có buổi cho hôm nay, lùi về buổi pending gần nhất trong
 *   quá khứ (voting/confirmed chưa finalize). Không giới hạn 1 ngày — VD: Chủ
 *   Nhật vẫn phải hiện buổi T6 nếu nó chưa được chốt sổ. Dashboard không bao
 *   giờ trống nếu còn buổi pending.
 */
export async function getAdminUpcomingSession() {
  const today = ymdInVN();

  // 1. Hôm nay có session active → show
  const todaySession = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.date, today),
      ne(sessions.status, "completed"),
      ne(sessions.status, "cancelled"),
    ),
    with: {
      court: true,
      shuttlecocks: { with: { brand: true } },
    },
  });
  if (todaySession) return todaySession;

  // 2. Hôm nay là ngày chơi mà chưa có row → auto-create cho hôm nay.
  //    Pre-fill court mặc định (THCS Tây Mỗ) — admin có thể đổi sau.
  const sessionDays = await getSessionDaysSet();
  if (sessionDays.has(dayOfWeekVN(today))) {
    const exists = await db.query.sessions.findFirst({
      where: eq(sessions.date, today),
    });
    if (!exists) {
      const [defaultCourt, defaultBrand] = await Promise.all([
        getDefaultCourt(),
        getDefaultBrand(),
      ]);
      const [newSession] = await db
        .insert(sessions)
        .values({
          date: today,
          status: "voting",
          courtId: defaultCourt?.id ?? null,
          courtPrice: defaultCourt?.pricePerSession ?? null,
        })
        .returning();
      if (defaultBrand) {
        await db.insert(sessionShuttlecocks).values({
          sessionId: newSession.id,
          brandId: defaultBrand.id,
          quantityUsed: 1,
          pricePerTube: defaultBrand.pricePerTube,
        });
      }
      return db.query.sessions.findFirst({
        where: eq(sessions.id, newSession.id),
        with: { court: true, shuttlecocks: { with: { brand: true } } },
      });
    }
  }

  // 3. Buổi sắp tới gần nhất do admin tự tạo (vd CN/T7 ngoài MWF). Phải lấy
  //    trước past-pending: admin vừa setup buổi tương lai thì kỳ vọng thấy
  //    nó, không phải buổi cũ chưa chốt.
  const futureSession = await db.query.sessions.findFirst({
    where: and(
      gt(sessions.date, today),
      ne(sessions.status, "completed"),
      ne(sessions.status, "cancelled"),
    ),
    orderBy: [asc(sessions.date)],
    with: {
      court: true,
      shuttlecocks: { with: { brand: true } },
    },
  });
  if (futureSession) return futureSession;

  // 4. Lùi về buổi pending gần nhất trong quá khứ (admin cần chốt sổ).
  //    Không giới hạn 1 ngày: T6 chưa finalize phải vẫn hiện vào CN/T2 sau đó.
  const pastPending = await db.query.sessions.findFirst({
    where: and(
      lt(sessions.date, today),
      ne(sessions.status, "completed"),
      ne(sessions.status, "cancelled"),
    ),
    orderBy: [desc(sessions.date)],
    with: {
      court: true,
      shuttlecocks: { with: { brand: true } },
    },
  });
  if (pastPending) return pastPending;

  return undefined;
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
  const t = await getTranslations("serverErrors");

  const parsed = selectCourtSchema.safeParse({
    sessionId,
    courtId,
    courtQuantity,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }
  const data = parsed.data;

  // Guard fintech: không cho đổi giá sân khi đã chốt sổ — admin phải Mở lại trước.
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
    columns: { status: true },
  });
  if (!existing) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(existing.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  const [court, sessionRow, defaultCourt, sessionDays] = await Promise.all([
    db.query.courts.findFirst({ where: eq(courts.id, data.courtId) }),
    db.query.sessions.findFirst({
      where: eq(sessions.id, data.sessionId),
      columns: { date: true },
    }),
    getDefaultCourt(),
    getSessionDaysOfWeek(),
  ]);
  if (!court) return { error: t("courtNotExists") };
  if (!sessionRow) return { error: t("sessionNotFound") };

  // Quy tắc giá:
  //  - Buổi MẶC ĐỊNH (sân default + ngày trong lịch admin config): sân #1 =
  //    giá tháng, sân #2..N = giá lẻ.
  //  - Buổi LẺ (sân khác / ngày khác): TẤT CẢ sân = giá lẻ.
  // Pure logic ở `computeCourtTotal` để client preview cùng công thức.
  // Truyền `sessionDays` từ settings — đừng để helper hardcode M/W/F khi admin
  // đã đổi sang lịch khác (vd Tue/Thu/Sat) → tránh over-charge member trên
  // các buổi đúng lịch.
  const totalCourtPrice = computeCourtTotal({
    monthlyPrice: court.pricePerSession,
    retailPrice: court.pricePerSessionRetail,
    courtQuantity: data.courtQuantity,
    sessionDate: sessionRow.date,
    selectedCourtId: data.courtId,
    defaultCourtId: defaultCourt?.id ?? null,
    sessionDays,
  });

  // Đổi sân / số sân = intent dùng lại formula → clear override flag.
  // Nếu admin muốn override, họ sẽ bấm "Sửa giá" sau khi đã chọn sân.
  await db
    .update(sessions)
    .set({
      courtId: data.courtId,
      courtQuantity: Math.max(1, data.courtQuantity),
      courtPrice: totalCourtPrice,
      courtPriceOverridden: false,
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

  // Recompute courtPrice từ current state (defensive). Trường hợp xảy ra
  // khi default court / retail price đã đổi sau lúc admin select court ban
  // đầu, hoặc cron đã tạo session lúc default court khác. Tại confirm
  // time admin chính thức chốt → recompute để courtPrice = giá hiện tại
  // theo formula (sân default trên ngày T2/T4/T6 = monthly, sân thứ 2 +
  // sân ngày khác = retail). Buổi mở thêm với 1 sân lẻ → pure retail.
  //
  // EXCEPTION: nếu admin đã `setSessionCourtPriceOverride` (cờ
  // `courtPriceOverridden = true`), giữ nguyên `courtPrice` đã lưu — không
  // recompute, để không ghi đè giá thủ công admin vừa nhập.
  const [court, defaultCourt, sessionDays] = await Promise.all([
    db.query.courts.findFirst({ where: eq(courts.id, session.courtId) }),
    getDefaultCourt(),
    getSessionDaysOfWeek(),
  ]);

  let recomputedCourtPrice: number;
  if (session.courtPriceOverridden) {
    // Admin đã override → giữ nguyên `session.courtPrice` (đã set bởi
    // `setSessionCourtPriceOverride`, không bao giờ NULL).
    if (session.courtPrice == null) {
      return {
        error:
          "Buổi này đã đánh dấu override giá sân nhưng courtPrice bị NULL — không thể chốt. Bấm 'Sửa giá' để set lại.",
      };
    }
    recomputedCourtPrice = session.courtPrice;
  } else if (court) {
    recomputedCourtPrice = computeCourtTotal({
      monthlyPrice: court.pricePerSession,
      retailPrice: court.pricePerSessionRetail,
      courtQuantity: session.courtQuantity ?? 1,
      sessionDate: session.date,
      selectedCourtId: session.courtId,
      defaultCourtId: defaultCourt?.id ?? null,
      sessionDays,
    });
  } else {
    // Court đã bị xóa nhưng session vẫn ref → trước đây fallback `?? 0`
    // silent, làm finalize chia per-head bằng 0 → debts toàn 0đ cho phần
    // sân. Phải error rõ để admin xử lý (chọn lại sân hoặc override giá).
    return {
      error:
        "Sân của buổi này không còn tồn tại — vui lòng chọn lại sân trước khi chốt sổ",
    };
  }

  await db
    .update(sessions)
    .set({
      status: "confirmed",
      courtPrice: recomputedCourtPrice,
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
  const t = await getTranslations("serverErrors");

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: t("sessionNotFound") };
  if (session.status === "completed")
    return { error: t("cannotCancelCompleted") };
  // Idempotent: gọi cancelSession lần 2 trên buổi đã cancelled = no-op,
  // không nhân đôi pass-revenue. Trước đây check chỉ kiểm `completed` →
  // double-click chèn 2 fund_contribution.
  if (session.status === "cancelled") {
    return { success: true as const, alreadyCancelled: true };
  }

  const passed = options?.passed === true;
  const passRevenue =
    passed &&
    Number.isInteger(options?.passRevenue) &&
    options!.passRevenue! > 0
      ? options!.passRevenue!
      : 0;

  // Validate amount within sane bounds
  if (passed && (passRevenue < 0 || passRevenue > 1_000_000_000)) {
    return { error: t("invalidPassRevenue") };
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
        // idempotencyKey natural-keyed by sessionId — DB UNIQUE INDEX trên
        // financial_transactions.idempotency_key chặn admin double-click
        // (form đã reset → tưởng vẫn submit được).
        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: passRevenue,
            memberId: adminMemberId,
            sessionId,
            description: `Pass sân buổi ${session.date} — admin nhận lại`,
            metadata: { source: "session_passed", sessionId },
            idempotencyKey: `session-pass-${sessionId}`,
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
 * Reopen một buổi đã hủy → đưa về `voting`.
 *
 * Nếu buổi từng có pass-sân (passRevenue đã ghi vào quỹ admin), reverse lại
 * `fund_contribution` đó bằng một `fund_deduction` với `reversalOfId` trỏ tới
 * record gốc — preserve audit trail. Skip reverse nếu đã có reversal trước đó
 * (idempotent).
 */
export async function reopenSession(sessionId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: t("sessionNotFound") };
  if (session.status !== "cancelled") {
    return { error: t("onlyCancelledCanReopen") };
  }

  // Tìm pass-sân contribution gốc (nếu có) — match theo sessionId + type +
  // direction để chắc chắn không reverse nhầm transaction khác.
  const passContribution = await db.query.financialTransactions.findFirst({
    where: and(
      eq(financialTransactions.sessionId, sessionId),
      eq(financialTransactions.type, "fund_contribution"),
      eq(financialTransactions.direction, "in"),
      isNull(financialTransactions.reversalOfId),
    ),
  });

  // Đã có reversal cho contribution này chưa? (idempotency guard)
  let alreadyReversed = false;
  if (passContribution) {
    const existingReversal = await db.query.financialTransactions.findFirst({
      where: eq(financialTransactions.reversalOfId, passContribution.id),
      columns: { id: true },
    });
    alreadyReversed = !!existingReversal;
  }

  try {
    await db.transaction(async (tx) => {
      if (passContribution && !alreadyReversed) {
        const r = await recordFinancialTransaction(
          {
            type: "fund_deduction",
            direction: "out",
            amount: passContribution.amount,
            memberId: passContribution.memberId,
            sessionId,
            reversalOfId: passContribution.id,
            description: `Reverse pass-sân buổi ${session.date} — mở lại buổi`,
            metadata: { source: "session_reopened", sessionId },
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      await tx
        .update(sessions)
        .set({
          status: "voting",
          passRevenue: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, sessionId));
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : t("reopenFailed"),
    };
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  if (passContribution) {
    revalidatePath("/admin/fund");
    revalidatePath("/admin/finance");
    revalidatePath("/my-fund");
  }
  return { success: true };
}

/**
 * Unlock một buổi đã `completed` để admin có thể sửa lại config + finalize lại.
 *
 * Atomic transaction:
 *  1. Reverse mọi `fund_deduction` của buổi qua `reversalOfId` → balance member
 *     khôi phục về trước finalize.
 *  2. NULL out `debtId` trên ledger rows trỏ vào debts của session (libsql
 *     không enforce FK; phải null trước khi xóa debts để reconcile invariant
 *     I7 không flag orphan refs).
 *  3. Xóa `sessionAttendees` + `sessionDebts` của session — clean state.
 *  4. Set `status = "voting"` để các action sửa lại được phép chạy.
 *
 * Sau khi unlock, admin sửa court/shuttle/votes/khách như buổi mới, rồi bấm
 * "Xác nhận buổi chơi" → `finalizeSessionAuto` build attendees + debts mới.
 *
 * Idempotent: chạy lại an toàn nhờ check `reversalOfId IS NULL` trước khi
 * insert reversal mới.
 */
export async function unlockSession(sessionId: number) {
  const auth = await requireAdmin();
  if (auth && "error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: t("sessionNotFound") };
  if (session.status !== "completed") {
    return { error: t("onlyCompletedCanReopenForEdit") };
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Reverse fund_deductions (idempotent)
      const priorDeductions = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.sessionId, sessionId),
          eq(financialTransactions.type, "fund_deduction"),
          isNull(financialTransactions.reversalOfId),
        ),
      });
      for (const ftx of priorDeductions) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ftx.id),
          columns: { id: true },
        });
        if (alreadyReversed) continue;
        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: ftx.amount,
            memberId: ftx.memberId,
            sessionId: ftx.sessionId,
            reversalOfId: ftx.id,
            description: `Hoàn lại trừ quỹ khi mở lại buổi ${session.date}`,
            metadata: { source: "session_unlocked", sessionId },
            // Defence-in-depth: ngoài `reversalOfId` guard + check
            // `alreadyReversed` ở trên, vẫn set explicit key để DB UNIQUE
            // chặn double-insert nếu logic guard bị refactor mất.
            idempotencyKey: `unlock-reverse-${ftx.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      // 2. NULL debtId trên ledger trước khi xóa debts (giữ audit history)
      await tx
        .update(financialTransactions)
        .set({ debtId: null })
        .where(eq(financialTransactions.sessionId, sessionId));

      // 3. Wipe attendees + debts → state về "chưa finalize"
      await tx
        .delete(sessionAttendees)
        .where(eq(sessionAttendees.sessionId, sessionId));
      await tx
        .delete(sessionDebts)
        .where(eq(sessionDebts.sessionId, sessionId));

      // 4. Status về voting
      await tx
        .update(sessions)
        .set({
          status: "voting",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, sessionId));
    });
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Không mở lại được buổi đã chốt",
    };
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/fund");
  revalidatePath("/admin/finance");
  revalidatePath("/my-fund");
  revalidatePath("/my-debts");
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
  const t = await getTranslations("serverErrors");

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return { error: t("sessionNotFound") };

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

  // Resolve court: admin chọn → dùng đó; không chọn → fallback default court.
  // Giá ban đầu tính qua computeCourtTotal — buổi lẻ (ngày khác lịch config,
  // hoặc sân khác default) sẽ ăn giá retail; buổi mặc định ăn giá tháng.
  const [defaultCourt, sessionDays] = await Promise.all([
    getDefaultCourt(),
    getSessionDaysOfWeek(),
  ]);
  let resolvedCourtId: number | null = null;
  let courtPrice: number | null = null;
  let resolvedCourt: {
    id: number;
    pricePerSession: number;
    pricePerSessionRetail: number | null;
  } | null = null;
  if (courtId) {
    const court = await db.query.courts.findFirst({
      where: eq(courts.id, courtId),
    });
    if (court) resolvedCourt = court;
  } else if (defaultCourt) {
    resolvedCourt = defaultCourt;
  }
  if (resolvedCourt) {
    resolvedCourtId = resolvedCourt.id;
    courtPrice = computeCourtTotal({
      monthlyPrice: resolvedCourt.pricePerSession,
      retailPrice: resolvedCourt.pricePerSessionRetail,
      courtQuantity: 1,
      sessionDate: date,
      selectedCourtId: resolvedCourt.id,
      defaultCourtId: defaultCourt?.id ?? null,
      sessionDays,
    });
  }

  const [newSession] = await db
    .insert(sessions)
    .values({
      date,
      status: "voting",
      startTime: startTime || "20:30",
      endTime: endTime || "22:30",
      courtId: resolvedCourtId,
      courtPrice,
    })
    .returning();
  // Pre-fill brand mặc định để admin chỉ cần đổi ống nếu cần.
  const defaultBrand = await getDefaultBrand();
  if (defaultBrand && newSession) {
    await db.insert(sessionShuttlecocks).values({
      sessionId: newSession.id,
      brandId: defaultBrand.id,
      quantityUsed: 1,
      pricePerTube: defaultBrand.pricePerTube,
    });
  }
  revalidatePath("/admin/sessions");
  revalidatePath("/");

  // Non-blocking Messenger notification
  const court = resolvedCourtId
    ? await db.query.courts.findFirst({
        where: eq(courts.id, resolvedCourtId),
      })
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
  const t = await getTranslations("serverErrors");

  const parsed = addShuttlecockSchema.safeParse({
    sessionId,
    brandId,
    quantityUsed,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }
  const data = parsed.data;

  // Guard fintech: chặn add/edit shuttlecock khi đã chốt sổ.
  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
    columns: { status: true },
  });
  if (!sessionRow) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(sessionRow.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  const brand = await db.query.shuttlecockBrands.findFirst({
    where: eq(shuttlecockBrands.id, data.brandId),
  });
  if (!brand) return { error: t("brandNotFound") };

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
  const t = await getTranslations("serverErrors");

  const record = await db.query.sessionShuttlecocks.findFirst({
    where: eq(sessionShuttlecocks.id, id),
  });
  if (!record) return { error: t("notFound") };

  // Guard fintech: chặn remove shuttlecock khi buổi đã chốt sổ.
  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, record.sessionId),
    columns: { status: true },
  });
  if (!sessionRow) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(sessionRow.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  await db.delete(sessionShuttlecocks).where(eq(sessionShuttlecocks.id, id));
  revalidatePath(`/admin/sessions/${record.sessionId}`);
  return { success: true };
}

/**
 * Override tiền sân thủ công cho 1 buổi. `customPrice = null` → reset về auto
 * (recompute theo formula `computeCourtTotal` ngay lập tức từ court hiện tại).
 *
 * Guard: chặn nếu buổi `completed`/`cancelled` — admin phải `unlockSession` /
 * `reopenSession` trước. Đây là pattern chung cho mọi cost-affecting action,
 * giữ invariant "debts khớp với cost calculation hiện tại". Khi buổi đã chốt
 * sổ, đổi giá → finalize lại sẽ tự reverse `fund_deduction` cũ qua
 * `reversalOfId` (xem `finance.ts`).
 */
export async function setSessionCourtPriceOverride(
  sessionId: number,
  customPrice: number | null,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const parsed = courtPriceOverrideSchema.safeParse({ sessionId, customPrice });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }
  const data = parsed.data;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
    columns: {
      status: true,
      courtId: true,
      courtQuantity: true,
      date: true,
      courtPrice: true,
    },
  });
  if (!session) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(session.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  // Reset → recompute từ formula.
  if (data.customPrice === null) {
    if (!session.courtId) {
      // Chưa chọn sân → không có gì để recompute, chỉ clear flag.
      await db
        .update(sessions)
        .set({
          courtPriceOverridden: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, data.sessionId));
    } else {
      const [court, defaultCourt, sessionDays] = await Promise.all([
        db.query.courts.findFirst({ where: eq(courts.id, session.courtId) }),
        getDefaultCourt(),
        getSessionDaysOfWeek(),
      ]);
      const autoPrice = court
        ? computeCourtTotal({
            monthlyPrice: court.pricePerSession,
            retailPrice: court.pricePerSessionRetail,
            courtQuantity: session.courtQuantity ?? 1,
            sessionDate: session.date,
            selectedCourtId: session.courtId,
            defaultCourtId: defaultCourt?.id ?? null,
            sessionDays,
          })
        : (session.courtPrice ?? 0);
      await db
        .update(sessions)
        .set({
          courtPrice: autoPrice,
          courtPriceOverridden: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, data.sessionId));
    }
  } else {
    await db
      .update(sessions)
      .set({
        courtPrice: data.customPrice,
        courtPriceOverridden: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, data.sessionId));
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  return { success: true };
}

/**
 * Override giá/ống của 1 row `sessionShuttlecocks` đã có. `customPricePerTube
 * = null` → reset về giá hãng hiện tại (snapshot lại từ `shuttlecockBrands`).
 *
 * Lý do dùng `sessionShuttlecockId` thay vì `(sessionId, brandId)`: row đã
 * tồn tại (admin đã add brand vào buổi rồi mới override giá), client luôn
 * biết row.id. Giảm 1 query lookup ở server và rõ ràng "edit này nhằm vào
 * row nào".
 */
export async function setSessionShuttlecockPriceOverride(
  sessionShuttlecockId: number,
  customPricePerTube: number | null,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const parsed = shuttlecockPriceOverrideSchema.safeParse({
    sessionShuttlecockId,
    customPricePerTube,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }
  const data = parsed.data;

  const row = await db.query.sessionShuttlecocks.findFirst({
    where: eq(sessionShuttlecocks.id, data.sessionShuttlecockId),
  });
  if (!row) return { error: t("notFound") };

  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, row.sessionId),
    columns: { status: true },
  });
  if (!sessionRow) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(sessionRow.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  let newPrice: number;
  if (data.customPricePerTube === null) {
    // Reset → snapshot lại giá hãng hiện tại.
    const brand = await db.query.shuttlecockBrands.findFirst({
      where: eq(shuttlecockBrands.id, row.brandId),
    });
    if (!brand) return { error: t("brandNotFound") };
    newPrice = brand.pricePerTube;
  } else {
    newPrice = data.customPricePerTube;
  }

  await db
    .update(sessionShuttlecocks)
    .set({ pricePerTube: newPrice })
    .where(eq(sessionShuttlecocks.id, data.sessionShuttlecockId));

  revalidatePath(`/admin/sessions/${row.sessionId}`);
  return { success: true };
}

export async function setAdminGuestCount(
  sessionId: number,
  guestPlayCount: number,
  guestDineCount: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const parsed = adminGuestCountSchema.safeParse({
    sessionId,
    guestPlayCount,
    guestDineCount,
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? t("invalidData", { detail: "" }),
    };
  }
  const data = parsed.data;

  // Guard fintech: admin guest count ảnh hưởng divisor → chặn khi đã chốt sổ.
  const sessionRow = await db.query.sessions.findFirst({
    where: eq(sessions.id, data.sessionId),
    columns: { status: true },
  });
  if (!sessionRow) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(sessionRow.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

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
