# Báo admin khi member vừa âm quỹ: Implementation Plan (phần 2, nhánh `feat/notifications`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin nhận đúng 1 tin trong chuông admin mỗi khi số dư một member chuyển từ ≥ 0 sang < 0 sau một thao tác tiền.

**Architecture:** Thêm loại tin `member_balance_negative` vào catalog N1. `afterMemberMoneyChange` (phần 1) đã nhận `balanceBefore`; ở nhánh này nó so với số dư cuối và gọi `notifyMemberBalanceNegative`. Không thêm chỗ gọi mới ở các action.

**Tech Stack:** như phần 1, cộng hạ tầng N1 (`notify`, `superadminRecipients`, `memberName`, `memberBalanceInTx` trong `src/lib/notifications/`).

**Spec:** `docs/superpowers/specs/2026-11-06-debt-vote-block-design.md` mục 4.4.

**Điều kiện bắt đầu:** phần 1 (`2026-11-06-debt-vote-block.md`) đã lên `main`; merge `main` vào `feat/notifications` trước (giải xung đột ở các action tiền: giữ cả chỗ gọi `notify*` của N1 lẫn `afterMemberMoneyChange`). KHÔNG merge nhánh này vào `main`, KHÔNG deploy: lên prod cùng cả cụm G2 (quyết định user 4/11/2026).

## Global Constraints

- Chỉ báo khi `balanceBefore >= 0 && balanceAfter < 0`. Đang âm mà âm thêm: không báo.
- `balanceBefore` = số dư ở ĐẦU thao tác (trước mọi dòng sổ của nó, kể cả bước đảo khi chốt lại).
- Người nhận: `superadminRecipients(tx)`. Kênh: chuông admin, nhóm `admin_money`, gửi ngay (`"now"`), không email.
- Khoá chống trùng: `member_balance_negative:<memberId>:<id dòng sổ lớn nhất của member sau thao tác>`.
- Nội dung tin chỉ cho admin: tên member + số dư mới (dạng "-188K"). Không gửi cho member khác.
- Chuỗi tin ở cả vi/en/zh, không em dash.
- Commit: Conventional Commits 1 dòng, không body, không trailer.

## Review Focus

- Chốt lại buổi cho member đã âm từ lần chốt trước: không có tin mới. Test ở Task 2.
- Chạy lại cùng một thao tác (idempotent, ví dụ bấm 2 lần): vẫn 1 tin. Test ở Task 2.
- Thông báo bị tắt (`isNotificationsEnabled` false): không lỗi, không tin, phần chặn vote vẫn chạy. Test ở Task 2.
- Một thao tác làm 2 member cùng âm (chốt sổ): 2 tin, mỗi member 1. Test ở Task 2.
- Số dư từ 0 xuống âm (0 tính là ≥ 0): có tin. Test ở Task 1.

---

### Task 1: Loại tin `member_balance_negative`

**Files:**

- Modify: `src/lib/notifications/catalog.ts` (payload type cạnh `member_reported_transfer` ~dòng 145; `def(...)` ~dòng 233)
- Modify: `src/lib/notifications/money-events.ts`
- Modify: `src/i18n/messages/{vi,en,zh}.json` (khối cạnh `"member_reported_transfer"` ~dòng 1754)
- Test: `src/lib/notifications/catalog.test.ts`, `src/lib/notifications/money-events.integration.test.ts` (tạo nếu chưa có, theo mẫu `account-events.integration.test.ts`)

**Interfaces:**

- Produces:
  - Payload: `member_balance_negative: { memberName: string; balance: number }`, `def("admin", "admin_money", false, false, "now")`.
  - `notifyMemberBalanceNegative(tx: DbOrTx, input: { memberId: number; balance: number; dedupBase: string }): Promise<void>`, theo mẫu `notifyMemberReportedTransfer` (gate `isNotificationsEnabled`, `entity: { type: "member", id }`).
  - Chuỗi vi: tiêu đề "{memberName} vừa âm quỹ", nội dung "Số dư hiện tại: {balance}."

- [ ] **Step 1: Viết test đỏ**: catalog test có `member_balance_negative` thuộc nhóm `admin_money`; integration test `"notifyMemberBalanceNegative tạo 1 tin cho superadmin với số dư -188000"` và `"gọi 2 lần cùng dedupBase → vẫn 1 tin"`.
- [ ] **Step 2: Chạy** `npx vitest run src/lib/notifications/catalog.test.ts src/lib/notifications/money-events.integration.test.ts`, kỳ vọng FAIL.
- [ ] **Step 3: Cài** catalog + hàm + i18n theo Interfaces.
- [ ] **Step 4: Chạy lại**, kỳ vọng PASS.
- [ ] **Step 5: Commit** `feat(notifications): add an admin alert type for members whose fund goes negative`

### Task 2: Nối vào `afterMemberMoneyChange`

**Files:**

- Modify: `src/lib/debt-vote-block.ts` (từ phần 1)
- Test: `src/lib/debt-vote-block.integration.test.ts` (thêm), một file finalize integration (thêm ca chốt lại)

**Interfaces:**

- Consumes: `afterMemberMoneyChange(tx, changes: Array<{ memberId; balanceBefore }>)` (phần 1, Task 3), `notifyMemberBalanceNegative` (Task 1), `memberBalanceInTx` (`money-events.ts`).

- [ ] **Step 1: Viết test đỏ**:
  - `"số dư 0 → -30.000 sau thao tác → 1 tin"`.
  - `"số dư -60.000 → -90.000 → không tin"`.
  - `"chốt lại buổi cho member đã âm từ lần trước → không tin mới"`.
  - `"chốt sổ làm 2 member cùng âm → 2 tin"`.
  - `"thông báo tắt → không tin, phiếu vẫn bị xoá đúng như phần 1"`.
- [ ] **Step 2: Chạy**, kỳ vọng FAIL.
- [ ] **Step 3: Cài**: trong `afterMemberMoneyChange`, với mỗi change tính `balanceAfter` bằng `memberBalanceInTx`, nếu `balanceBefore >= 0 && balanceAfter < 0` gọi `notifyMemberBalanceNegative` với `dedupBase` theo Global Constraints. Giữ nguyên thứ tự: xoá phiếu trước, báo sau, cùng tx.
- [ ] **Step 4: Chạy** `npx vitest run src/lib src/actions`, kỳ vọng toàn bộ PASS.
- [ ] **Step 5: Gọi `finance-invariant-reviewer`**, kỳ vọng PASS.
- [ ] **Step 6: Commit** `feat(notifications): alert admins when a money change takes a member's fund below zero`

### Task 3: Cổng cuối trên nhánh

- [ ] **Step 1:** 4 cổng exit 0 (`npx tsc --noEmit -p tsconfig.json`, `pnpm lint`, `pnpm test`, `pnpm build`) + e2e chuông (`e2e/notifications-bell.spec.ts`) xanh.
- [ ] **Step 2:** Cập nhật file tiến độ N1 trong memory. KHÔNG merge `main`, KHÔNG deploy.
