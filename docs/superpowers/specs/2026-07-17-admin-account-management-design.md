# Thiết kế: Quản lý tài khoản Admin như một user (đổi/quên mật khẩu, Google SSO, email/SĐT/username) + gửi mail

> Ngày: 2026-07-17 · Project: FWBB (Next.js 16, App Router, Drizzle/Turso)
> Trạng thái: Đã brainstorm + chốt hướng với user. Chờ user review trước khi viết plan.

## 1. Mục tiêu & phạm vi

Cho tài khoản **admin** các khả năng tự quản lý giống một user thường:

- Đổi mật khẩu (backend đã có, chỉ thiếu UI).
- Quên mật khẩu qua email (tự đặt lại bằng link token).
- Đăng nhập bằng Google (SSO) + liên kết Google.
- Thêm/sửa **email**, **SĐT**, **username**.

Kèm theo: dựng **hạ tầng gửi mail** (SMTP) dùng chung, và hoàn thiện **quên-mật-khẩu cho member** (tận dụng lại infra).

**Kiến trúc đã chốt: Hybrid tối giản.** Admin GIỮ bảng `admins` riêng và cookie JWT riêng (`fwbb-admin-token`). Ta MỞ RỘNG bảng admins + thêm flow admin, KHÔNG hợp nhất admin vào auth của member. SSO Google cho admin **tự chứa** (google_id nằm trên admins).

**Ngoài phạm vi:** đổi cơ chế cookie/JWT của admin; evict phiên trên thiết bị khác (cookie HMAC/JWT stateless, không có credentialVersion — residual risk, giữ nguyên); xác minh quyền sở hữu email (email tin theo input + unique, giống member hiện tại); Facebook SSO cho admin (FB đang ẩn toàn site).

## 2. Bối cảnh hiện trạng (đã map bằng workflow 5 reader)

- **Admin auth tách biệt:** bảng `admins` chỉ có `id, username(unique), passwordHash, memberId(FK→members, nullable, dùng cho tính tiền), createdAt`. Login = username/password (`login()` actions/auth.ts) → JWT HS256 `{sub, role:'admin'}` trong cookie `fwbb-admin-token`, 7 ngày. Gác 2 lớp: `proxy.ts` middleware (`/admin/:path*`) + `requireAdmin()`.
- **Đổi mật khẩu admin ĐÃ có** (`changePassword` auth.ts:86-154, cần current pw, rate-limit, policy 8 ký tự/≤72 byte) nhưng **UI `password-change-form.tsx` mồ côi** (không import ở đâu; minLength client 6 lệch server 8).
- **Member đã có sẵn** luồng "user thường": login đa kênh (email/username/phone/password), set/đổi mật khẩu, thêm email/phone/username (`updateMyProfile`, helper dùng chung `resolveUsername`), link/unlink Google (`google-auth.ts` + `member_oauth_identities`), ép đổi mật khẩu.
- **Chưa có gửi mail nào trên main.** Có nhánh cũ `feat/forgot-password` (fork ~16/6, ĐÃ phân kỳ nặng so với main — KHÔNG merge được) nhưng chứa artifact tái dùng tốt: `src/lib/mailer.ts`, `src/lib/password-reset-token.ts`, và **design spec member forgot-password đã qua adversarial review** (`docs/.../2026-06-16-forgot-password-design.md`). Ta **bê từng file** lên main, không merge nhánh.
- **Google SSO** dùng `verifyGoogleIdToken` (google-auth.ts, verify qua endpoint tokeninfo của Google, cần `NEXT_PUBLIC_GOOGLE_CLIENT_ID`) — tái dùng được cho admin.
- **Gotcha:** `.env.local` trỏ DB PROD (không db:push/seed lung tung — dùng e2e/local.db); Turso recreate-table rớt index (ADD COLUMN + CREATE INDEX riêng, verify sqlite_master); `NEXT_PUBLIC_APP_URL` đã tồn tại (dùng làm base cho link reset).

## 3. Ship theo phase (mỗi phase verify + deploy độc lập)

| Phase | Nội dung                                                                                | Ràng buộc                         |
| ----- | --------------------------------------------------------------------------------------- | --------------------------------- |
| **1** | `/admin/account`: nối form đổi mật khẩu + sửa hồ sơ (email/SĐT/username)                | Không cần mail creds → ship trước |
| **2** | Hạ tầng mail (SMTP) + token + 3 action reset + `(auth)` UI + **member forgot-password** | Cần SMTP creds                    |
| **3** | **Admin forgot-password** (dùng lại infra Phase 2)                                      | Cần SMTP creds                    |
| **4** | **Admin Google SSO** (login + link)                                                     | Không                             |

## 4. Schema (1 migration numbered `0019_*`, ADD COLUMN + CREATE INDEX riêng)

```ts
// admins: thêm 3 cột (đều nullable). SQLite cho phép nhiều NULL trong UNIQUE index.
email: text("email"),           // + uniqueIndex admins_email_unique
phoneNumber: text("phone_number"),
googleId: text("google_id"),    // + uniqueIndex admins_google_id_unique

// bảng mới: token reset dùng CHUNG cho member + admin
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id").references(() => members.id, { onDelete: "cascade" }), // nullable
  adminId: integer("admin_id").references(() => admins.id, { onDelete: "cascade" }),   // nullable
  tokenHash: text("token_hash").notNull().unique(),   // sha256(rawToken) hex
  expiresAt: text("expires_at").notNull(),            // ISO-8601 UTC (…Z)
  usedAt: text("used_at"),                            // null = chưa dùng (single-use)
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});
```

- Invariant tầng app: **đúng 1 trong `memberId`/`adminId`** được set (không dùng CHECK vì Turso recreate gotcha).
- Lưu **HASH** token, không lưu raw. `token_hash` UNIQUE.
- Migration: `pnpm db:generate` → dùng ADD COLUMN + `CREATE UNIQUE INDEX` riêng cho 2 cột unique + `CREATE TABLE` cho token. Commit file .sql. Sau apply prod: verify `sqlite_master` (script `verify-migration*.mjs`).

## 5. Hạ tầng dùng chung (Phase 2) — bê từ nhánh cũ

- **`src/lib/password-reset-token.ts`** (bê nguyên): sinh raw token 256-bit base64url, `sha256` hex, TTL 60', helper expiry ISO-UTC + `isResetTokenExpired`.
- **`src/lib/mailer.ts`** (bê nguyên, non-throwing kiểu `messenger.ts`): `sendPasswordResetEmail(to, resetUrl)`, đọc env SMTP ở module-top, template song ngữ vi/en, dev log link khi thiếu SMTP + `NODE_ENV!=='production'`. **Cần Node runtime** (không edge) — segment `(auth)` mặc định Node.
- **`src/actions/password-reset.ts`** (mới, dùng chung 2 subject):
  - `requestPasswordReset({ email, scope })` với `scope: 'member' | 'admin'` (theo entry point). Normalize email TRƯỚC; rate-limit IP (`pw-reset-req:{scope}:{ip}`) + email (`pw-reset-req-email:{scope}:{emailNorm}`); tra đúng bảng theo scope; **LUÔN trả thông báo trung tính**; chỉ gửi nếu tài khoản tồn tại + có email + hợp lệ (member: isActive & !rejected; admin: luôn hợp lệ). Trong `db.transaction`: vô hiệu token cũ của subject + insert token mới; **gửi mail qua `after()`** (khử timing); mọi lỗi DB vẫn trả trung tính. Link = `${NEXT_PUBLIC_APP_URL}/reset-password/<rawToken>`.
  - `resetPasswordWithToken({ token, newPassword })`: validate password; **single-use bằng CAS** (`UPDATE … SET used_at=:now WHERE token_hash=:h AND used_at IS NULL AND expires_at>:now`, kiểm `rowsAffected===1`); chỉ khi CAS thành công mới bcrypt.hash + UPDATE `members` HOẶC `admins` theo FK có trên token; vô hiệu token còn lại của subject; member → `clearUserCookie()`, admin → không cần (đang logout). Trả lỗi phân loại `tokenError` vs `passwordError`.
  - `validateResetToken({ token })`: đọc thuần, rate-limit IP; trả `{ status:'valid'|'invalid', subject?:'member'|'admin' }` (gộp used/expired/malformed thành invalid).
- **Prune:** trong `requestPasswordReset`, xoá token cũ của chính subject đó mỗi lần xin (rẻ, đủ chống phình).

## 6. UI reset dùng chung — route group `(auth)` (Phase 2)

- `src/app/(auth)/layout.tsx` — wrapper thuần (không `<html>/<body>`, không bọc lại providers; mirror `(admin)/admin/layout.tsx`), mobile-first, nền theo CSS vars.
- `src/app/(auth)/reset-password/[token]/page.tsx` — server component, `const { token } = await params` (Next 16), gọi `validateResetToken`. `valid` → form mật khẩu mới (+ confirm khớp, show/hide); `invalid` → màn "link hết hạn" + nút gửi lại. Submit `resetPasswordWithToken`; thành công → điều hướng theo `subject`: member → `router.push('/')`, admin → `router.push('/admin/login')` + toast. TOCTOU: submit trả `tokenError` → chuyển màn hết hạn.
- Header `Referrer-Policy: no-referrer` riêng cho `/reset-password/*` (next.config route headers). Sau khi tiêu token, `router.replace` sang URL không token.
- **Auth flow KHÔNG optimistic-UI** (không thể "lạc quan" báo đã gửi mail/đã đổi mật khẩu) — dùng `useTransition` + `Loader2`, khớp `password-auth-form.tsx`.

## 7. Member forgot-password (Phase 2)

- `src/app/(auth)/forgot-password/page.tsx` (+ client form): 1 input email → `requestPasswordReset({ email, scope:'member' })` → confirm trung tính. Copy hướng dẫn member OAuth-only không email: đăng nhập FB/Google rồi đặt mật khẩu ở `/me`.
- `src/app/(public)/password-auth-form.tsx`: thêm link "Quên mật khẩu?" chỉ ở `mode==='login'` → `/forgot-password`.
- `mergeMember` (members.ts): vô hiệu `password_reset_tokens` của source member trước khi xoá (cascade sẽ xoá, nhưng chủ động invalidate cho sạch).

## 8. Admin: trang tài khoản (Phase 1)

- `src/app/(admin)/admin/account/page.tsx` (server): đọc admin hiện tại theo `cookie.sub` (KHÔNG findFirst — giữ hỗ trợ >1 admin). Thêm mục "Tài khoản" vào `admin-sidebar.tsx` + `admin-mobile-nav.tsx`.
- **Đổi mật khẩu:** nối `password-change-form.tsx` (sửa minLength 6→8). Backend `changePassword` giữ nguyên.
- **Hồ sơ:** action mới `updateAdminProfile({ username?, email?, phoneNumber? })` trong auth.ts: requireAdmin, resolve admin id từ cookie.sub, rate-limit; mỗi field chỉ đụng khi `formData.has`. Bọc write try/catch map UNIQUE → message localized.
  - **Username:** tách phần validate FORMAT (normalize lowercase + regex `^[a-z0-9._]{3,32}$`) của `resolveUsername` (members.ts) ra helper thuần dùng chung (vd `normalizeUsernameFormat(raw) → {value}|{code:'invalid'}`); còn **check UNIQUE phải tra bảng `admins`** (KHÔNG dùng nguyên `resolveUsername` vì nó tra bảng members). excludeId = chính admin.
  - **Email:** validate + lowercase + unique trong `admins` (excludeId = chính admin). Admin email độc lập với member email (2 bảng, 2 entry point forgot khác nhau — xem §9 — nên không nhập nhằng).
  - **Phone:** digits-only, không unique.

## 9. Admin: quên mật khẩu (Phase 3)

- `/admin/login` thêm link "Quên mật khẩu?" → trang riêng `src/app/(auth)/admin-forgot-password/page.tsx` → `requestPasswordReset({ email, scope:'admin' })` (tra `admins.email`). Đặt trong group `(auth)` (KHÔNG dưới `/admin/*` vì proxy.ts gate chặn logged-out; `/admin-forgot-password` không khớp matcher `/admin/:path*` nên không bị gate). **Tách scope member/admin** để tránh nhập nhằng nếu 1 email tồn tại ở cả 2 bảng. Reset xong về `/admin/login`.

## 10. Admin: Google SSO (Phase 4) — tự chứa

- `/admin/login` thêm nút "Đăng nhập Google" (dùng lại google-sdk client) → action `adminGoogleLogin(idToken)` (auth.ts): `verifyGoogleIdToken` (tái dùng) → tra `admins WHERE google_id = sub` → nếu có → `setAdminCookie(admin.id)` → `/admin/dashboard`; nếu không → lỗi "Google này chưa liên kết admin". **KHÔNG tự match bằng email** (giữ chính sách chống chiếm tài khoản).
- `/admin/account`: nút "Liên kết Google" → `linkAdminGoogle(idToken)`: verify → chặn nếu google_id đã thuộc admin khác → set `admins.google_id`. `unlinkAdminGoogle()`: gỡ (admin luôn còn username/password nên không sợ mất phương thức cuối; vẫn guard cho chắc).

## 11. Bảo mật (khớp project_security_posture)

- Token 256-bit, **hash-at-rest sha256**, **single-use CAS**, hết hạn 60'.
- `requestPasswordReset` phản hồi **trung tính** (kể cả rate-limit/lỗi DB) → chống dò email.
- Khử timing oracle: SMTP gửi qua `after()` ngoài request.
- Rate-limit: request (IP + email normalize), reset (IP), validate (IP). Cảnh báo IP "unknown" (client-ip.ts) → per-email là kiểm soát abuse chính; cân nhắc cap chặt hơn khi IP unknown.
- `Referrer-Policy: no-referrer` cho `/reset-password/*`; không log raw token; structured log sự kiện reset (audit).
- Reset thành công KHÔNG tự cấp phiên; member xoá cookie hiện tại.
- Admin JWT + `requireAdmin` + `proxy.ts` giữ nguyên. Google verify dùng `NEXT_PUBLIC_GOOGLE_CLIENT_ID` sẵn có. Policy mật khẩu dùng chung 8-128 ký tự & ≤72 byte, bcrypt cost 12.

## 12. i18n (vi/en/zh, đủ parity — có test parity)

- Namespace mới `passwordReset` (forgot form, confirm trung tính, reset form, lỗi token, màn hết hạn, nội dung email).
- Namespace mới `adminAccount` (tiêu đề trang, nhãn hồ sơ, đổi mật khẩu, liên kết Google).
- `passwordAuth.forgotPassword` (link), `serverErrors.tooManyResetRequests`, và khoá lỗi username/email cho admin (tái dùng `serverErrors.usernameInvalid/usernameTaken` đã có; thêm email nếu cần).

## 13. Env mới

`SMTP_HOST, SMTP_PORT(465), SMTP_SECURE(true), SMTP_USER, SMTP_PASS, MAIL_FROM`. Link dùng `NEXT_PUBLIC_APP_URL` sẵn có. Bổ sung `.env.example`. **User cấp giá trị SMTP sau** (Gmail App Password hoặc SMTP chuyên dụng).

## 14. Kiểm thử (TDD ở bước implement)

- **Unit:** token gen/hash, expiry boundary ISO-UTC.
- **Integration `password-reset` (member + admin):** tồn tại/không (đều trung tính), khóa/rejected/không-email → không gửi, vô hiệu token cũ, rate-limit (email `Foo@x`/`foo@x` cùng bucket), lỗi DB vẫn trung tính; reset: token hợp lệ/hết hạn/đã dùng/giả, password không hợp lệ, **double-submit CAS đúng 1 thắng**, cookie xử lý đúng theo subject.
- **Integration admin:** `updateAdminProfile` (email/phone/username set/clear/unique/trùng), `adminGoogleLogin` (khớp/không khớp google_id), `linkAdminGoogle`/`unlink` (chặn trùng admin khác).
- **Migration:** verify `sqlite_master` có 3 cột admins + 2 index + bảng token + index `token_hash`.
- **i18n parity:** 3 file cùng tập khoá cho namespace mới.
- **e2e (mobile viewport, e2e/local.db):** admin đổi mật khẩu + sửa hồ sơ; forgot-password lấy link qua dev-log URL → reset → đăng nhập lại; admin Google (mock) nếu khả thi.

## 15. File đụng tới (tổng hợp)

| File                                                                                   | Hành động                                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/db/schema.ts`                                                                     | + 3 cột admins, + bảng `passwordResetTokens`                                       |
| `src/db/migrations/0019_*.sql`                                                         | migration numbered (ADD COLUMN + CREATE INDEX + CREATE TABLE)                      |
| `src/lib/password-reset-token.ts`, `src/lib/mailer.ts` (+ test)                        | **mới** (bê từ nhánh)                                                              |
| `src/actions/password-reset.ts` (+ integration test)                                   | **mới** — 3 action dùng chung                                                      |
| `src/actions/auth.ts`                                                                  | + `updateAdminProfile`, `adminGoogleLogin`, `linkAdminGoogle`, `unlinkAdminGoogle` |
| `src/actions/members.ts`                                                               | `resolveUsername` export dùng chung; `mergeMember` invalidate token                |
| `src/app/(auth)/{layout,forgot-password,reset-password/[token],admin-forgot-password}` | **mới**                                                                            |
| `src/app/(admin)/admin/account/page.tsx` (+ client sections)                           | **mới**                                                                            |
| `src/app/(admin)/admin/login/page.tsx`                                                 | + link quên mật khẩu + nút Google                                                  |
| `src/app/(admin)/admin/dashboard/password-change-form.tsx`                             | minLength 6→8, dùng lại ở /admin/account                                           |
| `src/components/layout/{admin-sidebar,admin-mobile-nav}.tsx`                           | + mục "Tài khoản"                                                                  |
| `src/app/(public)/password-auth-form.tsx`                                              | + link "Quên mật khẩu?"                                                            |
| `next.config.ts`                                                                       | `Referrer-Policy: no-referrer` cho `/reset-password/*`                             |
| `src/i18n/{vi,en,zh}.json`                                                             | + `passwordReset`, `adminAccount`, khoá lỗi                                        |
| `.env.example`, `package.json`, `pnpm-lock.yaml`                                       | + SMTP block, + `nodemailer`/`@types/nodemailer`                                   |

## 16. Rủi ro & lưu ý

- **Không evict phiên thiết bị khác** sau reset (cookie stateless) — residual, ngoài phạm vi.
- **Deliverability SMTP** (Gmail App Password dễ vào spam, ~500 mail/ngày) — đủ nhóm nhỏ; mailer generic theo env nên đổi provider dễ.
- **`NEXT_PUBLIC_APP_URL` phải đúng** mọi môi trường (link reset).
- **Vercel auto-deploy đứt** — deploy thủ công `vercel --prod --yes` mỗi phase.
- **admins table nhỏ**, thêm cột phải ADD COLUMN + index riêng (không recreate) — verify sqlite_master trên prod.
