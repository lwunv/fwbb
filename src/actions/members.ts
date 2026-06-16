"use server";

import { db } from "@/db";
import {
  members,
  votes,
  sessionAttendees,
  sessionDebts,
  financialTransactions,
  admins,
  passwordResetTokens,
} from "@/db/schema";
import { eq, sql, or, ne, and, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";
import { requireAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { memberSchema } from "@/lib/validators";
import { AVATAR_BRAND_KEYS } from "@/lib/member-avatar-presets";
import { AVATAR_EMOJI_COUNT } from "@/lib/member-avatar-emoji";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { z } from "zod";

export type UpdateMyProfileState = null | { success: true } | { error: string };

/**
 * Admin-only: full member rows including sensitive fields (facebookId, email, bankAccountNo).
 * Returns [] if caller is not admin.
 */
export async function getMembers() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  return db.query.members.findMany({
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

/**
 * Public-safe member list. Returns the full Member shape so existing component
 * prop types still resolve, but PII fields (facebookId / email / bankAccountNo)
 * are scrubbed at the action boundary. Admin pages should use `getMembers()`
 * for the real values.
 */
export async function getActiveMembers() {
  const rows = await db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (m, { asc }) => [asc(m.name)],
    // Do not load PII columns from the DB at all (public pickers / home / vote).
    columns: {
      id: true,
      name: true,
      nickname: true,
      avatarKey: true,
      avatarUrl: true,
      isActive: true,
      defaultWithPartner: true,
      createdAt: true,
    },
  });
  return rows.map((m) => ({
    ...m,
    facebookId: null,
    googleId: null,
    email: null,
    passwordHash: null,
    bankAccountNo: null,
    phoneNumber: null,
    approvalStatus: "approved" as const,
    approvedAt: null,
    approvedBy: null,
  }));
}

/**
 * Trùng tên member = bug hay gây nhầm lẫn trong danh sách quỹ/nợ. Chuẩn hóa
 * bằng `LOWER(TRIM(name))` để "Liên" / "  liên " / "LIÊN" coi là cùng tên.
 * `excludeId` để cho phép updateMember giữ nguyên tên cũ.
 */
async function isDuplicateName(name: string, excludeId?: number) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  const conds = [
    sql`lower(trim(${members.name})) = ${normalized}`,
    excludeId ? ne(members.id, excludeId) : undefined,
  ].filter(Boolean) as ReturnType<typeof sql>[];
  const dup = await db.query.members.findFirst({
    where: and(...conds),
    columns: { id: true },
  });
  return !!dup;
}

export async function createMember(formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (await isDuplicateName(parsed.data.name)) {
    return {
      error: t("memberNameTaken", { name: parsed.data.name.trim() }),
    };
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  // KHÔNG set facebookId placeholder. Member admin tạo phải để facebookId +
  // googleId = NULL thì merge flow mới nhận diện được: getNameMatches lọc
  // `!facebookId && !googleId` (chỉ gợi ý row chưa link OAuth), và
  // approveAndMergeMember chỉ graft OAuth vào placeholder rỗng-credential.
  // Fake id `admin_<ts>_<rand>` cũ khiến row admin-tạo KHÔNG bao giờ được gợi ý
  // merge khi chính chủ signup (FB login tra theo id thật, không replace fake).
  // Member email+password cũng đã insert với facebookId NULL — đồng nhất.
  await db.insert(members).values({ ...parsed.data, nickname });
  revalidatePath("/admin/members");
  return { success: true };
}

const avatarBrandSchema = z.enum(AVATAR_BRAND_KEYS);
const avatarEmojiSchema = z
  .string()
  .regex(/^emoji:\d+$/)
  .refine((s) => {
    const n = parseInt(s.slice("emoji:".length), 10);
    return Number.isFinite(n) && n >= 0 && n < AVATAR_EMOJI_COUNT;
  });
const avatarStorageSchema = z.union([avatarBrandSchema, avatarEmojiSchema]);

export type UpdateMyAvatarState = { success: true } | { error: string };

/** Đặt avatar: hãng vợt, `emoji:n`, hoặc `null` = emoji tự động theo id */
export async function updateMyAvatar(
  avatarKey: string | null,
): Promise<UpdateMyAvatarState> {
  const t = await getTranslations("me");
  const user = await getUserFromCookie();
  if (!user) {
    return { error: t("profileNotSignedIn") };
  }
  // Rate limit: each call purges up to 9 cache paths → throttle cache-stampede
  // spam (key on the HMAC-signed, non-spoofable cookie memberId).
  const rl = await checkRateLimit(`profile:${user.memberId}`, 20, 60_000);
  if (!rl.ok) {
    const tErr = await getTranslations("serverErrors");
    return { error: tErr("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  let next: string | null = null;
  if (avatarKey !== null && avatarKey !== "") {
    const p = avatarStorageSchema.safeParse(avatarKey);
    if (!p.success) {
      return { error: t("profileInvalid") };
    }
    next = p.data;
  }

  await db
    .update(members)
    .set({ avatarKey: next })
    .where(eq(members.id, user.memberId));

  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/my-debts");
  revalidatePath("/stats");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/members");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function updateMyProfile(
  _prev: UpdateMyProfileState,
  formData: FormData,
): Promise<UpdateMyProfileState> {
  const t = await getTranslations("me");
  const user = await getUserFromCookie();
  if (!user) {
    return { error: t("profileNotSignedIn") };
  }
  const rl = await checkRateLimit(`profile:${user.memberId}`, 20, 60_000);
  if (!rl.ok) {
    const tErr = await getTranslations("serverErrors");
    return { error: tErr("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }

  const nicknameRaw = String(formData.get("nickname") ?? "").trim();

  if (nicknameRaw.length > 40) {
    return { error: t("nicknameTooLong") };
  }
  const nickname = nicknameRaw.length === 0 ? null : nicknameRaw;

  await db
    .update(members)
    .set({ nickname })
    .where(eq(members.id, user.memberId));

  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/my-debts");
  return { success: true };
}

export async function updateMember(id: number, formData: FormData) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (await isDuplicateName(parsed.data.name, id)) {
    return {
      error: t("memberNameTaken", { name: parsed.data.name.trim() }),
    };
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  await db
    .update(members)
    .set({ ...parsed.data, nickname })
    .where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}

/**
 * Trả về memberId được liên kết với admin hiện tại (cookie). Null nếu chưa link.
 * Dùng cho UI hiển thị 👑 trên member-list.
 */
export async function getCurrentAdminMemberId(): Promise<number | null> {
  const auth = await requireAdmin();
  if ("error" in auth) return null;
  const adminId = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminId)) return null;
  const row = await db.query.admins.findFirst({
    where: eq(admins.id, adminId),
    columns: { memberId: true },
  });
  return row?.memberId ?? null;
}

/**
 * Liên kết tài khoản admin hiện tại với 1 member. Cần thiết để `finalizeSession`
 * /  `closeSession` chạy được — admin phải biết "tôi là member nào" để loại
 * mình khỏi divisor + tránh tự tạo nợ cho chính mình.
 *
 * Pass `null` để hủy liên kết.
 */
export async function linkAdminToMember(memberId: number | null) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");
  const adminId = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminId)) {
    return { error: t("invalidAdminToken") };
  }

  if (memberId !== null) {
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return { error: t("invalidMemberId") };
    }
    const m = await db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { id: true },
    });
    if (!m) return { error: t("memberNotFoundShort") };
  }

  await db.update(admins).set({ memberId }).where(eq(admins.id, adminId));

  revalidatePath("/admin/members");
  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return { error: t("memberNotFound") };
  await db
    .update(members)
    .set({ isActive: !member.isActive })
    .where(eq(members.id, id));
  // Khóa/mở member = rời/vào quỹ (roster derive từ isActive). KHÔNG auto-hoàn —
  // balance đóng băng. Revalidate mọi surface phụ thuộc roster quỹ.
  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  revalidatePath("/admin/dashboard");
  revalidatePath("/my-fund");
  revalidatePath("/");
  return { success: true };
}

/**
 * Hard delete thành viên. Block khi còn dữ liệu tham chiếu (vote, attendance,
 * debt, fund, ledger, hoặc admin link). Member dính giao dịch tài chính phải
 * giữ — admin nên dùng `toggleMemberActive` để vô hiệu hóa thay vì xóa
 * (financial audit trail bị vỡ nếu hard-delete một member có ledger entry).
 */
export async function deleteMember(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return { error: t("memberNotFound") };

  const [{ voteCount }] = await db
    .select({ voteCount: sql<number>`count(*)` })
    .from(votes)
    .where(eq(votes.memberId, id));
  const [{ attendCount }] = await db
    .select({ attendCount: sql<number>`count(*)` })
    .from(sessionAttendees)
    .where(
      or(
        eq(sessionAttendees.memberId, id),
        eq(sessionAttendees.invitedById, id),
      ),
    );
  const [{ debtCount }] = await db
    .select({ debtCount: sql<number>`count(*)` })
    .from(sessionDebts)
    .where(eq(sessionDebts.memberId, id));
  const [{ ledgerCount }] = await db
    .select({ ledgerCount: sql<number>`count(*)` })
    .from(financialTransactions)
    .where(eq(financialTransactions.memberId, id));
  const [{ adminCount }] = await db
    .select({ adminCount: sql<number>`count(*)` })
    .from(admins)
    .where(eq(admins.memberId, id));

  const refs: string[] = [];
  if (Number(voteCount) > 0)
    refs.push(t("refVote", { count: Number(voteCount) }));
  if (Number(attendCount) > 0)
    refs.push(t("refAttendance", { count: Number(attendCount) }));
  if (Number(debtCount) > 0)
    refs.push(t("refDebt", { count: Number(debtCount) }));
  if (Number(ledgerCount) > 0)
    refs.push(t("refLedger", { count: Number(ledgerCount) }));
  if (Number(adminCount) > 0) refs.push(t("refAdminLink"));

  if (refs.length > 0) {
    return {
      error: t("memberInUse", { refs: refs.join(", ") }),
    };
  }

  await db.delete(members).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}

/**
 * Tìm các nhóm member trùng tên (case-insensitive, trim). Mỗi nhóm trả về
 * đầy đủ id + balance (sum financialTransactions in - out) + ledger count
 * + isActive để admin chọn ID giữ lại trước khi merge.
 */
export async function findDuplicateMembers() {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      nickname: members.nickname,
      avatarKey: members.avatarKey,
      avatarUrl: members.avatarUrl,
      isActive: members.isActive,
      facebookId: members.facebookId,
      normalized: sql<string>`lower(trim(${members.name}))`,
    })
    .from(members);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.normalized) continue;
    const list = groups.get(r.normalized) ?? [];
    list.push(r);
    groups.set(r.normalized, list);
  }

  const dupGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  if (dupGroups.length === 0) return [];

  // Pre-compute balance + ledger count cho từng member trong các nhóm dupe.
  // Dùng helper canonical `computeBalanceFromTransactions` thay vì sum
  // direction=in/out — trước đây sum này double-count `bank_payment_received`
  // (paired với fund_contribution) và cộng nhầm legacy `debt_*_confirmed`
  // direction=in → balance inflate, admin nhìn dupe report bị lệch. Giờ
  // chỉ tính từ fund_contribution / fund_deduction / fund_refund (reversal
  // pairs loại trừ tự động).
  const dupIds = dupGroups.flat().map((m) => m.id);
  const ledger = await db
    .select({
      id: financialTransactions.id,
      memberId: financialTransactions.memberId,
      type: financialTransactions.type,
      amount: financialTransactions.amount,
      reversalOfId: financialTransactions.reversalOfId,
    })
    .from(financialTransactions)
    .where(inArray(financialTransactions.memberId, dupIds));

  const txsByMember = new Map<number, typeof ledger>();
  const countByMember = new Map<number, number>();
  for (const id of dupIds) {
    txsByMember.set(id, []);
    countByMember.set(id, 0);
  }
  for (const t of ledger) {
    if (t.memberId == null) continue;
    txsByMember.get(t.memberId)?.push(t);
    countByMember.set(t.memberId, (countByMember.get(t.memberId) ?? 0) + 1);
  }
  const balanceById = new Map<number, { balance: number; count: number }>();
  for (const id of dupIds) {
    const txs = txsByMember.get(id) ?? [];
    const { balance } = computeBalanceFromTransactions(id, txs);
    balanceById.set(id, { balance, count: countByMember.get(id) ?? 0 });
  }

  return dupGroups.map((g) => ({
    name: g[0].name,
    members: g.map((m) => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      avatarKey: m.avatarKey,
      avatarUrl: m.avatarUrl,
      isActive: !!m.isActive,
      facebookId: m.facebookId,
      balance: balanceById.get(m.id)?.balance ?? 0,
      ledgerCount: balanceById.get(m.id)?.count ?? 0,
    })),
  }));
}

/**
 * Gộp `sourceId` vào `targetId`: chuyển toàn bộ FK (votes, attendees, debts,
 * fund, ledger, admin link) từ source → target trong 1 transaction, rồi xóa
 * row source. Conflict resolution: nếu target đã có row cho cùng session
 * (votes / debts có UNIQUE constraint), giữ row của target, xóa của source.
 *
 * Ghi chú tài chính: balance được tính từ `financialTransactions`. Sau khi
 * `UPDATE memberId` từ source → target, balance của target = sum cả 2 cũ.
 * Đảm bảo `reconcile-fund` (I8) vẫn pass vì tổng in/out không đổi, chỉ đổi
 * chủ sở hữu.
 */
export async function mergeMember(sourceId: number, targetId: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    return { error: t("invalidId") };
  }
  if (sourceId === targetId) {
    return { error: t("cannotMergeSelf") };
  }

  const [source, target] = await Promise.all([
    db.query.members.findFirst({ where: eq(members.id, sourceId) }),
    db.query.members.findFirst({ where: eq(members.id, targetId) }),
  ]);
  if (!source) return { error: t("sourceMemberNotFound") };
  if (!target) return { error: t("targetMemberNotFound") };

  await db.transaction(async (tx) => {
    // 1. votes — UNIQUE (sessionId, memberId). Lấy danh sách session mà target
    //    đã có vote → xóa source ở các session đó (giữ target). Còn lại update.
    const targetVoteSessionIds = (
      await tx
        .select({ sessionId: votes.sessionId })
        .from(votes)
        .where(eq(votes.memberId, targetId))
    ).map((r) => r.sessionId);
    if (targetVoteSessionIds.length > 0) {
      await tx
        .delete(votes)
        .where(
          and(
            eq(votes.memberId, sourceId),
            inArray(votes.sessionId, targetVoteSessionIds),
          ),
        );
    }
    await tx
      .update(votes)
      .set({ memberId: targetId })
      .where(eq(votes.memberId, sourceId));

    // 2. sessionDebts — UNIQUE (sessionId, memberId). Cùng pattern. Không
    //    cộng dồn amount: source coi như duplicate, giữ row target.
    const targetDebtSessionIds = (
      await tx
        .select({ sessionId: sessionDebts.sessionId })
        .from(sessionDebts)
        .where(eq(sessionDebts.memberId, targetId))
    ).map((r) => r.sessionId);
    if (targetDebtSessionIds.length > 0) {
      // Trước khi xóa debt source bị conflict, NULL out FK từ ledger để
      // tránh dangling reference. Tương tự deleteSession pattern.
      const conflictDebtIds = (
        await tx
          .select({ id: sessionDebts.id })
          .from(sessionDebts)
          .where(
            and(
              eq(sessionDebts.memberId, sourceId),
              inArray(sessionDebts.sessionId, targetDebtSessionIds),
            ),
          )
      ).map((r) => r.id);
      if (conflictDebtIds.length > 0) {
        // F2 FIX: source và target đều đã finalize cùng session → mỗi bên
        // có 1 `fund_deduction` riêng cho cùng amount. Nếu chỉ NULL debtId
        // rồi step 4 bulk-update memberId source→target, target sẽ có 2
        // `fund_deduction` LIVE cho cùng session → bị trừ tiền 2 lần.
        //
        // Fix: trước khi xóa source debt, reverse các source fund_deduction
        // gắn với chúng (insert paired fund_contribution với reversalOfId).
        // Reversal row giữ memberId=sourceId để step 4 re-point cả cặp →
        // sau merge target có 1 deduction live + 1 voided pair, balance đúng.
        //
        // Cũng reverse các fund_contribution penalty/balance-fix nằm trên
        // các debt source bị drop (admin min-deduction surplus có
        // memberId=admin ≠ sourceId, nên KHÔNG được step 4 đụng đến →
        // phải reverse ở đây để admin không bị double-credit penalty).
        const sourceDeductions = await tx.query.financialTransactions.findMany({
          where: and(
            eq(financialTransactions.type, "fund_deduction"),
            inArray(financialTransactions.debtId, conflictDebtIds),
            isNull(financialTransactions.reversalOfId),
          ),
        });
        for (const d of sourceDeductions) {
          // Idempotent: skip nếu đã có reversal pointing at this row.
          const existing = await tx.query.financialTransactions.findFirst({
            where: eq(financialTransactions.reversalOfId, d.id),
            columns: { id: true },
          });
          if (existing) continue;
          const r = await recordFinancialTransaction(
            {
              type: "fund_contribution",
              direction: "in",
              amount: d.amount,
              // Giữ memberId=source — step 4 re-point cả cặp → target
              // sở hữu cả deduction lẫn reversal → balance net = 0 cho
              // cặp đó, target chỉ còn deduction của riêng mình live.
              memberId: d.memberId,
              sessionId: d.sessionId,
              // debtId sắp được NULL out ngay sau loop này; giữ null từ đầu
              // cho khớp với state cuối cùng (debt sẽ bị xóa).
              debtId: null,
              reversalOfId: d.id,
              description: `Hoàn lại trừ quỹ khi merge member ${sourceId} → ${targetId} (debt #${d.debtId} bị drop)`,
              metadata: {
                source: "merge_member_conflict_reversal",
                fromMember: sourceId,
                toMember: targetId,
              },
              idempotencyKey: `merge-reverse-deduction-${d.id}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }

        // Admin penalty / bank balance-fix contributions tied to source's
        // dropped debts. memberId of these rows can be ≠ source (admin
        // penalty has memberId=adminMemberId). Reverse all of them so
        // admin isn't double-credited and bank balance-fix isn't orphaned.
        const sourceContribs = await tx.query.financialTransactions.findMany({
          where: and(
            eq(financialTransactions.type, "fund_contribution"),
            inArray(financialTransactions.debtId, conflictDebtIds),
            isNull(financialTransactions.reversalOfId),
          ),
        });
        for (const c of sourceContribs) {
          if (c.memberId === null) continue;
          const existing = await tx.query.financialTransactions.findFirst({
            where: eq(financialTransactions.reversalOfId, c.id),
            columns: { id: true },
          });
          if (existing) continue;
          const r = await recordFinancialTransaction(
            {
              type: "fund_refund",
              direction: "out",
              amount: c.amount,
              memberId: c.memberId,
              sessionId: c.sessionId,
              debtId: null,
              reversalOfId: c.id,
              description: `Hoàn lại phụ phí khi merge member ${sourceId} → ${targetId} (debt #${c.debtId} bị drop)`,
              metadata: {
                source: "merge_member_conflict_contrib_reversal",
                fromMember: sourceId,
                toMember: targetId,
              },
              idempotencyKey: `merge-reverse-contrib-${c.id}`,
            },
            tx,
          );
          if ("error" in r) throw new Error(r.error);
        }

        await tx
          .update(financialTransactions)
          .set({ debtId: null })
          .where(inArray(financialTransactions.debtId, conflictDebtIds));
        await tx
          .delete(sessionDebts)
          .where(inArray(sessionDebts.id, conflictDebtIds));
      }
    }
    await tx
      .update(sessionDebts)
      .set({ memberId: targetId })
      .where(eq(sessionDebts.memberId, sourceId));

    // 3. sessionAttendees — không UNIQUE, chỉ cần update.
    await tx
      .update(sessionAttendees)
      .set({ memberId: targetId })
      .where(eq(sessionAttendees.memberId, sourceId));
    await tx
      .update(sessionAttendees)
      .set({ invitedById: targetId })
      .where(eq(sessionAttendees.invitedById, sourceId));

    // 4. financialTransactions — bulk update. Balance của target sẽ tự sum.
    await tx
      .update(financialTransactions)
      .set({ memberId: targetId })
      .where(eq(financialTransactions.memberId, sourceId));

    // 5. (removed fundMembers re-point — roster derive từ members.isActive,
    //     không còn bảng fund_members. Ledger đã re-point ở bước 4.)

    // 6. admins.memberId — chuyển link nếu source được link.
    await tx
      .update(admins)
      .set({ memberId: targetId })
      .where(eq(admins.memberId, sourceId));

    // 6b. Vô hiệu reset-token đang chờ của source — không mang link đặt lại
    //     mật khẩu qua merge. Explicit dù FK đã cascade: vẫn an toàn nếu
    //     foreign_keys enforcement bị tắt trên một connection nào đó.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date().toISOString() })
      .where(
        and(
          eq(passwordResetTokens.memberId, sourceId),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    // 7. Xóa member nguồn.
    await tx.delete(members).where(eq(members.id, sourceId));
  });

  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/dashboard");
  return { success: true };
}
