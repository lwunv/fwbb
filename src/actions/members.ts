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
import { eq, sql, or } from "drizzle-orm";
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
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  await db
    .update(members)
    .set({ ...parsed.data, nickname })
    .where(eq(members.id, id));
  revalidatePath("/admin/members");
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
