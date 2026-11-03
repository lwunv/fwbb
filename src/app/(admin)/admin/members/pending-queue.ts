import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, memberOauthIdentities } from "@/db/schema";
import { isExchangeAccount } from "@/lib/exchange-account";

/**
 * Hàng chờ duyệt = pending VÀ đã xin vào nhóm (`signupIntent = "group"`). Tài
 * khoản giao lưu (pending + exchange) chưa xin vào nhóm nên không làm phiền
 * admin ở đây; nó chỉ hiện ở mục chỉ đọc "Tài khoản giao lưu".
 */
const pendingGroupWhere = and(
  eq(members.approvalStatus, "pending"),
  eq(members.signupIntent, "group"),
);

/** Các dòng của hàng chờ duyệt, cũ nhất trước. */
export function loadPendingGroupRows() {
  return db.query.members.findMany({
    where: pendingGroupWhere,
    orderBy: [asc(members.createdAt)],
  });
}

/** Số hiện trên sidebar admin; cùng điều kiện với hàng chờ để hai nơi không lệch. */
export async function countPendingGroupMembers(): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(members)
    .where(pendingGroupWhere);
  return Number(rows[0]?.c ?? 0);
}

/** Tách danh sách member thành nhóm thường và tài khoản giao lưu. */
export function splitExchangeAccounts<
  T extends { approvalStatus: string; signupIntent: string },
>(rows: T[]): { regular: T[]; exchange: T[] } {
  const regular: T[] = [];
  const exchange: T[] = [];
  for (const r of rows) (isExchangeAccount(r) ? exchange : regular).push(r);
  return { regular, exchange };
}

export type IdentityProvider =
  (typeof memberOauthIdentities.$inferSelect)["provider"];

/**
 * Provider đăng nhập của các member được hỏi, nạp bằng MỘT truy vấn `inArray`
 * (trang tự tải lại vài giây một lần nên không được truy vấn theo từng dòng).
 */
export async function loadIdentityProviders(
  memberIds: number[],
): Promise<Record<number, IdentityProvider[]>> {
  if (memberIds.length === 0) return {};
  const rows = await db
    .select({
      memberId: memberOauthIdentities.memberId,
      provider: memberOauthIdentities.provider,
    })
    .from(memberOauthIdentities)
    .where(inArray(memberOauthIdentities.memberId, memberIds));
  const out: Record<number, IdentityProvider[]> = {};
  for (const r of rows) (out[r.memberId] ??= []).push(r.provider);
  return out;
}
