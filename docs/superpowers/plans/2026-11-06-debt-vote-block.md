# Chặn vote khi nợ quá hạn mức: Implementation Plan (phần 1, trên `main`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member nợ ≥ hạn mức `voteBlockDebtThreshold` không vote được ở bất kỳ đường nào, và phiếu đang có của họ ở buổi còn mở vote tự bị xoá khi một thao tác tiền đẩy họ chạm hạn mức.

**Architecture:** Một hàm thuần `isVoteBlockedByDebt` là nguồn sự thật duy nhất. Một hàm `afterMemberMoneyChange(tx, changes)` chạy ở CUỐI mỗi thao tác tiền có ghi sổ cho member, xoá phiếu khi bị chặn; một test quét mã nguồn bắt mọi file ghi sổ phải gọi nó. `submitVote` và trang `/vote/[id]` dùng cùng hàm kiểm.

**Tech Stack:** Next.js 16 server actions, Drizzle + libSQL, Vitest (unit + `*.integration.test.ts` dùng `createTestDb()` từ `@/db/test-db`), Playwright e2e, next-intl (vi/en/zh).

**Spec:** `docs/superpowers/specs/2026-11-06-debt-vote-block-design.md` (mục 4.1-4.3). Mục 4.4 (thông báo admin) ở plan riêng `2026-11-06-debt-negative-admin-alert.md`, nhánh `feat/notifications`.

## Global Constraints

- Phép so sánh chặn: `balance <= -threshold` (giữ đúng trang chủ hiện tại). Hạn mức đọc từ `getSettings().voteBlockDebtThreshold`, mặc định 100.000.
- "Vote còn mở" = `isVoteOpen({ status, voteDeadline }).open` (`src/lib/session-status.ts`), không tự viết lại.
- Bỏ phiếu = XOÁ dòng `votes` (khớp `submitVote` dòng 118-121), kể cả `withPartner` và `guestPlayCount` trên dòng đó. Không đụng `sessions.adminGuest*`.
- Kiểm và xoá chạy SAU khi thao tác đã ghi xong mọi dòng sổ, trong cùng tx với các dòng sổ đó. Không kiểm sau từng dòng.
- Member gửi "bỏ vote" (không chơi, không nhậu) luôn được, kể cả khi bị chặn.
- Admin vote hộ (`adminSetVote`, `adminSetPartner`, `adminSetGuestCount`) không bị chặn.
- Không đổi cost-calculator, ledger, `recordFinancialTransaction`. Tiền là số nguyên VND.
- Chuỗi người dùng thấy: thêm vào cả `vi.json`, `en.json`, `zh.json`. Không em dash trong chuỗi mới.
- Commit: Conventional Commits 1 dòng, không body, không trailer Co-Authored-By.
- Test tích hợp chỉ dùng `createTestDb()`, KHÔNG dùng `.env.local` (trỏ DB prod).

## Review Focus

- Chốt sổ LẠI một buổi (đảo khoản cũ rồi ghi khoản mới) cho member có số dư cuối vẫn trên hạn mức: phiếu buổi khác phải còn nguyên. Test ở Task 3.
- Member số dư đúng bằng `-threshold` bị chặn; `-threshold + 1` không bị chặn. Test ở Task 1.
- Buổi đã quá `voteDeadline` hoặc đã `completed`/`cancelled`: phiếu không bị xoá dù member nợ. Test ở Task 2.
- Member bị chặn gửi `submitVote(..., false, false, ...)` để bỏ vote: thành công và dòng bị xoá. Test ở Task 4.
- Thêm một chỗ ghi sổ mới mà quên gọi `afterMemberMoneyChange`: test quét mã nguồn đỏ. Test ở Task 3.

---

### Task 1: Hàm kiểm nợ dùng chung + trang chủ dùng nó

**Files:**

- Modify: `src/lib/fund-core.ts` (cạnh `VOTE_BLOCK_DEBT_THRESHOLD`, ~dòng 141)
- Modify: `src/app/(public)/page.tsx:42`
- Test: `src/lib/fund-core.test.ts` (tạo nếu chưa có, theo mẫu test thuần của `src/lib/*.test.ts`)

**Interfaces:**

- Produces: `isVoteBlockedByDebt(balance: number, threshold: number): boolean` export từ `@/lib/fund-core`.

- [ ] **Step 1: Viết test đỏ**

```ts
describe("isVoteBlockedByDebt", () => {
  it("nợ đúng bằng hạn mức → chặn", () =>
    expect(isVoteBlockedByDebt(-100_000, 100_000)).toBe(true));
  it("nợ thiếu 1 đồng so với hạn mức → không chặn", () =>
    expect(isVoteBlockedByDebt(-99_999, 100_000)).toBe(false));
  it("nợ vượt hạn mức → chặn", () =>
    expect(isVoteBlockedByDebt(-188_000, 100_000)).toBe(true));
  it("còn quỹ → không chặn", () =>
    expect(isVoteBlockedByDebt(50_000, 100_000)).toBe(false));
  it("hạn mức 0 → số dư 0 bị chặn (giữ hành vi trang chủ)", () =>
    expect(isVoteBlockedByDebt(0, 0)).toBe(true));
});
```

- [ ] **Step 2: Chạy `npx vitest run src/lib/fund-core.test.ts`**, kỳ vọng FAIL "isVoteBlockedByDebt is not a function / not exported".
- [ ] **Step 3: Cài `isVoteBlockedByDebt`** = `balance <= -threshold`, TSDoc ghi nguồn quyết định (spec 4.1). Trong `page.tsx:42` thay biểu thức bằng `isVoteBlockedByDebt(userFundBalance, settings.voteBlockDebtThreshold)`.
- [ ] **Step 4: Chạy lại test**, kỳ vọng PASS; `npx tsc --noEmit -p tsconfig.json` exit 0.
- [ ] **Step 5: Commit** `feat(fund): add a shared check for debt that blocks voting`

### Task 2: `enforceDebtVoteBlock` xoá phiếu ở buổi còn mở vote

**Files:**

- Create: `src/lib/debt-vote-block.ts`
- Test: `src/lib/debt-vote-block.integration.test.ts`

**Interfaces:**

- Consumes: `isVoteBlockedByDebt` (Task 1), `computeBalanceFromTransactions(memberId, txs)` (`@/lib/fund-core`), `isVoteOpen` (`@/lib/session-status`).
- Produces:
  - `type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]` (copy định nghĩa ở `src/lib/financial-ledger.ts:6`, hoặc export nó từ đó rồi import).
  - `enforceDebtVoteBlock(tx: DbLike, memberIds: number[], threshold: number): Promise<{ removed: Array<{ memberId: number; sessionId: number }> }>`. Tính số dư từng member bằng `tx` (đọc `financialTransactions` theo memberId rồi `computeBalanceFromTransactions`), member bị chặn thì xoá các dòng `votes` của họ thuộc buổi có `isVoteOpen(...).open === true`. Bỏ trùng memberId. `memberIds` rỗng thì không truy vấn gì.

- [ ] **Step 1: Viết test tích hợp đỏ** (mẫu setup: `src/actions/finalize-edge-cases.integration.test.ts` dòng 15-40). Dựng 1 member có `fund_deduction` làm số dư -188.000, hạn mức 100.000, và 4 buổi: A `voting` hạn vote ngày mai, B `confirmed` hạn vote ngày mai, C `voting` hạn vote hôm qua, D `completed`. Member có phiếu ở cả 4.
  - `"xoá phiếu ở buổi còn mở vote (voting/confirmed chưa quá hạn)"`: sau khi gọi, phiếu A và B mất, `removed` có đúng `{memberId, sessionId: A}` và `{..., B}`.
  - `"giữ phiếu ở buổi quá hạn vote hoặc đã chốt"`: phiếu C, D còn.
  - `"member chưa tới hạn mức (-99.999) → không xoá gì"`.
  - `"phiếu của member khác không bị đụng"`.
- [ ] **Step 2: Chạy `npx vitest run src/lib/debt-vote-block.integration.test.ts`**, kỳ vọng FAIL (module chưa có).
- [ ] **Step 3: Cài `enforceDebtVoteBlock`** trong `src/lib/debt-vote-block.ts` theo Interfaces. Lọc buổi bằng `isVoteOpen` ở JS sau khi lấy các buổi có phiếu của member (không viết lại điều kiện deadline trong SQL).
- [ ] **Step 4: Chạy lại test**, kỳ vọng PASS.
- [ ] **Step 5: Commit** `feat(vote): remove open-session votes of members over the debt limit`

### Task 3: `afterMemberMoneyChange` + gọi ở mọi thao tác ghi sổ + test chống sót

**Files:**

- Modify: `src/lib/debt-vote-block.ts`
- Modify (gọi ở cuối, trong tx): `src/actions/finance.ts` (`finalizeSession`, `finalizeSessionAuto`, `confirmPaymentByMember`, `confirmPaymentByAdmin`, `undoPaymentByAdmin`), `src/actions/fund.ts` (`recordContribution`, `recordRefund`, `reverseFinancialTransaction`, `confirmFundClaim`), `src/actions/sessions.ts` (`cancelSession`, `reopenSession`, `deleteSession` và mọi hàm khác trong file có gọi `recordFinancialTransaction`), `src/actions/members.ts` (hàm chứa dòng 1031/1076), `src/actions/merge-debt-fund.ts`, `src/lib/auto-fund-core.ts`, `src/lib/payment-matcher.ts`.
- Test: `src/lib/debt-vote-block.integration.test.ts` (thêm), `src/lib/debt-vote-block.coverage.test.ts` (test quét mã nguồn), `src/actions/finalize-min-deduction.integration.test.ts` hoặc file finalize mới (thêm ca chốt sổ).

**Interfaces:**

- Consumes: `enforceDebtVoteBlock` (Task 2), `getSettings()` (`@/actions/settings`).
- Produces: `afterMemberMoneyChange(tx: DbLike, changes: Array<{ memberId: number; balanceBefore: number }>): Promise<{ removed: Array<{ memberId: number; sessionId: number }> }>`. Đọc hạn mức từ `getSettings()`, gọi `enforceDebtVoteBlock`, rồi `revalidatePath("/")`, `revalidatePath(\`/vote/${sessionId}\`)`, `revalidatePath(\`/admin/sessions/${sessionId}\`)`cho mỗi buổi bị xoá phiếu.`balanceBefore`chưa dùng ở phần 1 (phần 2 dùng để phát hiện "vừa âm"); vẫn bắt buộc truyền để chỗ gọi không phải sửa lại lần nữa. Mỗi chỗ gọi lấy`balanceBefore` ở ĐẦU thao tác, trước mọi dòng sổ của nó.

- [ ] **Step 1: Viết test quét mã nguồn đỏ** `"mọi file gọi recordFinancialTransaction đều gọi afterMemberMoneyChange"`: đọc mọi file `.ts` dưới `src/` (bỏ `*.test.ts`, `src/lib/financial-ledger.ts`), file nào chứa `recordFinancialTransaction(` thì phải chứa `afterMemberMoneyChange(`, trừ danh sách miễn `["src/actions/court-rent.ts", "src/actions/inventory.ts", "src/lib/ledger-restore.ts"]`. Thông báo lỗi liệt kê tên file thiếu.
- [ ] **Step 2: Viết test tích hợp đỏ cho chốt sổ** (setup như `finalize-min-deduction.integration.test.ts`):
  - `"chốt sổ đẩy member quá hạn mức → phiếu buổi sau (đang mở vote) bị xoá"`.
  - `"chốt sổ lại, số dư cuối vẫn trên hạn mức → phiếu buổi sau còn nguyên"`: member số dư ban đầu -60.000, hạn mức 100.000, buổi X giá 30.000/người; chốt X, chốt lại X (đảo + ghi lại), phiếu buổi Y còn.
  - `"nạp quỹ (recordContribution) cho member đang bị chặn không xoá gì thêm và không lỗi"`.
- [ ] **Step 3: Chạy 2 file test**, kỳ vọng FAIL.
- [ ] **Step 4: Cài `afterMemberMoneyChange`** và gọi ở cuối từng hàm trong danh sách Files, bên trong `db.transaction` của hàm đó. Hàm nào chưa có tx thì bọc lại. Với thao tác nhiều member (chốt sổ) truyền đủ danh sách member có dòng sổ.
- [ ] **Step 5: Chạy `npx vitest run src/lib src/actions`**, kỳ vọng toàn bộ PASS (kể cả mọi test tích hợp cũ).
- [ ] **Step 6: Gọi agent `finance-invariant-reviewer`** với diff của Task 3, kỳ vọng PASS. FAIL thì sửa trước khi commit.
- [ ] **Step 7: Commit** `feat(vote): drop votes automatically when a money change pushes a member over the debt limit`

### Task 4: Server chặn `submitVote` + trang `/vote/[id]` + chip admin

**Files:**

- Modify: `src/actions/votes.ts` (`submitVote`, sau gate `isVoteOpen` ~dòng 71, trước rate-limit)
- Modify: `src/app/(public)/vote/[id]/page.tsx`
- Modify: `src/components/sessions/admin-vote-manager.tsx` (cạnh `FundStatusIcon` ~dòng 826)
- Modify: `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/actions/votes-debt-block.integration.test.ts`, `e2e/vote-debt-block.spec.ts`

**Interfaces:**

- Consumes: `isVoteBlockedByDebt` (Task 1), `getFundBalance(memberId)` (`@/lib/fund-calculator`), `FundBalanceBanner({ balance, memberId })`.
- i18n mới: `serverErrors.voteBlockedByDebt` = "Bạn đang nợ quỹ {debt}. Nợ từ {limit} trở lên thì không vote được, vui lòng nạp quỹ trước." (en/zh dịch tương đương); `sessions.voteBlockedByDebt` (cùng ý, cho trang vote); `adminMisc.overDebtLimit` = "Nợ quá hạn mức". `{debt}` và `{limit}` dạng "188K".

- [ ] **Step 1: Viết test tích hợp đỏ** (mock `requireApprovedMember` trả member test):
  - `"member nợ quá hạn mức vote chơi → trả error voteBlockedByDebt, không có dòng votes"`.
  - `"member nợ quá hạn mức bỏ vote (false,false) → success, dòng bị xoá"`.
  - `"member nợ dưới hạn mức vote → success"`.
  - `"adminSetVote cho member nợ quá hạn mức → success"`.
- [ ] **Step 2: Chạy test**, kỳ vọng FAIL ở ca đầu.
- [ ] **Step 3: Cài chặn trong `submitVote`**: chỉ khi `data.willPlay || data.willDine`; đọc `getFundBalance(user.memberId).balance` và `getSettings().voteBlockDebtThreshold`.
- [ ] **Step 4: Trang `/vote/[id]`**: lấy số dư viewer cùng `Promise.all` hiện có; bị chặn thì render `FundBalanceBanner` + câu `sessions.voteBlockedByDebt` thay cho `SessionVoteOptimisticPanel` (danh sách người đã vote vẫn hiện nếu panel có phần đó tách được; không tách được thì chỉ banner). Mobile-first, chữ ≥ 16px.
- [ ] **Step 5: Chip admin**: trong `admin-vote-manager.tsx`, member có `isVoteBlockedByDebt(memberBalances[id], voteBlockDebtThreshold)` hiện chip `adminMisc.overDebtLimit` cạnh tên (cùng kiểu chip "👫 +2" dòng 834, màu rose theo token). Lấy hạn mức từ `useSettings()`.
- [ ] **Step 6: E2E** `e2e/vote-debt-block.spec.ts` trên `e2e/local.db`: member nợ 188K mở `/vote/<id>` thấy banner nợ, không có nút vote. Chạy `pnpm build` trước (memory: playwright dùng build gần nhất).
- [ ] **Step 7: Chạy test tích hợp + e2e**, kỳ vọng PASS.
- [ ] **Step 8: Commit** `fix(vote): block voting from any page when a member is over the debt limit`

### Task 5: Dọn phiếu cho mọi member (khi admin hạ hạn mức + script một lần)

**Files:**

- Modify: `src/lib/debt-vote-block.ts`
- Modify: action lưu settings trong `src/actions/settings.ts` (chỗ ghi `voteBlockDebtThreshold`)
- Create: `scripts/enforce-debt-vote-block.ts` (theo mẫu các script `scripts/*.ts` hiện có về cách nối DB và cờ chạy)
- Test: `src/lib/debt-vote-block.integration.test.ts` (thêm)

**Interfaces:**

- Consumes: `enforceDebtVoteBlock` (Task 2).
- Produces: `findMembersWithOpenVotes(tx: DbLike): Promise<number[]>` (member có phiếu ở buổi `isVoteOpen`). Settings action và script đều gọi `enforceDebtVoteBlock(tx, await findMembersWithOpenVotes(tx), threshold)`.

- [ ] **Step 0: Test đỏ** `"admin hạ hạn mức từ 200.000 xuống 100.000 → phiếu của member nợ 188.000 ở buổi mở vote bị xoá"` và `"admin nâng hạn mức → không xoá gì"`; cài `findMembersWithOpenVotes` + gọi trong action lưu settings chỉ khi giá trị `voteBlockDebtThreshold` giảm; chạy test PASS; commit `feat(settings): drop votes over the new debt limit when admins lower it`.
- [ ] **Step 1: Cài script**: mặc định chạy thử, in bảng `memberId | tên | số dư | sessionId | ngày buổi` các phiếu SẼ xoá, không ghi gì. Chỉ xoá thật khi có cờ `--apply`, trong 1 transaction. Dùng `--all-members` = mọi member đang có phiếu ở buổi còn mở vote.
- [ ] **Step 2: Chạy thử trên `e2e/local.db`** với dữ liệu seed có 1 member nợ, kỳ vọng in đúng 1 dòng; chạy `--apply` rồi chạy thử lại, kỳ vọng 0 dòng.
- [ ] **Step 3: Commit** `chore(scripts): add a one-off cleanup for votes of members over the debt limit`

### Task 6: Cổng cuối + deploy (CẦN user xác nhận ở bước push và bước chạy script prod)

- [ ] **Step 1:** `git fetch` + cập nhật base `main` mới nhất.
- [ ] **Step 2:** Đủ 4 cổng, đọc exit code trực tiếp: `npx tsc --noEmit -p tsconfig.json`, `pnpm lint`, `pnpm test` (gồm integration), `pnpm build`. Thêm `npx playwright test` toàn bộ e2e.
- [ ] **Step 3:** Review toàn nhánh (finance-invariant-reviewer + mobile-ui-reviewer cho file .tsx).
- [ ] **Step 4:** Hỏi user, rồi push `main` (tự deploy), chờ Vercel `success`.
- [ ] **Step 5:** Sao lưu DB (`scripts/backup-local.mjs`), chạy script Task 5 chế độ thử trên prod, đưa danh sách cho user, user đồng ý mới `--apply`.
