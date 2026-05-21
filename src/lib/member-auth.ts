import { db } from "@/db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserFromCookie } from "./user-identity";

/**
 * Authoritative gate for member-side mutations: cookie valid + member exists
 * + approvalStatus === "approved" + isActive. Pending/rejected/deactivated
 * users with a still-valid cookie cannot reach money or vote flows.
 *
 * Previously a UI-only gate in (public)/layout.tsx blocked rendering for
 * pending users, but Next.js server actions are POST-callable directly via
 * RPC — bypassing layout entirely. This helper enforces the gate at the
 * action boundary.
 *
 * Returns `{ user, member }` on success or `{ error: string }` for any
 * failure mode so callers can surface a stable error shape.
 *
 * Use for: vote toggles, fund contributions, debt confirmation, any
 * money-touching action.
 * Don't use for: profile edits (members.updateMyAvatar/Profile) or auth
 * actions (setPassword, member-approval) — pending users need those to
 * progress to approval.
 */
export async function requireApprovedMember(): Promise<
  | {
      user: { memberId: number; externalId: string };
      member: typeof members.$inferSelect;
    }
  | { error: string }
> {
  const user = await getUserFromCookie();
  if (!user) return { error: "Vui lòng xác nhận danh tính trước" };

  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member) return { error: "Tài khoản không tồn tại" };
  if (!member.isActive)
    return { error: "Tài khoản đã bị khóa. Liên hệ admin." };
  if (member.approvalStatus !== "approved") {
    return { error: "Tài khoản chờ admin duyệt." };
  }

  return { user, member };
}
