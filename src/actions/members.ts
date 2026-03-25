"use server";

import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getUserFromCookie } from "@/lib/user-identity";
import { memberSchema } from "@/lib/validators";
import { AVATAR_BRAND_KEYS } from "@/lib/member-avatar-presets";
import { AVATAR_EMOJI_COUNT } from "@/lib/member-avatar-emoji";
import { z } from "zod";

export type UpdateMyProfileState =
  | null
  | { success: true }
  | { error: string };

export async function getMembers() {
  return db.query.members.findMany({
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

export async function getActiveMembers() {
  return db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (m, { asc }) => [asc(m.name)],
  });
}

export async function createMember(formData: FormData) {
  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
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
export async function updateMyAvatar(avatarKey: string | null): Promise<UpdateMyAvatarState> {
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

  await db.update(members).set({ avatarKey: next }).where(eq(members.id, user.memberId));

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
  const raw = {
    name: formData.get("name") as string,
  };
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const nickname = (formData.get("nickname") as string)?.trim() || null;
  await db.update(members).set({ ...parsed.data, nickname }).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}

export async function toggleMemberActive(id: number) {
  const member = await db.query.members.findFirst({ where: eq(members.id, id) });
  if (!member) return { error: "Khong tim thay thanh vien" };
  await db.update(members).set({ isActive: !member.isActive }).where(eq(members.id, id));
  revalidatePath("/admin/members");
  return { success: true };
}
