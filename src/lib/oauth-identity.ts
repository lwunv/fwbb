import { db } from "@/db";
import { members, memberOauthIdentities } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";

export type OAuthProvider = "google" | "facebook";

/** Kiểu transaction của drizzle (tham số callback `db.transaction`). */
type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MemberRow = typeof members.$inferSelect;

/**
 * Tra member từ 1 tài khoản OAuth (provider + uid ổn định của provider).
 *
 * Đi qua bảng `member_oauth_identities` (nguồn sự thật cho multi-SSO), có
 * FALLBACK về cột legacy `members.googleId/facebookId` để an toàn trong cửa sổ
 * trước khi backfill chạy, hoặc khi 1 row được tạo bởi code cũ (chỉ ghi cột
 * legacy). Login flow gọi hàm này rồi lazy-link identity nếu thiếu (xem
 * `ensureOAuthIdentity`).
 */
export async function findMemberByOAuth(
  provider: OAuthProvider,
  uid: string,
): Promise<MemberRow | null> {
  const identity = await db.query.memberOauthIdentities.findFirst({
    where: and(
      eq(memberOauthIdentities.provider, provider),
      eq(memberOauthIdentities.providerUid, uid),
    ),
    columns: { memberId: true },
  });
  if (identity) {
    const m = await db.query.members.findFirst({
      where: eq(members.id, identity.memberId),
    });
    return m ?? null;
  }
  // Fallback cột legacy (row cũ / trước backfill).
  const legacyCol =
    provider === "google" ? members.googleId : members.facebookId;
  const m = await db.query.members.findFirst({
    where: eq(legacyCol, uid),
  });
  return m ?? null;
}

/** Trạng thái liên kết của 1 tài khoản OAuth so với 1 member đang xét. */
export type OAuthLinkState =
  | { state: "free" }
  | { state: "self" }
  | { state: "other"; memberId: number };

/**
 * Xét (provider, uid) đã liên kết chưa và với ai (so với `selfMemberId`).
 * Dùng cho self-service link ở /me: chặn gắn 1 tài khoản đang thuộc member khác.
 */
export async function oauthLinkState(
  provider: OAuthProvider,
  uid: string,
  selfMemberId: number,
): Promise<OAuthLinkState> {
  const identity = await db.query.memberOauthIdentities.findFirst({
    where: and(
      eq(memberOauthIdentities.provider, provider),
      eq(memberOauthIdentities.providerUid, uid),
    ),
    columns: { memberId: true },
  });
  if (identity) {
    return identity.memberId === selfMemberId
      ? { state: "self" }
      : { state: "other", memberId: identity.memberId };
  }
  // Chưa có identity row: kiểm tra cột legacy để không nhận nhầm "free" khi
  // uid thực ra đã thuộc member khác qua cột cũ.
  const legacyCol =
    provider === "google" ? members.googleId : members.facebookId;
  const legacyOwner = await db.query.members.findFirst({
    where: eq(legacyCol, uid),
    columns: { id: true },
  });
  if (legacyOwner) {
    return legacyOwner.id === selfMemberId
      ? { state: "self" }
      : { state: "other", memberId: legacyOwner.id };
  }
  return { state: "free" };
}

/**
 * Đảm bảo tồn tại 1 identity row (provider, uid) cho `memberId`. Idempotent:
 * nếu đã có (cùng member) thì no-op; nếu đã thuộc member KHÁC thì KHÔNG đụng
 * (trả về false — caller xử lý). Dùng để lazy-link lúc login (row cũ chỉ có
 * cột legacy) và khi tạo member mới qua OAuth.
 */
export async function ensureOAuthIdentity(input: {
  memberId: number;
  provider: OAuthProvider;
  uid: string;
  email?: string | null;
}): Promise<boolean> {
  const existing = await db.query.memberOauthIdentities.findFirst({
    where: and(
      eq(memberOauthIdentities.provider, input.provider),
      eq(memberOauthIdentities.providerUid, input.uid),
    ),
    columns: { id: true, memberId: true },
  });
  if (existing) return existing.memberId === input.memberId;
  await db.insert(memberOauthIdentities).values({
    memberId: input.memberId,
    provider: input.provider,
    providerUid: input.uid,
    email: input.email ?? null,
  });
  return true;
}

/** Identity hiển thị ở /me (không lộ uid đầy đủ). */
export interface LinkedIdentity {
  id: number;
  provider: OAuthProvider;
  email: string | null;
  createdAt: string | null;
}

/** Danh sách tài khoản đăng nhập đã liên kết của 1 member (cho /me). */
export async function getMemberIdentities(
  memberId: number,
): Promise<LinkedIdentity[]> {
  const rows = await db.query.memberOauthIdentities.findMany({
    where: eq(memberOauthIdentities.memberId, memberId),
    columns: { id: true, provider: true, email: true, createdAt: true },
    orderBy: (t, { asc }) => [asc(t.id)],
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider as OAuthProvider,
    email: r.email,
    createdAt: r.createdAt,
  }));
}

/**
 * Đếm số "đường đăng nhập" còn lại của member nếu gỡ đi 1 identity: tổng
 * identity + (có passwordHash ? 1 : 0). Dùng để chặn gỡ identity CUỐI CÙNG khi
 * member không có mật khẩu (nếu không họ sẽ mất hẳn đường vào).
 */
export async function countLoginMethods(memberId: number): Promise<{
  identities: number;
  hasPassword: boolean;
}> {
  const [ids, m] = await Promise.all([
    db.query.memberOauthIdentities.findMany({
      where: eq(memberOauthIdentities.memberId, memberId),
      columns: { id: true },
    }),
    db.query.members.findFirst({
      where: eq(members.id, memberId),
      columns: { passwordHash: true },
    }),
  ]);
  return { identities: ids.length, hasPassword: !!m?.passwordHash };
}

/**
 * Gộp toàn bộ tài khoản đăng nhập của `sourceId` vào `targetId` TRONG 1 tx
 * (dùng bởi mergeMember + approveAndMergeMember). Sau khi gọi, target đăng nhập
 * được bằng MỌI tài khoản OAuth mà source từng dùng.
 *
 * - Re-point mọi identity row source → target (uid unique toàn cục nên không
 *   đụng UNIQUE(provider, uid)).
 * - Tạo identity cho cột legacy googleId/facebookId của source nếu chưa có row
 *   (trường hợp backfill chưa chạy) → không mất đường đăng nhập nào.
 *
 * CHÚ Ý: gọi TRƯỚC khi xóa source (FK onDelete=cascade sẽ xóa identity còn trỏ
 * về source nếu chưa re-point).
 */
export async function foldOAuthIntoTarget(
  tx: DrizzleTx,
  sourceId: number,
  targetId: number,
  sourceLegacy: {
    googleId: string | null;
    facebookId: string | null;
    email: string | null;
  },
): Promise<void> {
  await tx
    .update(memberOauthIdentities)
    .set({ memberId: targetId })
    .where(eq(memberOauthIdentities.memberId, sourceId));

  const legacy: Array<[OAuthProvider, string | null, string | null]> = [
    ["google", sourceLegacy.googleId, sourceLegacy.email],
    ["facebook", sourceLegacy.facebookId, null],
  ];
  for (const [provider, uid, email] of legacy) {
    if (!uid) continue;
    const exists = await tx.query.memberOauthIdentities.findFirst({
      where: and(
        eq(memberOauthIdentities.provider, provider),
        eq(memberOauthIdentities.providerUid, uid),
      ),
      columns: { id: true },
    });
    if (!exists) {
      await tx.insert(memberOauthIdentities).values({
        memberId: targetId,
        provider,
        providerUid: uid,
        email: email ?? null,
      });
    }
  }
}

/** Guard tiện dụng: uid này có thuộc member nào KHÁC `selfMemberId` không. */
export async function isOAuthTakenByOther(
  provider: OAuthProvider,
  uid: string,
  selfMemberId: number,
): Promise<boolean> {
  const other = await db.query.memberOauthIdentities.findFirst({
    where: and(
      eq(memberOauthIdentities.provider, provider),
      eq(memberOauthIdentities.providerUid, uid),
      ne(memberOauthIdentities.memberId, selfMemberId),
    ),
    columns: { id: true },
  });
  return !!other;
}
