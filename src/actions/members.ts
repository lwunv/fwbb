"use server";

import { db } from "@/db";
import {
  members,
  votes,
  sessionAttendees,
  sessionDebts,
  fundMembers,
  financialTransactions,
  admins,
} from "@/db/schema";
import { eq, sql, or, ne, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";
import { requireAdmin } from "@/lib/auth";
import { memberSchema } from "@/lib/validators";
import { AVATAR_BRAND_KEYS } from "@/lib/member-avatar-presets";
import { AVATAR_EMOJI_COUNT } from "@/lib/member-avatar-emoji";
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
      createdAt: true,
    },
  });
  return rows.map((m) => ({
    ...m,
    facebookId: "",
    email: null,
    bankAccountNo: null,
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

  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (await isDuplicateName(parsed.data.name)) {
    return { error: `Đã có thành viên tên "${parsed.data.name.trim()}"` };
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  // Admin-created members get a placeholder facebookId (will be replaced on first FB login)
  const facebookId = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(members).values({ ...parsed.data, nickname, facebookId });
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

  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (await isDuplicateName(parsed.data.name, id)) {
    return { error: `Đã có thành viên tên "${parsed.data.name.trim()}"` };
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
  const adminId = parseInt(String(auth.admin.sub ?? ""), 10);
  if (!Number.isFinite(adminId)) {
    return { error: "Admin token không hợp lệ" };
  }

  if (memberId !== null) {
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return { error: "memberId không hợp lệ" };
    }
    const m = await db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { id: true },
    });
    if (!m) return { error: "Không tìm thấy member" };
  }

  await db.update(admins).set({ memberId }).where(eq(admins.id, adminId));

  revalidatePath("/admin/members");
  revalidatePath("/admin/sessions");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return { error: "Khong tim thay thanh vien" };
  await db
    .update(members)
    .set({ isActive: !member.isActive })
    .where(eq(members.id, id));
  revalidatePath("/admin/members");
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

  const member = await db.query.members.findFirst({
    where: eq(members.id, id),
  });
  if (!member) return { error: "Không tìm thấy thành viên" };

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
  const [{ fundCount }] = await db
    .select({ fundCount: sql<number>`count(*)` })
    .from(fundMembers)
    .where(eq(fundMembers.memberId, id));
  const [{ ledgerCount }] = await db
    .select({ ledgerCount: sql<number>`count(*)` })
    .from(financialTransactions)
    .where(eq(financialTransactions.memberId, id));
  const [{ adminCount }] = await db
    .select({ adminCount: sql<number>`count(*)` })
    .from(admins)
    .where(eq(admins.memberId, id));

  const refs: string[] = [];
  if (Number(voteCount) > 0) refs.push(`${voteCount} vote`);
  if (Number(attendCount) > 0) refs.push(`${attendCount} buổi tham gia`);
  if (Number(debtCount) > 0) refs.push(`${debtCount} khoản nợ`);
  if (Number(fundCount) > 0) refs.push(`${fundCount} dòng quỹ`);
  if (Number(ledgerCount) > 0) refs.push(`${ledgerCount} giao dịch`);
  if (Number(adminCount) > 0) refs.push(`liên kết admin`);

  if (refs.length > 0) {
    return {
      error: `Không xóa được — còn ${refs.join(", ")}. Hãy "Vô hiệu hóa" thay vì xóa.`,
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
  const dupIds = dupGroups.flat().map((m) => m.id);
  const ledger = await db
    .select({
      memberId: financialTransactions.memberId,
      direction: financialTransactions.direction,
      amount: financialTransactions.amount,
    })
    .from(financialTransactions)
    .where(inArray(financialTransactions.memberId, dupIds));

  const balanceById = new Map<number, { balance: number; count: number }>();
  for (const id of dupIds) balanceById.set(id, { balance: 0, count: 0 });
  for (const t of ledger) {
    if (t.memberId == null) continue;
    const cur = balanceById.get(t.memberId);
    if (!cur) continue;
    cur.count += 1;
    if (t.direction === "in") cur.balance += t.amount;
    else if (t.direction === "out") cur.balance -= t.amount;
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

  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    return { error: "ID không hợp lệ" };
  }
  if (sourceId === targetId) {
    return { error: "Không thể gộp một thành viên với chính nó" };
  }

  const [source, target] = await Promise.all([
    db.query.members.findFirst({ where: eq(members.id, sourceId) }),
    db.query.members.findFirst({ where: eq(members.id, targetId) }),
  ]);
  if (!source) return { error: "Không tìm thấy member nguồn" };
  if (!target) return { error: "Không tìm thấy member đích" };

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

    // 5. fundMembers — UNIQUE memberId. Nếu target đã có row, xóa source row;
    //    nếu chỉ source có, update sang target.
    const targetFund = await tx.query.fundMembers.findFirst({
      where: eq(fundMembers.memberId, targetId),
    });
    if (targetFund) {
      await tx.delete(fundMembers).where(eq(fundMembers.memberId, sourceId));
    } else {
      await tx
        .update(fundMembers)
        .set({ memberId: targetId })
        .where(eq(fundMembers.memberId, sourceId));
    }

    // 6. admins.memberId — chuyển link nếu source được link.
    await tx
      .update(admins)
      .set({ memberId: targetId })
      .where(eq(admins.memberId, sourceId));

    // 7. Xóa member nguồn.
    await tx.delete(members).where(eq(members.id, sourceId));
  });

  revalidatePath("/admin/members");
  revalidatePath("/admin/fund");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/dashboard");
  return { success: true };
}
