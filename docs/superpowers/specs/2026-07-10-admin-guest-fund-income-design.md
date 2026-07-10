# Thu tiền khách của admin vào quỹ (session_guest_income)

Ngày: 2026-07-10

## Vấn đề

Report "Báo cáo Thu/Chi từ buổi chơi" (/admin/fund) hiển thị tháng 6/2026 **lỗ −133.000**. Đào ra: mỗi khi admin (Châu #1) mời khách, tiền chơi của khách (sàn 60K/khách) **không được trừ/thu vào đâu** — quỹ chung "gánh" (by design cũ, [finance.ts](../../src/actions/finance.ts) dòng 336-345). Report tính `Thu = Σ fund_deduction` nên thiếu đúng khoản khách-admin → ra lỗ.

Đồng thời phát sinh **bất nhất**: thẻ buổi chơi (/admin/sessions) tính `Thu = session.totalDebt` (đã gồm khoản khách-admin) nên hiện **Lãi**, còn report quỹ hiện **Lỗ**, lệch nhau đúng bằng tiền khách-admin.

Ví dụ buổi #32 (12/06): thẻ buổi Lãi +7.000, report Lỗ −53.000, lệch 60.000 = 1 khách admin.

## Quyết định (chốt với user 2026-07-10)

Khi admin chốt buổi, **cộng tiền khách của admin (60K/khách) thẳng vào quỹ chung**:

- KHÔNG gắn vào balance của member nào (kể cả Châu). Đây là "thu của nhóm", không phải ai nạp.
- Quỹ (tiền mặt) tăng thật.
- Report quỹ đếm khoản này vào "Thu" → hết lỗ, khớp thẻ buổi.
- Áp dụng cả retroactive cho tháng 6 (buổi #28, #32, #29).

## Thiết kế

Thêm loại giao dịch mới `session_guest_income` — đối xứng với `court_rent_payment`/`inventory_purchase` (chi nhóm, `memberId=null`) nhưng là **thu nhóm** (`direction="in"`, `memberId=null`, gắn `sessionId`).

Vì sao loại mới thay vì `fund_contribution`:

- `fund_contribution` bắt buộc gắn 1 member để giữ invariant I1 (`netInternal == Σ per-member balance`). Gắn Châu = tăng balance Châu (user không muốn).
- Loại mới KHÔNG thuộc nhóm `fund_*` → I1 (chỉ tính 3 loại fund) **không đụng tới**, member balance **không đổi**.
- Cột `financial_transactions.type` không có CHECK constraint (chỉ `amount >= 0`, migration 0014) → thêm giá trị enum là thay đổi TS thuần, **không cần migration**.

### Các thay đổi

1. **schema.ts**: thêm `session_guest_income` vào enum `type`.
2. **financial-ledger.ts**: thêm vào union `FinancialTransactionType`.
3. **finance.ts `finalizeSession`**:
   - Trong bước reverse (chốt lại buổi), reverse các `session_guest_income` cũ của buổi (chèn row `direction="out"`, `reversalOfId` trỏ về gốc) — idempotent, không nhân đôi.
   - Trong vòng tạo debt: với debt row của admin (`isAdminDebt`), nếu `guestPlayAmount + guestDineAmount > 0` → ghi 1 `session_guest_income` (in, memberId=null, sessionId, debtId=admin debt id, idempotencyKey `finalize-guestincome-{sessionId}-{debtId}`). Giữ nguyên `fund_deduction` của admin = chỉ own play+dine.
4. **fund.ts `getSessionFinanceReport`**: load thêm `session_guest_income`, cộng vào `thu` (bỏ qua reversal + voided).
5. **fund.ts `getFundOverview`**: cộng `session_guest_income` (non-voided) vào `cashOnHand`.
6. **finance-summary.ts**: case `session_guest_income` → `realIn`.
7. **transactions.ts `getSystemTransactions`**: thêm vào `includeTypes` + union `SystemTxRow.type` để hiện trong lịch sử admin. Thêm i18n label + display map.

KHÔNG thêm vào `FUND_TRANSACTION_TYPES` (các query đó giả định fund\_\* + member balance).

### Retroactive tháng 6

Script `scripts/backfill-admin-guest-income.mjs` (chạy `--dry` trước): với buổi completed có khoản khách-admin trong `session_debts` mà CHƯA có `session_guest_income` tương ứng → chèn khoản còn thiếu. Idempotent qua idempotencyKey.

## An toàn

- TDD: viết test đỏ trước cho finalize (ghi + reverse) và report (thu).
- Bất biến: member balance không đổi (I1 giữ nguyên) vì loại mới không phải fund\_\*.
- Chạy `finance-invariant-reviewer` + `reconcile-check` (I1..I10) + full test trước khi apply prod.

## Kết quả kỳ vọng

- Buổi #32: report Lãi +7.000 (khớp thẻ buổi).
- Tháng 6: hết lỗ sau backfill (quỹ +300.000, không member nào đổi balance).
- Tháng 7 và về sau: tự động đúng khi chốt buổi.
