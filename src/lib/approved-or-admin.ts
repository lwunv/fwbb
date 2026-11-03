import { requireAdmin } from "@/lib/auth";
import { requireApprovedMember } from "@/lib/member-auth";

/**
 * Lớp chặn thứ hai cho các hàm đọc dữ liệu nhóm (thống kê, buổi chơi). Layout
 * và page đã chặn tài khoản chưa duyệt, nhưng server action gọi thẳng được qua
 * POST nên chính hàm đọc phải tự kiểm.
 *
 * Thử admin trước (cookie JWT, không đọc DB), rồi mới tới member đã duyệt và
 * còn hoạt động. Không bao giờ ném lỗi: chặn thì trả `{ error }` để caller trả
 * dữ liệu rỗng đúng kiểu của nó.
 */
export async function requireApprovedOrAdmin(): Promise<
  { ok: true } | { error: string }
> {
  const admin = await requireAdmin();
  if (!("error" in admin)) return { ok: true };

  const member = await requireApprovedMember();
  if ("error" in member) return { error: member.error };
  return { ok: true };
}
