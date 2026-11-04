"use server";

import { db } from "@/db";
import {
  sessions,
  courts,
  sessionShuttlecocks,
  shuttlecockBrands,
  sessionDebts,
  sessionAttendees,
  sessionMinDeductionExemptions,
  votes,
  financialTransactions,
  paymentNotifications,
  members,
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
  notInArray,
  like,
  or,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  computeDefaultDeadline,
  nowDeadlineVN,
  parseVoteDeadline,
  DEFAULT_PLAY_START_TIME,
} from "@/lib/vote-deadline";
import {
  notifySessionCancelled,
  notifySessionChanged,
  notifySessionOpened,
  notifySessionReopened,
  notifyVoteReopened,
  shouldNotifyVoteReopened,
  type SessionChangeField,
} from "@/lib/notifications/session-events";
import { evaluateCapacity } from "@/lib/notifications/capacity";
import { notifySessionDeletedRefund } from "@/lib/notifications/money-events";
import {
  sendGroupMessage,
  buildNewSessionMessage,
  buildConfirmedMessage,
} from "@/lib/messenger";
import { requireAdmin } from "@/lib/auth";
import {
  ymdInVN,
  ymdInVNAddDays,
  dayOfWeekVN,
  badmintonDatesForTargetWeek,
} from "@/lib/date-format";
import { admins } from "@/db/schema";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { computeCourtTotal } from "@/lib/cost-calculator";
import { countVoteParticipation } from "@/lib/vote-list-utils";
import {
  getDefaultCourt,
  getDefaultBrand,
  getSessionDaysOfWeek,
  getSettings,
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

/**
 * Các buổi cầu lông của TUẦN ĐÍCH cho selector trang user. Tuần đích = tuần
 * hiện tại; nếu hôm nay T7/CN → tuần sau (xem badmintonDatesForTargetWeek).
 * CHỈ trả buổi ĐÃ TỒN TẠI (ngày chưa tạo session → bỏ), sort theo ngày. Ngày
 * cầu lông lấy từ getSessionDaysOfWeek().
 */
/**
 * Tất cả các thứ cầu lông của TUẦN ĐÍCH (T2/4/6 theo getSessionDaysOfWeek;
 * T7/CN → tuần sau), kèm buổi tương ứng nếu Admin đã tạo (null nếu chưa). Dùng
 * cho selector trang chủ: chip hiện ĐỦ các thứ, kể cả ngày chưa có buổi.
 */
export async function getWeekBadmintonDays() {
  const days = await getSessionDaysOfWeek();
  const dates = badmintonDatesForTargetWeek(ymdInVN(), days);
  if (dates.length === 0) return [];
  const rows = await db.query.sessions.findMany({
    where: inArray(sessions.date, dates),
    with: { court: true },
  });
  const byDate = new Map(rows.map((s) => [s.date, s]));
  return dates.map((date) => ({ date, session: byDate.get(date) ?? null }));
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
    const newSession = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(sessions)
        .values({
          date: candidate,
          status: "voting",
          courtId: defaultCourt?.id ?? null,
          courtPrice: defaultCourt?.pricePerSession ?? null,
          useMinDeduction: true,
          voteDeadline: computeDefaultDeadline(
            candidate,
            DEFAULT_PLAY_START_TIME,
          ),
        })
        .returning();
      if (defaultBrand) {
        await tx.insert(sessionShuttlecocks).values({
          sessionId: created.id,
          brandId: defaultBrand.id,
          quantityUsed: 1,
          pricePerTube: defaultBrand.pricePerTube,
        });
      }
      await notifySessionOpened(tx, created.id);
      return created;
    });
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
  // Hàm này có thể INSERT buổi mới, nên không phải admin thì dừng ngay.
  const auth = await requireAdmin();
  if ("error" in auth) return undefined;

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
      const newSession = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(sessions)
          .values({
            date: today,
            status: "voting",
            courtId: defaultCourt?.id ?? null,
            courtPrice: defaultCourt?.pricePerSession ?? null,
            useMinDeduction: true,
            voteDeadline: computeDefaultDeadline(
              today,
              DEFAULT_PLAY_START_TIME,
            ),
          })
          .returning();
        if (defaultBrand) {
          await tx.insert(sessionShuttlecocks).values({
            sessionId: created.id,
            brandId: defaultBrand.id,
            quantityUsed: 1,
            pricePerTube: defaultBrand.pricePerTube,
          });
        }
        await notifySessionOpened(tx, created.id);
        return created;
      });
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
    columns: {
      status: true,
      courtId: true,
      courtQuantity: true,
      courtPrice: true,
    },
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
  const newQuantity = Math.max(1, data.courtQuantity);
  // Chỉ báo member khi sân thật sự đổi; giá đổi kèm thì gộp vào cùng tin.
  const changed: SessionChangeField[] = [];
  if (
    existing.courtId !== data.courtId ||
    (existing.courtQuantity ?? 1) !== newQuantity
  ) {
    changed.push("court");
    if (existing.courtPrice !== totalCourtPrice) changed.push("price");
  }
  const token = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        courtId: data.courtId,
        courtQuantity: newQuantity,
        courtPrice: totalCourtPrice,
        courtPriceOverridden: false,
        updatedAt: token,
      })
      .where(eq(sessions.id, data.sessionId));
    await notifySessionChanged(tx, data.sessionId, changed, token);
  });

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

  const token = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        status: "confirmed",
        courtPrice: recomputedCourtPrice,
        updatedAt: token,
      })
      .where(eq(sessions.id, sessionId));
    // Giá sân tính lại lúc xác nhận có thể khác giá member đã thấy khi vote.
    if (session.courtPrice !== recomputedCourtPrice) {
      await notifySessionChanged(tx, sessionId, ["price"], token);
    }
  });

  // Count voters for notification
  const sessionVotes = await db.query.votes.findMany({
    where: eq(votes.sessionId, sessionId),
  });
  const { memberPlay: playCount, memberDine: dineCount } =
    countVoteParticipation(sessionVotes);
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
  const token = new Date().toISOString();
  let cancelledNow = false;
  try {
    await db.transaction(async (tx) => {
      // Điều kiện trạng thái nằm ngay trong UPDATE: hai lần hủy chạy song song
      // đều qua được bước đọc ở trên, nhưng chỉ một lần đổi được dòng. Lần còn
      // lại không ghi tiền pass, không gửi tin, trả kết quả như hủy lặp lại.
      const updated = await tx
        .update(sessions)
        .set({
          status: "cancelled",
          passRevenue: passRevenue > 0 ? passRevenue : null,
          updatedAt: token,
        })
        .where(
          and(
            eq(sessions.id, sessionId),
            notInArray(sessions.status, ["cancelled", "completed"]),
          ),
        )
        .returning({ id: sessions.id });
      if (updated.length === 0) return;
      cancelledNow = true;

      if (passed && passRevenue > 0 && adminMemberId !== null) {
        // Cycle-fresh idempotencyKey. Re-entry within the SAME cancel is blocked
        // by the status guard above (status===cancelled → early return). But a
        // cancel(pass) → reopen → cancel(pass) cycle would collide on a static
        // `session-pass-${sessionId}` key: reopen reverses the original pass
        // contribution but never deletes it, so the second cancel replays the
        // key as a no-op → the fund is NOT credited while admin holds the cash.
        // Seed the key with the most-recent prior pass contribution id for this
        // session so each cancel cycle inserts a real row.
        const priorPass = await tx.query.financialTransactions.findMany({
          where: and(
            eq(financialTransactions.sessionId, sessionId),
            eq(financialTransactions.type, "fund_contribution"),
          ),
          columns: { id: true },
        });
        const passCycleSeed = priorPass.reduce(
          (mx, r) => (r.id > mx ? r.id : mx),
          0,
        );
        const r = await recordFinancialTransaction(
          {
            type: "fund_contribution",
            direction: "in",
            amount: passRevenue,
            memberId: adminMemberId,
            sessionId,
            description: `Pass sân buổi ${session.date} — admin nhận lại`,
            metadata: { source: "session_passed", sessionId },
            idempotencyKey: `session-pass-${sessionId}-${passCycleSeed}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      await notifySessionCancelled(tx, sessionId, token);
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Không hủy được buổi",
    };
  }
  if (!cancelledNow) {
    // UPDATE không đổi dòng nào: buổi vừa bị hủy hoặc vừa chốt sổ bởi thao tác
    // chạy song song. Đọc lại để trả đúng kết quả như khi gọi tuần tự.
    const current = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { status: true },
    });
    if (current?.status === "completed") {
      return { error: t("cannotCancelCompleted") };
    }
    return { success: true as const, alreadyCancelled: true };
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

/** Ném trong tx của reopenSession để rollback khi buổi không còn ở trạng thái hủy. */
class ReopenRaceLost extends Error {}

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

  // Tìm pass-sân contribution do cancelSession ghi. Chỉ nhận dòng pass: key
  // `session-pass-${id}-${seed}` (hiện tại) hoặc `session-pass-${id}` (bản cũ),
  // hoặc metadata.source = "session_passed" (dòng cũ nhận key tự sinh). Buổi
  // còn có fund_contribution khác mang sessionId (vd dòng cân bằng nợ của
  // webhook ngân hàng, key `bank-payment-balance-*`) mà mở lại buổi KHÔNG được
  // đảo, giống unlockSession. Mỗi vòng hủy(pass) → mở lại sinh một contribution
  // mới, nên lấy cái MỚI NHẤT chưa bị đảo (findFirst không orderBy trước đây
  // nhặt dòng của vòng đầu đã đảo và bỏ sót tiền pass vòng sau).
  const passContributions = await db.query.financialTransactions.findMany({
    where: and(
      eq(financialTransactions.sessionId, sessionId),
      eq(financialTransactions.type, "fund_contribution"),
      eq(financialTransactions.direction, "in"),
      isNull(financialTransactions.reversalOfId),
      or(
        like(
          financialTransactions.idempotencyKey,
          `session-pass-${sessionId}-%`,
        ),
        eq(financialTransactions.idempotencyKey, `session-pass-${sessionId}`),
        // json_valid trước: một dòng metadata hỏng không được làm hỏng cả truy vấn.
        sql`CASE WHEN json_valid(${financialTransactions.metadataJson}) THEN json_extract(${financialTransactions.metadataJson}, '$.source') END = 'session_passed'`,
      ),
    ),
    orderBy: [desc(financialTransactions.id)],
  });

  // Contribution nào đã có reversal thì bỏ qua (idempotency guard).
  let passContribution: (typeof passContributions)[number] | undefined;
  const hadPassContribution = passContributions.length > 0;
  if (hadPassContribution) {
    const reversed = await db
      .select({ reversalOfId: financialTransactions.reversalOfId })
      .from(financialTransactions)
      .where(
        inArray(
          financialTransactions.reversalOfId,
          passContributions.map((c) => c.id),
        ),
      );
    const reversedIds = new Set(reversed.map((r) => r.reversalOfId));
    passContribution = passContributions.find((c) => !reversedIds.has(c.id));
  }

  const token = new Date().toISOString();
  try {
    await db.transaction(async (tx) => {
      if (passContribution) {
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
            // Khoá cố định theo dòng gốc (như `unlock-reverse-*`): UNIQUE
            // index chặn ghi đảo hai lần cho cùng một contribution.
            idempotencyKey: `reopen-reverse-pass-${passContribution.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      const updated = await tx
        .update(sessions)
        .set({
          status: "voting",
          passRevenue: null,
          // Cancelled-session reopen: the old deadline is almost certainly in
          // the past. Clear so admin can re-collect votes; admin can set a
          // new deadline via setVoteDeadline if they want one.
          voteDeadline: null,
          updatedAt: token,
        })
        .where(
          and(eq(sessions.id, sessionId), eq(sessions.status, "cancelled")),
        )
        .returning({ id: sessions.id });
      // Lần mở lại chạy song song đã đổi trạng thái trước: rollback cả dòng
      // đảo tiền pass ở trên (giữ thứ tự ghi cũ) và trả lỗi như mở lại lặp.
      if (updated.length === 0) throw new ReopenRaceLost();

      await notifySessionReopened(tx, sessionId, token);
    });
  } catch (err) {
    if (err instanceof ReopenRaceLost) {
      return { error: t("onlyCancelledCanReopen") };
    }
    return {
      error: err instanceof Error ? err.message : t("reopenFailed"),
    };
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  if (hadPassContribution) {
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
export async function unlockSession(
  sessionId: number,
  clearSettingsSnapshot = false,
) {
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

      // 1b. Reverse min-deduction penalty contributions (to admin) — mirror
      // finalizeSession step 2b. Bước trên chỉ reverse fund_deduction; penalty
      // là fund_contribution của admin nên không bị reverse → unlock để lại
      // admin double-credit (vỡ I1). Match qua idempotencyKey prefix.
      // Bắt CẢ `min-deduction-penalty-*` (gốc) LẪN `re-confirm-penalty-*`
      // (khôi phục sau undo→re-confirm). Nếu chỉ match dạng đầu, penalty được
      // restore sẽ sống sót qua unlock → admin bị cộng dư (vỡ I1) — cùng lớp
      // lỗi với finalize step 2b.
      const priorPenalties = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.sessionId, sessionId),
          eq(financialTransactions.type, "fund_contribution"),
          isNull(financialTransactions.reversalOfId),
          or(
            like(
              financialTransactions.idempotencyKey,
              "min-deduction-penalty-%",
            ),
            like(financialTransactions.idempotencyKey, "re-confirm-penalty-%"),
          ),
        ),
      });
      for (const ptx of priorPenalties) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ptx.id),
          columns: { id: true },
        });
        if (alreadyReversed) continue;
        const r = await recordFinancialTransaction(
          {
            type: "fund_refund",
            direction: "out",
            amount: ptx.amount,
            memberId: ptx.memberId,
            sessionId: ptx.sessionId,
            reversalOfId: ptx.id,
            description: `Hoàn lại phần dư min-60K khi mở lại buổi ${session.date}`,
            metadata: { source: "session_unlocked", sessionId },
            idempotencyKey: `unlock-reverse-penalty-${ptx.id}`,
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

      // 2b. NULL paymentNotifications.matchedDebtId trỏ về các debt sắp xóa.
      // libsql KHÔNG enforce FK nên onDelete:set null không tự chạy → nếu bỏ
      // qua sẽ để lại dangling matchedDebtId (transactions.ts hiện ref chết).
      // Mirror deleteSession.
      const debtIdsToWipe = (
        await tx
          .select({ id: sessionDebts.id })
          .from(sessionDebts)
          .where(eq(sessionDebts.sessionId, sessionId))
      ).map((r) => r.id);
      if (debtIdsToWipe.length > 0) {
        await tx
          .update(paymentNotifications)
          .set({ matchedDebtId: null })
          .where(inArray(paymentNotifications.matchedDebtId, debtIdsToWipe));
      }

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
          // Completed-session unlock: old deadline is past. Clear so admin
          // can re-collect votes without time pressure.
          voteDeadline: null,
          // Bỏ đóng băng cấu hình tiền, CHỈ khi admin tích chọn. Mặc định
          // false nên mọi caller và test cũ hành xử y hệt.
          //
          // Ghi CÙNG câu update đổi status, không tách câu thứ hai: hai câu là
          // hai cơ hội để một câu thành công còn câu kia rollback, để lại buổi
          // đã mở khoá mà vẫn đóng băng (hoặc ngược lại).
          ...(clearSettingsSnapshot ? { settingsSnapshot: null } : {}),
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
      // Thay đổi số dư của từng member do CHÍNH các dòng đảo ghi ở tx này (cho
      // tin hoàn quỹ). Không gom từ liveDeductions: danh sách đó còn chứa khoản
      // đã bị đảo trước đây (mở khoá, hoàn tác).
      const refundDeltas = new Map<number, number>();
      const addDelta = (memberId: number | null, delta: number) => {
        if (memberId === null) return;
        refundDeltas.set(memberId, (refundDeltas.get(memberId) ?? 0) + delta);
      };

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
            idempotencyKey: `delete-session-reverse-deduction-${ftx.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
        if (!r.replayed) addDelta(ftx.memberId, ftx.amount);
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
            idempotencyKey: `delete-session-reverse-contribution-${ftx.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
        if (!r.replayed) addDelta(ftx.memberId, -ftx.amount);
      }

      // Reverse any admin-guest income (session_guest_income) recorded for this
      // session. Nó vào quỹ chung (memberId=null) khi chốt sổ; xóa buổi mà không
      // reverse → getFundOverview.cashOnHand + realIn tháng đó bị dôi vĩnh viễn.
      // Reverse bằng row cùng type direction="out" reversalOfId trỏ về gốc.
      const liveGuestIncome = await tx.query.financialTransactions.findMany({
        where: and(
          eq(financialTransactions.sessionId, sessionId),
          eq(financialTransactions.type, "session_guest_income"),
          isNull(financialTransactions.reversalOfId),
        ),
      });
      for (const ftx of liveGuestIncome) {
        const alreadyReversed = await tx.query.financialTransactions.findFirst({
          where: eq(financialTransactions.reversalOfId, ftx.id),
        });
        if (alreadyReversed) continue;

        const r = await recordFinancialTransaction(
          {
            type: "session_guest_income",
            direction: "out",
            amount: ftx.amount,
            memberId: null,
            sessionId: null,
            reversalOfId: ftx.id,
            description: `Hoàn lại thu khách của admin do xóa buổi ${session.date}`,
            metadata: { reversedDueToSessionDelete: true, sessionId },
            idempotencyKey: `delete-session-reverse-guestincome-${ftx.id}`,
          },
          tx,
        );
        if ("error" in r) throw new Error(r.error);
      }

      await notifySessionDeletedRefund(tx, session, refundDeltas);

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
        .delete(sessionMinDeductionExemptions)
        .where(eq(sessionMinDeductionExemptions.sessionId, sessionId));
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

/** Chuẩn YYYY-MM-DD + là ngày CÓ THẬT (loại "2026-02-30", "2026-13-01"). */
function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split("-").map(Number);
  const d = new Date(`${s}T00:00:00`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.getFullYear() === y &&
    d.getMonth() + 1 === m &&
    d.getDate() === day
  );
}

export async function createSessionManually(
  date: string,
  startTime?: string,
  endTime?: string,
  courtId?: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  // Validate input. Admin-only nhưng vẫn là server action gọi trực tiếp được;
  // AGENTS.md cấm skip validation. Trước đây ngày/giờ rác ("25-99-99"/"25:99")
  // lọt vào DB và sinh voteDeadline "NaN-NaN-NaNTNaN:NaN:NaN".
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!isValidYmd(date)) {
    return { error: "Ngày không hợp lệ (định dạng YYYY-MM-DD)" };
  }
  if (startTime && !HHMM.test(startTime)) {
    return { error: "Giờ bắt đầu không hợp lệ (HH:MM)" };
  }
  if (endTime && !HHMM.test(endTime)) {
    return { error: "Giờ kết thúc không hợp lệ (HH:MM)" };
  }
  if (courtId !== undefined && (!Number.isInteger(courtId) || courtId <= 0)) {
    return { error: "Sân không hợp lệ" };
  }

  // Check if session already exists for this date
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.date, date),
  });
  if (existing) return { error: "Da co buoi choi vao ngay nay" };

  // Resolve court: admin chọn → dùng đó; không chọn → fallback default court.
  // Giá ban đầu tính qua computeCourtTotal — buổi lẻ (ngày khác lịch config,
  // hoặc sân khác default) sẽ ăn giá retail; buổi mặc định ăn giá tháng.
  const [defaultCourt, sessionDays, settings] = await Promise.all([
    getDefaultCourt(),
    getSessionDaysOfWeek(),
    getSettings(),
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
      courtQuantity: settings.defaultCourtQuantity,
      sessionDate: date,
      selectedCourtId: resolvedCourt.id,
      defaultCourtId: defaultCourt?.id ?? null,
      sessionDays,
    });
  }

  // Pre-fill brand mặc định để admin chỉ cần đổi ống nếu cần. Đọc trước tx để
  // trong tx chỉ còn lệnh ghi.
  const defaultBrand = await getDefaultBrand();
  await db.transaction(async (tx) => {
    const [newSession] = await tx
      .insert(sessions)
      .values({
        date,
        status: "voting",
        startTime: startTime || settings.defaultStartTime,
        endTime: endTime || settings.defaultEndTime,
        courtQuantity: settings.defaultCourtQuantity,
        maxPlayers: settings.defaultMaxPlayers,
        courtId: resolvedCourtId,
        courtPrice,
        useMinDeduction: true,
        voteDeadline: computeDefaultDeadline(
          date,
          startTime || settings.defaultStartTime,
          settings.voteDeadlineOffsetHours,
        ),
      })
      .returning();
    if (defaultBrand && newSession) {
      await tx.insert(sessionShuttlecocks).values({
        sessionId: newSession.id,
        brandId: defaultBrand.id,
        quantityUsed: 1,
        pricePerTube: defaultBrand.pricePerTube,
      });
    }
    if (newSession) await notifySessionOpened(tx, newSession.id);
  });
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

  const token = new Date().toISOString();
  // Ghi giá + báo member (khi giá thật sự đổi) trong cùng một transaction.
  const writePrice = (patch: {
    courtPrice?: number;
    courtPriceOverridden: boolean;
  }) =>
    db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ ...patch, updatedAt: token })
        .where(eq(sessions.id, data.sessionId));
      if (
        patch.courtPrice !== undefined &&
        patch.courtPrice !== session.courtPrice
      ) {
        await notifySessionChanged(tx, data.sessionId, ["price"], token);
      }
    });

  // Reset → recompute từ formula.
  if (data.customPrice === null) {
    if (!session.courtId) {
      // Chưa chọn sân → không có gì để recompute, chỉ clear flag.
      await writePrice({ courtPriceOverridden: false });
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
      await writePrice({ courtPrice: autoPrice, courtPriceOverridden: false });
    }
  } else {
    await writePrice({
      courtPrice: data.customPrice,
      courtPriceOverridden: true,
    });
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  revalidatePath("/admin/dashboard");
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
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function setAdminGuestCount(
  sessionId: number,
  guestPlayCount: number,
  guestDineCount: number,
  guestPlayFemaleCount = 0,
  guestDineFemaleCount = 0,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const parsed = adminGuestCountSchema.safeParse({
    sessionId,
    guestPlayCount,
    guestDineCount,
    guestPlayFemaleCount,
    guestDineFemaleCount,
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

  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        adminGuestPlayCount: data.guestPlayCount,
        adminGuestDineCount: data.guestDineCount,
        adminGuestPlayFemaleCount: data.guestPlayFemaleCount,
        adminGuestDineFemaleCount: data.guestDineFemaleCount,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, data.sessionId));
    // Khách của admin tính vào số người chơi, nên xét lại ngưỡng sân.
    await evaluateCapacity(tx, data.sessionId);
  });

  revalidatePath(`/admin/sessions`);
  revalidatePath(`/admin/sessions/${data.sessionId}`);
  revalidatePath("/");
  return { success: true };
}

// ─── Min-deduction floor toggle ───
//
// Per-session opt-in. Khi `useMinDeduction = true`, `finalizeSession` sẽ
// apply `applyMinDeductionFloor` cho mỗi member không đủ quỹ trả play share
// AND play share < sàn (setting `minDeductionAmount`, mặc định 60K, giai đoạn
// 3 Task 4) → override lên sàn đó (admin recover được fund + ép member nộp
// quỹ). Per-member exemption lưu ở `sessionMinDeductionExemptions` (admin có
// thể untick từng người).
//
// Spec: `docs/superpowers/specs/2026-05-15-min-deduction-floor-design.md`.

/**
 * Bật/tắt min-deduction floor cho 1 buổi. Guard `assertEditable` —
 * không cho sửa khi đã chốt sổ (phải `unlockSession` trước).
 */
export async function setSessionUseMinDeduction(
  sessionId: number,
  enabled: boolean,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidData", { detail: "sessionId" }) };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { status: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(session.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  await db
    .update(sessions)
    .set({
      useMinDeduction: enabled,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, sessionId));

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

/**
 * Miễn / không miễn 1 member khỏi min-deduction floor của 1 buổi cụ thể.
 * Insert/delete row idempotent.
 */
export async function setMemberMinDeductionExempt(
  sessionId: number,
  memberId: number,
  exempt: boolean,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (
    !Number.isInteger(sessionId) ||
    sessionId <= 0 ||
    !Number.isInteger(memberId) ||
    memberId <= 0
  ) {
    return { error: t("invalidData", { detail: "ids" }) };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { status: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  const editGuard = assertEditable(session.status as SessionStatus);
  if (!editGuard.ok) return { error: editGuard.error };

  // Validate member tồn tại — tránh insert row trỏ FK rỗng.
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
    columns: { id: true },
  });
  if (!member) return { error: t("memberNotFound") };

  if (exempt) {
    // Insert idempotent — `onConflictDoNothing` chặn double-click race.
    await db
      .insert(sessionMinDeductionExemptions)
      .values({ sessionId, memberId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(sessionMinDeductionExemptions)
      .where(
        and(
          eq(sessionMinDeductionExemptions.sessionId, sessionId),
          eq(sessionMinDeductionExemptions.memberId, memberId),
        ),
      );
  }

  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

/**
 * Trả về danh sách memberId được miễn min-deduction floor cho 1 buổi.
 * Dùng cho UI render checkbox + cho `finalizeSession` skip member exempt.
 */
export async function getSessionExemptions(
  sessionId: number,
): Promise<number[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  if (!Number.isInteger(sessionId) || sessionId <= 0) return [];

  const rows = await db
    .select({ memberId: sessionMinDeductionExemptions.memberId })
    .from(sessionMinDeductionExemptions)
    .where(eq(sessionMinDeductionExemptions.sessionId, sessionId));
  return rows.map((r) => r.memberId);
}

/**
 * Set or clear a session's vote deadline.
 *
 * - `deadline = null` clears the deadline (vote stays open until status changes).
 * - Otherwise must be `YYYY-MM-DDTHH:MM:SS` (no Z) and strictly in the future.
 *
 * See docs/superpowers/specs/2026-05-21-vote-deadline-design.md.
 */
export async function setVoteDeadline(
  sessionId: number,
  deadline: string | null,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }

  const now = new Date();
  if (deadline !== null) {
    // Strict component-level validation: regex alone allows roll-over inputs
    // like "2026-02-30T10:00:00" which JS Date silently coerces to Mar 02.
    // We require the parsed Date to round-trip to the exact components.
    const m =
      typeof deadline === "string"
        ? deadline.match(
            /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
          )
        : null;
    if (!m) return { error: t("invalidDeadlineFormat") };
    const [, y, mo, d, h, mi, s] = m;
    const parsed = new Date(deadline);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== Number(y) ||
      parsed.getMonth() + 1 !== Number(mo) ||
      parsed.getDate() !== Number(d) ||
      parsed.getHours() !== Number(h) ||
      parsed.getMinutes() !== Number(mi) ||
      (s !== undefined && parsed.getSeconds() !== Number(s))
    ) {
      return { error: t("invalidDeadlineFormat") };
    }
    // Hạn là giờ VN: so bằng parseVoteDeadline (ghim +07:00). `parsed` ở trên
    // đọc theo múi giờ máy, trên server UTC sẽ nhận nhầm hạn đã qua 7 tiếng.
    if (parseVoteDeadline(deadline) <= now) {
      return { error: t("deadlineMustBeFuture") };
    }
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { status: true, voteDeadline: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  // Editable check: don't let admin set a deadline on a session that's
  // already completed/cancelled — voting is closed by status, deadline has
  // no effect there, and the UI shouldn't have rendered the edit button in
  // the first place. Defense-in-depth.
  const guard = assertEditable(session.status as SessionStatus);
  if (!guard.ok) return { error: guard.error };

  const token = now.toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        voteDeadline: deadline,
        updatedAt: token,
      })
      .where(eq(sessions.id, sessionId));
    if (
      shouldNotifyVoteReopened(
        {
          status: session.status as SessionStatus,
          voteDeadline: session.voteDeadline,
        },
        deadline,
        now,
      )
    ) {
      await notifyVoteReopened(tx, sessionId, token);
    }
  });

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  // Dashboard cũng render AdminSessionCard (buổi sắp tới) với nút khóa/mở vote,
  // nên phải revalidate luôn, không thì nút giữ nhãn cũ sau khi bấm.
  revalidatePath("/admin/dashboard");
  return { success: true };
}

/**
 * Khóa vote NGAY: đặt `voteDeadline` = giờ VN hiện tại → `now >= deadline` đóng
 * vote tức thì. Tách khỏi {@link setVoteDeadline} (vốn chặn deadline quá khứ với
 * `deadlineMustBeFuture`) vì đây CHỦ Ý đặt deadline = hiện tại để đóng. Reversible:
 * admin mở lại bằng setVoteDeadline (đặt tương lai) hoặc clear (null).
 */
export async function lockVoteNow(sessionId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { status: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  const guard = assertEditable(session.status as SessionStatus);
  if (!guard.ok) return { error: guard.error };

  await db
    .update(sessions)
    .set({ voteDeadline: nowDeadlineVN(), updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, sessionId));

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

/**
 * Admin đặt sức chứa chơi cầu tối đa cho buổi. Nhận số nguyên 1..100 (các mức
 * bấm nhanh trên UI chỉ là gợi ý — admin vẫn được nhập số bất kỳ trong khoảng).
 * Guard editable (không đổi khi đã chốt sổ). KHÔNG đá ai đang vote ra — chỉ
 * chặn vote MỚI vượt số (xem submitVote cap).
 */
export async function setSessionMaxPlayers(
  sessionId: number,
  maxPlayers: number,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) {
    return { error: t("invalidData", { detail: "maxPlayers" }) };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { status: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  const guard = assertEditable(session.status as SessionStatus);
  if (!guard.ok) return { error: guard.error };

  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ maxPlayers, updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId));
    // Đổi sức chứa thì bậc ngưỡng tính lại từ đầu cho sức chứa mới.
    await evaluateCapacity(tx, sessionId);
  });

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

/**
 * Đổi giờ chơi của một buổi đã tạo.
 *
 * Trước 01/11/2026 giờ chơi chỉ đặt được lúc TẠO buổi; tạo nhầm giờ thì cách
 * duy nhất là xoá buổi rồi tạo lại, mà xoá buổi còn kéo theo việc hoàn các
 * khoản đã trừ quỹ và mất sạch lượt vote.
 *
 * Cho sửa với buổi đang vote và buổi đã xác nhận; buổi đã chốt sổ hoặc đã huỷ
 * thì `assertEditable` chặn, đúng như mọi thao tác sửa khác trên buổi.
 *
 * KHÔNG đụng tới hạn vote, dù hạn vote mặc định vốn tính theo `giờ bắt đầu − 4
 * tiếng`. Admin có thể đã tự đặt hạn vote bằng tay, và lặng lẽ dời nó theo là
 * đổi một thứ họ không yêu cầu. Hạn vote vẫn sửa riêng được ở nút bên cạnh.
 */
export async function setSessionTime(
  sessionId: number,
  startTime: string,
  endTime: string,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!HHMM.test(startTime)) {
    return { error: t("invalidData", { detail: "startTime" }) };
  }
  if (!HHMM.test(endTime)) {
    return { error: t("invalidData", { detail: "endTime" }) };
  }
  // Hai giờ bằng nhau chắc chắn là gõ nhầm. Nhưng KHÔNG bắt giờ kết thúc phải
  // lớn hơn giờ bắt đầu: buổi 22:30 tới 00:30 là có thật, chặn lại là chặn
  // một ca dùng đúng.
  if (startTime === endTime) {
    return { error: t("invalidData", { detail: "startTime = endTime" }) };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { status: true, startTime: true, endTime: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  const guard = assertEditable(session.status as SessionStatus);
  if (!guard.ok) return { error: guard.error };

  const timeChanged =
    session.startTime !== startTime || session.endTime !== endTime;
  const token = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ startTime, endTime, updatedAt: token })
      .where(eq(sessions.id, sessionId));
    if (timeChanged) {
      await notifySessionChanged(tx, sessionId, ["time"], token);
    }
  });

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}

/**
 * Quick-extend the vote deadline by 2 or 24 hours. Pushes from `max(now,
 * currentDeadline)` so calling it when the deadline is already in the past
 * resets the clock from now, not from the past.
 */
export async function extendVoteDeadline(sessionId: number, hours: 2 | 24) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }
  if (hours !== 2 && hours !== 24) {
    return { error: t("invalidExtendHours") };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { voteDeadline: true, status: true },
  });
  if (!session) return { error: t("sessionNotFound") };
  const guard = assertEditable(session.status as SessionStatus);
  if (!guard.ok) return { error: guard.error };

  // Hạn lưu theo giờ VN không offset: đọc bằng parseVoteDeadline và ghi bằng
  // nowDeadlineVN. Bản cũ dùng `new Date(hạn)` + formatLocalDeadline theo múi
  // giờ máy, trên server UTC hạn mới lệch sớm 7 tiếng.
  const now = new Date();
  const nowMs = now.getTime();
  const currentDeadlineMs = session.voteDeadline
    ? parseVoteDeadline(session.voteDeadline).getTime()
    : nowMs;
  const baseMs = Math.max(nowMs, currentDeadlineMs);
  const newDeadlineStr = nowDeadlineVN(
    new Date(baseMs + hours * 60 * 60 * 1000),
  );

  const token = now.toISOString();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({
        voteDeadline: newDeadlineStr,
        updatedAt: token,
      })
      .where(eq(sessions.id, sessionId));
    if (
      shouldNotifyVoteReopened(
        {
          status: session.status as SessionStatus,
          voteDeadline: session.voteDeadline,
        },
        newDeadlineStr,
        now,
      )
    ) {
      await notifyVoteReopened(tx, sessionId, token);
    }
  });

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/dashboard");
  return { success: true, voteDeadline: newDeadlineStr };
}
