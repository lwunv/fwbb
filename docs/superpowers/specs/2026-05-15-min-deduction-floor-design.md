# Min-deduction floor — design

**Date**: 2026-05-15
**Status**: Approved, ready to implement.

## Goal

Khi 1 member tham gia buổi mà balance trong quỹ KHÔNG đủ trả per-head share AND share đó còn nhỏ hơn 60K, override deduction lên **tối thiểu 60K** thay vì cho member nợ chỉ vài chục K. Mục đích: khuyến khích member nộp quỹ + admin recover được chi phí khi buổi đông.

Feature là OPT-IN per session (admin tick checkbox cho từng buổi). Khi session-level toggle ON, admin có quyền untick từng member riêng để miễn.

## Behaviour

Khi `finalizeSession(S)` chạy với `S.useMinDeduction = true`:

1. Tính breakdown thường qua `calculateSessionCosts`.
2. Load exemption list (set of memberId được admin untick cho session S).
3. Cho mỗi `memberDebt M` trong breakdown:
   - Nếu `M.memberId` trong exemption set → skip (admin miễn).
   - Đọc balance M trong cùng transaction (race-safe).
   - Apply `applyMinDeductionFloor(M, balance)`:
     - Nếu `balance >= M.playAmount` → no-op (đủ quỹ trả).
     - Nếu `M.playAmount >= 60_000` → no-op (đã ≥ floor).
     - Else → `M.playAmount = 60_000`; `M.totalAmount = M.playAmount + dineAmount + guestPlayAmount + guestDineAmount`.
4. Insert sessionDebts + fund_deductions với amount đã override (nếu fire).

**Scope quan trọng**: floor chỉ apply lên `playAmount` (member's own play share). KHÔNG floor `dineAmount` (nhậu tùy ý), `guestPlayAmount`/`guestDineAmount` (chi phí của khách — không có balance riêng để check).

Phần dư (penalty) chảy vào fund admin — KHÔNG phân phối lại cho member khác.

## Data model

**1. Cột mới trên `sessions`**:

```sql
ALTER TABLE sessions ADD use_min_deduction INTEGER DEFAULT 0;
-- 0 = off (default), 1 = on
```

**2. Bảng mới `session_min_deduction_exemptions`**:

```sql
CREATE TABLE session_min_deduction_exemptions (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  member_id  INTEGER NOT NULL REFERENCES members(id),
  created_at TEXT DEFAULT current_timestamp,
  PRIMARY KEY (session_id, member_id)
);
```

Presence of row = miễn. Vắng = apply rule (default ON cho member).

## Pure helper (cost-calculator.ts)

```ts
export const MIN_DEDUCTION_PER_HEAD = 60_000;

/**
 * Floor on `playAmount` only — dine/guest unchanged. Floor fires only when:
 *   - member's balance can't cover M.playAmount (đang thiếu quỹ)
 *   - AND M.playAmount < floor (else already ≥ floor)
 */
export function applyMinDeductionFloor(
  debt: MemberDebt,
  balance: number,
  floor = MIN_DEDUCTION_PER_HEAD,
): MemberDebt {
  if (balance >= debt.playAmount) return debt; // đủ quỹ → no-op
  if (debt.playAmount >= floor) return debt; // share đã ≥ floor → no-op
  if (debt.playAmount === 0) return debt; // không chơi → skip (rule này cho play)
  const newPlay = floor;
  return {
    ...debt,
    playAmount: newPlay,
    totalAmount:
      newPlay + debt.dineAmount + debt.guestPlayAmount + debt.guestDineAmount,
  };
}
```

## Server actions

**`setSessionUseMinDeduction(sessionId: number, enabled: boolean)`** — flip session toggle. Guard `assertEditable` (chỉ voting/confirmed). Insert audit nothing.

**`setMemberMinDeductionExempt(sessionId: number, memberId: number, exempt: boolean)`** — insert/delete exemption row idempotent. Guard `assertEditable`.

**`finalizeSession`** — extended (see Behaviour §3).

## UI

**1. Session-level toggle** — card riêng dưới CourtSelector/ShuttlecockSelector (3 chỗ render: dashboard upcoming, session list expanded, session detail). Component mới `MinDeductionToggle.tsx`. Checkbox + label "🛡 Áp dụng tối thiểu 60K cho member thiếu quỹ". Bấm → fire `setSessionUseMinDeduction` optimistic.

**2. Per-member exemption** — trong `AdminVoteManager`, mỗi row member hiện icon shield nhỏ (chỉ khi session toggle ON). Bấm icon → fire `setMemberMinDeductionExempt` toggle. Icon filled (primary) = apply rule; icon outline (muted) = exempt.

**3. Cost summary tile** — khi `useMinDeduction=ON`, append badge "🛡 Min 60K · N exempt" (N = count exemption).

Preview KHÔNG tính số real-override per member (đòi fetch balance từng member, phức tạp). Số thật apply khi finalize.

## Edge cases

| Case                                 | Behavior                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Re-finalize after member nộp quỹ     | Reverse fund_deduction cũ → balance khôi phục → recompute → floor không fire nữa → penalty xóa. ✅                                         |
| Admin tick rồi untick session toggle | Exemption rows giữ nguyên (không xóa). Tick lại → exemption nhớ. ✅                                                                        |
| Member không chơi (playAmount=0)     | Skip floor (rule này cho play, không phạt member chỉ nhậu). ✅                                                                             |
| Admin chính member ↔ adminMemberId   | Trong finalize, `fundDeductionAmount = 0` cho admin. Floor không tác động (skip vì balance không liên quan).                               |
| deleteSession                        | Reverse fund_deduction qua reversalOfId như cũ. Exemption rows orphan — drop khi `db.delete(exemptions).where(sessionId)` trong delete tx. |

## Tests

**Pure** (cost-calculator.test.ts):

- balance đủ → no-op
- balance thiếu, playAmount < floor → override
- balance thiếu, playAmount ≥ floor → no-op
- playAmount = 0 → no-op
- totalAmount cập nhật đúng khi override (sum của 4 component)

**Integration** (finalize-floor.integration.test.ts mới):

- Toggle ON, member balance thiếu → fund_deduction với amount đã floored
- Toggle ON, member exempt → fund_deduction với amount gốc
- Toggle OFF → fund_deduction với amount gốc (rule không fire)
- Re-finalize toggle OFF→ON → reverse old, apply floor
- Re-finalize toggle ON→OFF → reverse floored, apply gốc

## Out of scope (YAGNI)

- 60K configurable (hardcode trước; nếu cần admin đổi sẽ thêm app_settings sau)
- Global default toggle (chỉ per-session)
- Floor cho `dineAmount` (đề xuất + xác nhận: chỉ play)
- Member tự toggle (admin only — confirmed)
- Surplus phân phối lại
- Analytics how-often-fired

## Implementation order

1. Drizzle schema + migration
2. Pure helper + unit tests
3. Server actions (`setSession*`, `setMember*`)
4. `finalizeSession` integration (apply floor inside tx)
5. `deleteSession` cleanup exemption rows
6. UI component `MinDeductionToggle.tsx`
7. UI integration ở 3 page (dashboard, session list, session detail)
8. UI integration trong AdminVoteManager (per-member icon)
9. Integration tests
10. Smoke test trên dev DB + commit + push
