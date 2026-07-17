# Mail infra + Invite email + Forgot-password (member & admin) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use `- [ ]`.

**Goal:** Dựng hạ tầng gửi mail (SMTP/nodemailer) + bảng token đặt-lại-mật-khẩu dùng chung, rồi làm: (1) mail MỜI member (link đặt mật khẩu) khi admin tạo member có email, (2) QUÊN MẬT KHẨU tự phục vụ cho member ở màn đăng nhập, (3) QUÊN MẬT KHẨU cho admin.

**Architecture:** 1 bảng `password_reset_tokens` (lưu sha256 token, single-use, hết hạn) tham chiếu member HOẶC admin. `src/lib/mailer.ts` (nodemailer, non-throwing) + `src/lib/password-reset-token.ts` (token helpers). 3 action dùng chung `requestPasswordReset/resetPasswordWithToken/validateResetToken` phân biệt subject member/admin. Route group `(auth)` (không login-gate) chứa `/forgot-password` + `/reset-password/[token]`. Invite tái dùng cùng token (TTL dài hơn) + email template riêng.

**Tech Stack:** Next.js 16 App Router (server actions, `after()` from `next/server`), Drizzle/Turso, nodemailer 9 (đã cài), next-intl (vi/en/zh), bcryptjs, vitest, Playwright.

**Design source of truth:** `docs/superpowers/specs/2026-06-16-forgot-password-design.md` (member forgot-pw, đã qua adversarial review) + `docs/superpowers/specs/2026-07-17-admin-account-management-design.md` §5-9 (admin + shared infra). Port `src/lib/mailer.ts` + `src/lib/password-reset-token.ts` từ worktree `.claude/worktrees/forgot-password/` (đọc file đó, KHÔNG merge nhánh — nhánh đã cũ).

## Global Constraints

- **DB safety:** `.env.local` trỏ PROD Turso. KHÔNG `db:push`/`db:seed`. Integration test dùng `createTestDb` (replay migration numbered). E2e dùng `file:e2e/local.db`. Prod migration apply thủ công (additive) + verify `sqlite_master`.
- **Token:** 256-bit random (base64url), **lưu sha256 hex** (không lưu raw), single-use bằng **CAS** (conditional UPDATE, check rowsAffected===1), hết hạn qua `expires_at`. Forgot TTL = **60 phút**; Invite TTL = **7 ngày**. Format thời gian: `new Date(...).toISOString()` (UTC, hậu tố Z) NHẤT QUÁN ở cả CAS lẫn validate; đọc thuần so trong JS `new Date(x).getTime() > Date.now()`.
- **Enumeration defense:** `requestPasswordReset` LUÔN trả thông báo trung tính (kể cả email không tồn tại / rate-limit / lỗi DB). Gửi mail qua `after()` (khử timing oracle). KHÔNG log raw token.
- **Password policy:** 8-128 ký tự & ≤72 byte UTF-8, bcrypt cost 12 (tái dùng `isValidPassword` ở password-auth.ts).
- **Admin vs member tách biệt:** admin subject → sau reset về `/admin/login`; member subject → `clearUserCookie()` + về `/`. Token phân biệt bằng `member_id` XOR `admin_id`.
- **UNIQUE trên Turso:** cột/bảng mới dùng ADD COLUMN + CREATE INDEX riêng (không recreate). `password_reset_tokens` là CREATE TABLE mới (an toàn).
- **Rate-limit:** dùng `checkRateLimit` DB-backed. Keys: `pw-reset-req:{scope}:{ip}`, `pw-reset-req-email:{scope}:{emailNorm}`, `pw-reset:{ip}`, `pw-reset-validate:{ip}`.
- **i18n:** mọi chuỗi qua next-intl, đủ vi/en/zh (parity test). **Nội dung email** cũng qua i18n (locale mặc định vi cho mail vì không có locale ngữ cảnh; hoặc song ngữ vi/en như mailer cũ).
- **No `any`, TS strict. Commit:** Conventional 1 dòng ≤100 ký tự, không body, không Co-Authored-By.
- **Auth-flow KHÔNG optimistic-UI** (không "lạc quan" báo đã gửi mail/đã đổi mk) — dùng `useTransition`+`Loader2`, khớp `password-auth-form.tsx`.
- **Link host:** dùng `NEXT_PUBLIC_APP_URL` (đã có) làm base cho link reset/invite. KHÔNG suy từ header Host.

---

### Task 1: Schema `password_reset_tokens` + migration 0022

**Files:** Modify `src/db/schema.ts`; generate `src/db/migrations/0022_*.sql` (+ meta).

**Interfaces produced:** table `passwordResetTokens { id, memberId(FK members,nullable,cascade), adminId(FK admins,nullable,cascade), tokenHash(unique), expiresAt, usedAt, createdAt }`.

- [ ] Step 1 — Thêm vào schema.ts (sau bảng admins/members; import `sql` đã có):

```ts
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    memberId: integer("member_id").references(() => members.id, {
      onDelete: "cascade",
    }),
    adminId: integer("admin_id").references(() => admins.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
  },
  (table) => [uniqueIndex("prt_token_hash_unique").on(table.tokenHash)],
);
```

Invariant (app-layer, không CHECK): đúng 1 trong memberId/adminId được set.

- [ ] Step 2 — `pnpm db:generate`. Mở file .sql: phải là `CREATE TABLE password_reset_tokens ...` + `CREATE UNIQUE INDEX prt_token_hash_unique`. (Bảng mới → không recreate risk.)
- [ ] Step 3 — Verify replay: `npx vitest run src/actions/admin-account.integration.test.ts` (createTestDb replay migration mới) → PASS.
- [ ] Step 4 — Commit `feat(auth): password_reset_tokens table + migration`.

### Task 2: Token helpers + mailer (port từ worktree + mở rộng invite)

**Files:** Create `src/lib/password-reset-token.ts` (+ `.test.ts`), `src/lib/mailer.ts`.

- [ ] Step 1 — Port `src/lib/password-reset-token.ts` **verbatim** từ `.claude/worktrees/forgot-password/src/lib/password-reset-token.ts` (exports: `RESET_TOKEN_TTL_MS`, `hashResetToken`, `generateResetToken`, `resetTokenExpiryIso`, `isResetTokenExpired`). Thêm hằng `INVITE_TOKEN_TTL_MS = 7*24*60*60*1000` + helper `inviteTokenExpiryIso()`.
- [ ] Step 2 — Unit test `src/lib/password-reset-token.test.ts` (port + thêm): gen ra rawToken + hash khớp `hashResetToken(raw)`; `isResetTokenExpired` boundary (past/future ISO-UTC); invite expiry > reset expiry.
- [ ] Step 3 — Run `npx vitest run src/lib/password-reset-token.test.ts` PASS.
- [ ] Step 4 — Port `src/lib/mailer.ts` từ worktree, adapt: giữ `sendPasswordResetEmail(to, resetUrl)`; THÊM `sendInviteEmail(to, setupUrl, opts?: { appName?: string })` (subject "Mời tham gia FWBB / You're invited", body: đã được thêm vào nhóm, nhấn link đặt mật khẩu, link 7 ngày). Cả 2 non-throwing (kiểu messenger.ts), dev-log URL khi thiếu SMTP + NODE_ENV!=='production'. Env: SMTP_HOST/PORT/SECURE/USER/PASS/MAIL_FROM.
- [ ] Step 5 — `npx tsc --noEmit` 0. Commit `feat(auth): mailer + reset-token helpers`.

### Task 3: Actions requestPasswordReset / resetPasswordWithToken / validateResetToken (member + admin) + tests

**Files:** Create `src/actions/password-reset.ts` (+ `password-reset.integration.test.ts`). Reuse từ password-auth.ts: `isValidPassword`, `normalizeEmail`, `isEmail`, `BCRYPT_ROUNDS`, `clearUserCookie`; `checkRateLimit`, `getTrustedClientIp`, `getTranslations`, `after` from `next/server`.

**Interfaces:**

- `requestPasswordReset(input:{ email:string; scope:"member"|"admin" }): Promise<{ ok:true; message:string }>` — LUÔN trả neutral message.
- `resetPasswordWithToken(input:{ token:string; newPassword:string }): Promise<{ success:true; subject:"member"|"admin" } | { tokenError:string } | { passwordError:string }>`.
- `validateResetToken(input:{ token:string }): Promise<{ status:"valid"|"invalid"; subject?:"member"|"admin" }>`.

- [ ] Step 1 — Viết integration test đỏ (mock `@/lib/mailer` sendPasswordResetEmail, `next/server` after=(fn)=>fn(), `@/lib/user-identity` clearUserCookie, next/cache; createTestDb). Cases: member tồn tại có email → tạo token (đếm row) + gọi mailer; member không tồn tại → vẫn neutral, không tạo token; admin scope tra bảng admins; reset token hợp lệ → đổi passwordHash đúng bảng + usedAt set; token hết hạn/đã dùng/sai → tokenError; double-submit CAS đúng 1 thắng; password ngắn → passwordError; validateResetToken valid/invalid + subject.
- [ ] Step 2 — Run → FAIL. Step 3 — Implement theo spec §6 (2026-06-16) + admin subject: `requestPasswordReset` tra `members` (scope member: isActive & !rejected & có email) hoặc `admins` (scope admin: có email); sinh token (member_id XOR admin_id), TTL 60'; trong `db.transaction` xoá token cũ chưa dùng của subject + insert; gửi mail qua `after()`. `resetPasswordWithToken`: CAS `UPDATE ... SET used_at=:now WHERE token_hash=:h AND used_at IS NULL AND expires_at>:now`, rowsAffected===1; bcrypt.hash → update members/admins theo FK; member → clearUserCookie. `validateResetToken`: đọc thuần, so JS. Rate-limit tất cả.
- [ ] Step 4 — Run test PASS + `npx tsc --noEmit` 0. Commit `feat(auth): password reset actions (member + admin)`.

### Task 4: Invite email khi tạo member (Part B)

**Files:** Modify `src/actions/members.ts` (createMember), `src/app/(admin)/admin/members/member-list.tsx` (add-member form), test in `members.integration.test.ts`.

- [ ] Step 1 — Test đỏ: createMember với email + `sendInvite="1"` → tạo member + tạo 1 password_reset_tokens (member_id=newId, expiresAt ~7 ngày) + gọi sendInviteEmail (mock). Không có email hoặc sendInvite khác "1" → không tạo token/không gửi.
- [ ] Step 2 — Run FAIL. Step 3 — Trong createMember, SAU khi insert member thành công + có email: nếu `formData.get("sendInvite")==="1"` → sinh token (generateResetToken), insert password_reset_tokens {memberId:newId, tokenHash, expiresAt:inviteTokenExpiryIso()}, gọi `sendInviteEmail(email, ${NEXT_PUBLIC_APP_URL}/reset-password/<rawToken>)` qua `after()` (không chặn response; lỗi mail không rollback member). Lấy newId qua `.returning({id})`.
- [ ] Step 4 — Form add-member: thêm checkbox `name="sendInvite" value="1"` (label i18n "Gửi mail mời đặt mật khẩu", chỉ hiện/hữu dụng khi có email — hint).
- [ ] Step 5 — Run members test PASS + tsc 0. Commit `feat(members): send set-password invite email on create`.

### Task 5: (auth) route group UI + link quên-mật-khẩu ở member login

**Files:** Create `src/app/(auth)/layout.tsx`, `forgot-password/page.tsx` (+form), `reset-password/[token]/page.tsx` (+form). Modify `src/app/(public)/password-auth-form.tsx` (+link), `next.config.ts` (Referrer-Policy).

- [ ] Step 1 — Port `(auth)/layout.tsx` từ worktree (wrapper thuần, mobile-first, KHÔNG html/body/providers).
- [ ] Step 2 — `/forgot-password/page.tsx` + client form: 1 input email → `requestPasswordReset({email, scope:"member"})` → confirm trung tính. Copy: member OAuth-only không email → đăng nhập FB/Google rồi đặt mk ở /me. Link về đăng nhập.
- [ ] Step 3 — `/reset-password/[token]/page.tsx` (server, `const {token}=await params`) → `validateResetToken`. valid → client form (mk mới + confirm khớp, show/hide) → `resetPasswordWithToken`; success → điều hướng theo subject (member→`/`, admin→`/admin/login`) + toast. invalid → màn hết hạn + nút "Gửi lại". TOCTOU: submit trả tokenError → chuyển màn hết hạn.
- [ ] Step 4 — password-auth-form.tsx: thêm link "Quên mật khẩu?" (next/link → /forgot-password) chỉ ở `mode==="login"`.
- [ ] Step 5 — next.config.ts: header `Referrer-Policy: no-referrer` cho route `/reset-password/:path*`.
- [ ] Step 6 — tsc 0 + build OK. Commit `feat(auth): forgot/reset-password UI + member login link`.

### Task 6: Admin forgot-password entry

**Files:** Create `src/app/(auth)/admin-forgot-password/page.tsx` (+form). Modify `src/app/(admin)/admin/login/page.tsx` (+link).

- [ ] Step 1 — `/admin-forgot-password` (trong group (auth), KHÔNG dưới /admin/\* để không bị proxy gate) + form email → `requestPasswordReset({email, scope:"admin"})` → confirm trung tính. Reset dùng chung `/reset-password/[token]`, admin subject → sau reset về /admin/login.
- [ ] Step 2 — /admin/login: thêm link "Quên mật khẩu?" → /admin-forgot-password.
- [ ] Step 3 — tsc 0 + build OK. Commit `feat(admin): forgot-password entry on admin login`.

### Task 7: i18n (passwordReset + invite + links) vi/en/zh

**Files:** Modify `src/i18n/messages/{vi,en,zh}.json`.

- [ ] Step 1 — Thêm namespace `passwordReset` (forgot form title/desc/submit/neutralConfirm, reset form new/confirm/submit, tokenExpired title/desc/resend, invite email copy nếu để i18n) + `passwordAuth.forgotPassword` (link) + `adminMembers.sendInvite`/`sendInviteHint` + `serverErrors.tooManyResetRequests`. Đủ 3 ngữ, cùng key.
- [ ] Step 2 — `node -e` validate JSON + `npx vitest run src/i18n/locale-parity.test.ts` PASS. Commit `feat(i18n): password reset + invite strings`.

### Task 8: e2e + full verify

**Files:** Create `e2e/forgot-password.spec.ts`, extend invite check.

- [ ] Step 1 — Áp migration 0022 vào `e2e/local.db` (CREATE TABLE password_reset_tokens + index) trước khi chạy.
- [ ] Step 2 — e2e member forgot→reset: seed member có email + password vào local.db → /forgot-password nhập email → (SMTP chưa cấu hình ở e2e → mailer dev-log; hoặc đọc token từ local.db trực tiếp) → mở /reset-password/<token> → đặt mk mới → login lại bằng mk mới OK. e2e invite: admin tạo member có email + sendInvite → token xuất hiện trong local.db (poll). e2e admin-forgot: tương tự member nhưng scope admin.
- [ ] Step 3 — Full verify: `npx tsc --noEmit`, `npx vitest run` (regression), `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`, `npx playwright test` (4 baseline auth-password fail là đã biết). Commit `test(auth): e2e forgot-password + invite`.

### Task 9: env + deploy

- [ ] Step 1 — `.env.example`: thêm khối SMTP + `NEXT_PUBLIC_APP_URL`. Commit `docs(env): SMTP example vars`.
- [ ] Step 2 — Prod migration 0022 (CREATE TABLE + index) qua script libsql đọc .env.local (KHÔNG db:push) + verify sqlite_master.
- [ ] Step 3 — Đồng bộ SMTP env sang Vercel: script đọc .env.local đẩy `vercel env add <NAME> production` (SMTP_HOST/PORT/SECURE/USER/PASS, MAIL_FROM, NEXT_PUBLIC_APP_URL nếu chưa có) — non-interactive qua stdin, KHÔNG in giá trị.
- [ ] Step 4 — `vercel --prod --yes`. Verify prod: /forgot-password 200, /admin-forgot-password 200, gửi thử 1 reset thật tới email của admin (chấp nhận).

## Self-review checklist (chạy sau khi viết xong từng task)

Spec coverage (invite + member forgot + admin forgot đều có task), no placeholder, type consistency (subject "member"|"admin" nhất quán; token helper tên khớp), migration additive verified.

## Sau khi xong

Cập nhật `memory/project_admin_account_mgmt_progress.md`: Phase 2/3 + Part B DONE + live. Xoá nhánh sau merge.
