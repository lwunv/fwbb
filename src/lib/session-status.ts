/**
 * Session status state machine — single source of truth cho mọi transition.
 *
 * Lý do tách module riêng:
 * - Tránh race-condition khi nhiều action cùng đổi status (atomic check trong tx).
 * - Audit trail rõ ràng: bất kỳ status change nào cũng phải đi qua `assertCanTransition`.
 * - Editable check: các action sửa cost (court/shuttle/guest) phải block khi đã chốt sổ
 *   để giữ invariant "debts khớp với cost calculation hiện tại".
 *
 * Lifecycle bình thường:
 *   voting ──confirmSession──▶ confirmed ──finalizeSession──▶ completed
 *
 * Hủy:
 *   voting/confirmed ──cancelSession──▶ cancelled
 *
 * Khôi phục/sửa lại:
 *   cancelled ──reopenSession──▶ voting        (reverse pass-sân nếu có)
 *   completed ──unlockSession──▶ voting        (reverse fund_deductions, xóa debts/attendees)
 *
 * Cấm:
 *   completed → cancelled  (đã có invariant tài chính, không cancel sau finalize)
 *   * → completed (phải qua finalizeSession để build attendees + debts đúng)
 */

export type SessionStatus = "voting" | "confirmed" | "completed" | "cancelled";

const TRANSITIONS: Record<SessionStatus, ReadonlySet<SessionStatus>> = {
  voting: new Set<SessionStatus>(["confirmed", "completed", "cancelled"]),
  confirmed: new Set<SessionStatus>(["voting", "completed", "cancelled"]),
  completed: new Set<SessionStatus>(["voting"]), // chỉ qua unlockSession
  cancelled: new Set<SessionStatus>(["voting"]), // chỉ qua reopenSession
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.has(to) ?? false;
}

export function assertCanTransition(
  from: SessionStatus,
  to: SessionStatus,
): { ok: true } | { ok: false; error: string } {
  if (!canTransition(from, to)) {
    return {
      ok: false,
      error: `Không thể chuyển trạng thái từ "${from}" sang "${to}"`,
    };
  }
  return { ok: true };
}

/**
 * Buổi có cho phép edit cost-affecting fields không?
 * - voting / confirmed: được sửa thoải mái (chưa chốt sổ).
 * - completed: KHÔNG (debts/deductions đã ghi → sửa silently sẽ bể invariant).
 *   Admin phải bấm "Mở lại" (unlockSession) trước khi sửa.
 * - cancelled: KHÔNG (đã hủy → reopen trước khi sửa).
 */
export function isEditable(status: SessionStatus): boolean {
  return status === "voting" || status === "confirmed";
}

export function assertEditable(
  status: SessionStatus,
): { ok: true } | { ok: false; error: string } {
  if (status === "completed") {
    return {
      ok: false,
      error:
        "Buổi đã chốt sổ — bấm 'Mở lại' trước khi sửa để hệ thống reverse các giao dịch tài chính cũ và đảm bảo debts khớp với cost mới",
    };
  }
  if (status === "cancelled") {
    return {
      ok: false,
      error: "Buổi đã hủy — bấm 'Mở lại' trước khi sửa",
    };
  }
  return { ok: true };
}
