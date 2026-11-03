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

/**
 * Gate cho page (public) đọc dữ liệu nhóm (lịch sử nợ, thống kê, danh sách
 * vote). Layout chặn pending/khoá chỉ bằng giao diện, còn Next vẫn render page
 * song song và đẩy dữ liệu của nó vào RSC payload, nên page phải tự kiểm.
 *
 * - `anonymous`: chưa đăng nhập, page redirect("/login") như trước.
 * - `blocked`: có cookie nhưng chờ duyệt / bị từ chối / bị khoá, page trả
 *   `null`. Lần tải trang đầy đủ thì layout hiện màn chờ duyệt hoặc màn khoá.
 *   Nếu admin khoá member khi họ đang mở app, layout không render lại lúc
 *   chuyển trang nên họ thấy vùng nội dung trống cho tới khi tải lại; vẫn
 *   không lộ dữ liệu.
 */
export async function getApprovedViewer(): Promise<
  | { status: "anonymous" }
  | { status: "blocked" }
  | {
      status: "ok";
      user: { memberId: number; externalId: string };
      member: typeof members.$inferSelect;
    }
> {
  const user = await getUserFromCookie();
  if (!user) return { status: "anonymous" };
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member || !member.isActive || member.approvalStatus !== "approved") {
    return { status: "blocked" };
  }
  return { status: "ok", user, member };
}

/**
 * Gate cho vùng giao lưu. Rộng hơn `getApprovedViewer`: member đang chờ duyệt
 * (đăng ký giao lưu hoặc chờ vào nhóm) vẫn vào được, vì vùng giao lưu không
 * chứa dữ liệu nhóm. `isGroupMember` cho giao diện biết có được mở thêm phần
 * của nhóm hay không.
 *
 * - `anonymous`: chưa đăng nhập.
 * - `blocked`: không tồn tại, bị khoá hoặc bị từ chối.
 */
export async function getExchangeViewer(): Promise<
  | { status: "anonymous" }
  | { status: "blocked" }
  | {
      status: "ok";
      user: { memberId: number; externalId: string };
      member: typeof members.$inferSelect;
      isGroupMember: boolean;
    }
> {
  const user = await getUserFromCookie();
  if (!user) return { status: "anonymous" };
  const member = await db.query.members.findFirst({
    where: eq(members.id, user.memberId),
  });
  if (!member || !member.isActive || member.approvalStatus === "rejected") {
    return { status: "blocked" };
  }
  return {
    status: "ok",
    user,
    member,
    isGroupMember: member.approvalStatus === "approved",
  };
}

/**
 * Bản dành cho server action của vùng giao lưu (cùng điều kiện với
 * `getExchangeViewer`). Server action gọi thẳng bằng POST được nên không thể
 * chỉ dựa vào layout. KHÔNG dùng cho thao tác tiền hay vote nhóm: các luồng đó
 * vẫn phải qua `requireApprovedMember`.
 */
export async function requireExchangeMember(): Promise<
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
  if (member.approvalStatus === "rejected") {
    return { error: "Tài khoản đã bị từ chối." };
  }

  return { user, member };
}
