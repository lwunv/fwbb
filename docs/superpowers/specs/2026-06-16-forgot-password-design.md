# Thiết kế: Chức năng Quên mật khẩu (Forgot Password)

> Ngày: 2026-06-16 · Project: FWBB (Next.js 16, App Router, Drizzle/Turso)
> Trạng thái: Đã chốt qua brainstorming + đã qua adversarial review (5 lăng kính, verify với code thật). Chờ user review trước khi viết plan.

## 1. Mục tiêu & phạm vi

Member đăng nhập bằng **email + mật khẩu** quên mật khẩu → tự đặt lại qua link gửi về email.
Member **OAuth-only** (Facebook/Google, chưa từng có mật khẩu) nhưng **có email** → dùng cùng luồng này để **đặt mật khẩu lần đầu**.

**Ngoài phạm vi:** đổi email; khôi phục tài khoản không có email (chỉ hướng dẫn, không tự xử lý); reset cho admin (admin dùng cơ chế JWT riêng — không đụng tới); **evict các phiên trên thiết bị khác** (cookie là HMAC stateless, không có credential-version → xem Rủi ro §12).

## 2. Quyết định đã chốt

| Quyết định                      | Lựa chọn                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Kênh giao                       | Email tự phục vụ                                                                   |
| Gửi mail                        | **Nodemailer + SMTP (Gmail App Password)**                                         |
| Dạng reset                      | **Link có token** (`/reset-password/<rawToken>`)                                   |
| Sau khi đổi xong                | **Về trang đăng nhập** — và **xoá cookie phiên hiện tại** để thực sự về được login |
| OAuth-only (không passwordHash) | **Cho đặt mật khẩu lần đầu** nếu có email hợp lệ                                   |
| Hết hạn token                   | **60 phút**                                                                        |
| Lưu token                       | **Bảng riêng `password_reset_tokens`, lưu sha256(token)**                          |

## 3. Luồng tổng thể

```
[Login form] —"Quên mật khẩu?"→ /forgot-password
   → nhập email → requestPasswordReset({ email })
   → (LUÔN) thông báo trung tính: "Nếu email tồn tại, chúng tôi đã gửi link đặt lại"
   → email (gửi qua after(), ngoài request) chứa link: {APP_BASE_URL}/reset-password/<rawToken>
   → mở link → trang reset-password (server) gọi validateResetToken
        ├─ token không hợp lệ (hỏng / hết hạn / đã dùng) → màn "link hết hạn" + nút "Gửi lại link"
        └─ token hợp lệ → form nhập mật khẩu mới (+ xác nhận khớp)
              → resetPasswordWithToken({ token, newPassword })
              → CAS đánh dấu token usedAt → đổi passwordHash → xoá cookie phiên
              → router.push("/") (giờ thực sự về login gate) + toast "đổi thành công, mời đăng nhập lại"
```

## 4. Database

### Bảng mới: `password_reset_tokens` (thêm vào `src/db/schema.ts`)

```ts
export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memberId: integer("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // sha256(rawToken) hex
  expiresAt: text("expires_at").notNull(), // ISO-8601 UTC, Date(...).toISOString()
  usedAt: text("used_at"), // null = chưa dùng (single-use)
  createdAt: text("created_at").default(sql`(current_timestamp)`),
});
```

**Nguyên tắc:**

- **Lưu HASH, không lưu raw token.** rawToken chỉ tồn tại trong link email; DB lộ cũng không tạo được link hợp lệ.
- `tokenHash` UNIQUE → index tra cứu nhanh + chống trùng.
- Single-use qua `usedAt`; hết hạn qua `expiresAt`.
- FK cascade: xóa member → xóa token.

**Format thời gian (QUAN TRỌNG — repo có 2 convention TEXT-timestamp lẫn nhau):**

- Lưu `expiresAt = new Date(Date.now() + 3600_000).toISOString()` (**UTC, có hậu tố `Z`**).
- Vì ISO-8601-UTC sắp xếp đúng theo thứ tự từ điển, **so sánh hết hạn trong SQL bằng chuỗi là hợp lệ** _khi và chỉ khi_ `now` cũng sinh bằng `new Date().toISOString()` (cùng format). Dùng đúng một format này ở cả CAS (§6) lẫn validate (§6). Trên đường đọc thuần (validateResetToken) so sánh trong JS: `new Date(row.expiresAt).getTime() > Date.now()` (giống `isVoteOpen`/`session-status.ts`). **Tuyệt đối không trộn format** → sẽ âm thầm nhận token hết hạn hoặc từ chối token hợp lệ.

**Dọn rác (chống phình bảng):** không có gì tự xoá → bảng tích luỹ secret cũ vô hạn. Mô phỏng prune ~1% của `rate-limit.ts:134`: trong `requestPasswordReset`, theo xác suất nhỏ chạy `DELETE FROM password_reset_tokens WHERE usedAt IS NOT NULL OR expiresAt < now`. (Hoặc dọn toàn bộ token cũ của _chính member đó_ mỗi lần họ xin link — rẻ và đủ.)

**Migrate:** `pnpm db:generate` sinh file numbered (vd `0016_password_reset_tokens.sql` kèm unique index `token_hash`) → **commit file .sql này** (đây mới là artifact chuẩn; harness test tích hợp `src/db/test-db.ts` replay các file numbered theo thứ tự, KHÔNG dùng `db:push`). Prod cũng apply qua migration. Sau khi apply: **verify `sqlite_master`** trên Turso có bảng + index (gotcha drizzle-kit/Turso đã biết).

## 5. Mailer — `src/lib/mailer.ts` (mới)

- Dùng `nodemailer` (thêm dependency: `nodemailer` + `@types/nodemailer`).
- **Yêu cầu Node.js runtime** (net/tls/dns) — KHÔNG chạy trên Edge. Segment `(auth)` để mặc định Node, **không** `export const runtime = "edge"`. (Nếu muốn an toàn: import mailer động bên trong action để lỗi misconfig nổ lúc gọi + được log, thay vì lúc load module.)
- Đọc env ở module-top; tạo transporter Gmail SMTP.
- **Non-blocking đúng pattern `src/lib/messenger.ts`:** trả `{ success, error? }`, log lỗi, **không throw**, warn nếu thiếu config.

```ts
// Env: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true
//      SMTP_USER=<gmail> SMTP_PASS=<app password> MAIL_FROM="FWBB <...>"
//      APP_BASE_URL=https://<domain>
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<{ success: boolean; error?: string }>;
```

- Builder nội dung **song ngữ vi/en** (text + HTML đơn giản, inline style, mobile-friendly cho webview Zalo/Messenger), nêu rõ link hết hạn 60' và "nếu không phải bạn yêu cầu, bỏ qua email này".
- **APP_BASE_URL** là nguồn chân lý cho host trong link (KHÔNG suy ra từ header `Host` → chống host-header injection vào link reset). Bắt buộc https ở production.
- **Dev-only:** khi SMTP chưa cấu hình **và** `NODE_ENV !== "production"` → log full reset URL ra server (để QA chạy được luồng). **Cấm log URL này ở production.**

### `.env.example`

Bổ sung khối SMTP + `APP_BASE_URL` với chú thích cách lấy Gmail App Password.

## 6. Server actions — thêm vào `src/actions/password-auth.ts`

Đặt cùng file để tái dùng helper sẵn có: `normalizeEmail`, `isEmail`, `isValidPassword`, `BCRYPT_ROUNDS`, `checkRateLimit`, `getTrustedClientIp`, `getTranslations`, và `clearUserCookie` (từ `@/lib/user-identity`).

**Logging:** structured, prefix `[PasswordReset]` (giống `messenger.ts`), vd `[PasswordReset] requested memberId=… ip=…`, `[PasswordReset] completed memberId=…`. **Không bao giờ log raw token.**

### `requestPasswordReset({ email })`

1. **Normalize email TRƯỚC** (`normalizeEmail` = trim+lowercase), rồi mới dựng mọi key rate-limit.
2. Rate-limit **theo IP** (`pw-reset-req:${ip}`, vd 5/10') **và theo email đã normalize** (`pw-reset-req-email:${emailNorm}`, vd 3/15'). Per-email là backstop chính (xem cảnh báo IP "unknown" ở §8). Khi chạm ngưỡng → trả thông báo trung tính (không lộ "email này bị giới hạn").
3. Validate email; tra member theo email.
4. **LUÔN trả về cùng một thông báo trung tính** bất kể email có tồn tại — chống dò email.
5. Chỉ chuẩn bị gửi mail nếu: member tồn tại **và** có email **và** `isActive` **và** `approvalStatus != "rejected"`. (Cho phép `pending` — tài khoản hợp lệ đang chờ duyệt. Cho phép `passwordHash == null` — OAuth-only đặt lần đầu.)
6. Sinh `rawToken = randomBytes(32).toString("base64url")`; `tokenHash = sha256(rawToken)`; `expiresAt = toISOString(now+60')`.
7. **Trong một `db.transaction`:** vô hiệu token chưa dùng còn hạn của member (xoá hoặc set `usedAt`) **+** insert token mới. **Bắt mọi lỗi** (UNIQUE collision / SQLITE_BUSY) → vẫn trả thông báo trung tính (lỗi DB không được đổi shape phản hồi → giữ enumeration defense). Tuỳ chọn retry 1 lần với token mới nếu trùng hash.
8. **Gửi mail qua `after()` của Next (`next/server`), KHÔNG await trong request** → (a) khử timing oracle (chỉ nhánh email-tồn-tại mới tốn round-trip SMTP hàng trăm ms), (b) đảm bảo mail thực sự gửi trên serverless (fire-and-forget trần thường bị kill). _Verify `after()` có sẵn ở Next 16 lúc implement; nếu không, dùng cơ chế tương đương._
9. Lỗi SMTP (trong `after`) → log, không ảnh hưởng phản hồi (đã trả trước đó).

### `resetPasswordWithToken({ token, newPassword })`

1. Rate-limit theo IP (`pw-reset:${ip}`, vd 10/10') — cũng tiêu budget cho token sai → throttle dò token.
2. Validate `newPassword` bằng `isValidPassword` (8–128 ký tự, ≤72 bytes UTF-8). (Xác nhận "khớp confirm" làm ở client; server chỉ cần newPassword.)
3. **Single-use bằng Compare-And-Swap (KHÔNG dựa vào re-read trong tx):**
   - `tokenHash = sha256(token)`.
   - Chạy **conditional UPDATE**: `UPDATE password_reset_tokens SET used_at = :nowIso WHERE token_hash = :h AND used_at IS NULL AND expires_at > :nowIso` (cùng format ISO-UTC ở §4) → kiểm `rowsAffected === 1`. Nếu 0 → token không hợp lệ/đã dùng/hết hạn → trả lỗi token (phân biệt với lỗi password, xem §7).
   - Chỉ khi CAS thành công mới `bcrypt.hash(newPassword, 12)` và `UPDATE members SET passwordHash` cho `memberId` của token.
   - Vô hiệu các token còn lại của member (chống link song song).
   - (CAS đảm bảo single-use kể cả 2 submit đồng thời — đúng tinh thần "DB là last line of defence" như `idempotency_key` UNIQUE.)
4. **Xoá cookie phiên hiện tại** bằng `clearUserCookie()` (server-side). Lý do: `(public)/layout.tsx` render app/pending khi còn cookie hợp lệ; ca OAuth-only-đặt-lần-đầu thì user ĐANG đăng nhập → không xoá thì `router.push("/")` không về được login. **Không** tạo cookie mới.
5. Trả `{ success: true }` hoặc lỗi có **phân loại** (`tokenError` vs `passwordError`) để client điều hướng đúng.

### `validateResetToken({ token })` (helper render trang reset, GET-time)

- **Rate-limit theo IP** (cùng họ bucket với reset POST) — chống amplifier tra DB miễn phí.
- Đường đọc thuần (không mutate `usedAt`): tra `sha256(token)`, so sánh expiry trong JS.
- **Trả về binary cho phía client/unauth: `valid` | `invalid`** (gộp used/expired/malformed thành "không hợp lệ" — không lộ token từng tồn tại/đã bị tiêu). Giữ chi tiết chỉ cho log server.

## 7. UI — route group mới `(auth)` (KHÔNG có login gate)

**Lý do tách group:** `(public)/layout.tsx` thay toàn bộ children bằng `FacebookLoginGate` khi chưa có cookie → đặt trang reset trong `(public)` sẽ bị gate chặn. Group `(auth)` có layout riêng.

- `src/app/(auth)/layout.tsx` — **wrapper thuần** (div/section nền gradient/glass theo CSS vars), **KHÔNG render `<html>/<body>`, KHÔNG bọc lại providers** (root `src/app/layout.tsx` đã cấp html/body/ThemeProvider/NextIntlClientProvider/fonts) — mirror `(admin)/admin/layout.tsx`. Mobile-first, không bottom-nav.
- `src/app/(auth)/forgot-password/page.tsx` (+ client form) — 1 input email; nút submit sticky đáy (≥44px); **trạng thái loading bằng `useTransition` + `Loader2`** (xem chuẩn UI bên dưới); sau submit hiện confirm **trung tính**. Copy phải hướng dẫn rõ: _member đăng nhập bằng FB/Google mà chưa có email_ → đăng nhập bằng FB/Google rồi dùng luồng đặt mật khẩu/thêm email trong app (`/me`), vì email reset không thể tới. Có link quay lại đăng nhập.
- `src/app/(auth)/reset-password/[token]/page.tsx` — **server component**, **`params` là Promise** ở Next 16 → `const { token } = await params;` (xác nhận theo `vote/[id]` & `admin/sessions/[id]` đều `await params`). Hash đúng chuỗi `token` **verbatim** (base64url path-safe → không `encodeURIComponent` lúc dựng link, không decode/trim lúc hash). Gọi `validateResetToken`:
  - `valid` → render client form (mật khẩu mới + xác nhận khớp, nút show/hide như `password-auth-form.tsx`); submit gọi `resetPasswordWithToken`; thành công → `router.push("/")` + `toast.success`.
  - `invalid` → màn "link hết hạn / không hợp lệ" + nút "Gửi lại link" (→ `/forgot-password`).
  - **TOCTOU UX:** nếu submit trả `tokenError` (token bị tiêu/hết hạn giữa render và submit) → form **chuyển sang** màn "hết hạn/không hợp lệ" + CTA "Gửi lại link" (không chỉ `toast.error`). `passwordError` → hiển thị lỗi inline, giữ form.
- Sửa `src/app/(public)/password-auth-form.tsx`: thêm link **"Quên mật khẩu?"** chỉ hiển thị ở `mode === "login"`, trỏ `/forgot-password` (dùng `next/link`).

**Chuẩn UI (theo AGENTS.md, có điều chỉnh cho auth):** mobile-first; touch target ≥44px; body ≥16px; không hardcode màu (CSS vars); empty/error states rõ ràng. **Lưu ý lệch chuẩn có chủ đích:** luồng auth/credential **KHÔNG áp optimistic-UI/`fireAction`** (không thể "lạc quan" báo _đã gửi mail_ / _đã đổi mật khẩu_ khi chưa có kết quả server) và **không cần skeleton** (không có client data-fetch) — dùng `useTransition` + `Loader2` y như `password-auth-form.tsx`. `framer-motion` chỉ là transition mount card (tuỳ chọn).

## 8. Bảo mật (khớp `project_security_posture`)

- Token: 256-bit ngẫu nhiên, **hash-at-rest (sha256)**, **single-use bằng CAS** (§6), hết hạn 60'.
- Phản hồi **trung tính** ở `requestPasswordReset` (kể cả khi chạm rate-limit hay lỗi DB) → chống email enumeration.
- **Khử timing oracle:** SMTP gửi qua `after()` ngoài request → nhánh email-tồn-tại không chậm hơn nhánh không-tồn-tại bởi round-trip mail.
- Rate-limit: request (IP + **email đã normalize**) và reset (IP) và **validateResetToken (IP)**.
- **Cảnh báo IP "unknown":** `client-ip.ts:28` trả `"unknown"` khi không có proxy tin cậy (x-real-ip) → mọi request gộp một bucket → hoặc khoá nhầm cả nhóm (DoS), hoặc per-IP vô nghĩa. ⇒ Precondition triển khai: **proxy tin cậy set x-real-ip**; per-email (đã normalize) là kiểm soát chống abuse **chính**. Cân nhắc cap toàn cục chặt hơn (fail-closed) khi IP = "unknown" thay vì chia chung một bucket rộng rãi.
- **Token-in-URL leak:** header toàn cục `Referrer-Policy: strict-origin-when-cross-origin` (`next.config.ts:40`) đã chặn rò cross-origin. Residual same-origin (Referer subresource, history): set **`Referrer-Policy: no-referrer` riêng cho route `/reset-password/[token]`**; giữ layout `(auth)` không nhúng subresource/RUM ngoài; tuỳ chọn sau khi tiêu token thì `router.replace` sang URL không token để khỏi lưu history.
- **Không log raw token**; structured log sự kiện reset (audit cho admin).
- Vô hiệu token cũ khi xin mới và khi đổi thành công.
- Đổi mật khẩu thành công **không** tự cấp phiên + **xoá cookie hiện tại** → buộc đăng nhập lại bằng mật khẩu mới.

## 9. i18n

- Tất cả chuỗi qua next-intl cho **vi/en/zh** (không hardcode — bài học từ commit fix i18n trước).
- Namespace mới `passwordReset` (forgot form, confirm trung tính, reset form, lỗi token, màn hết hạn, nội dung email) + bổ sung khoá `forgotPassword` vào `passwordAuth` cho link.
- **Rate-limit message:** `serverErrors` hiện chỉ có `tooManyLoginAttempts/tooManyChangePassword/tooManyActions` — không khoá nào hợp với reset. ⇒ **Thêm khoá mới `tooManyResetRequests`** vào `serverErrors` cho cả vi/en/zh (đừng tái dùng `tooManyLoginAttempts` → sẽ hiện "quá nhiều lần ĐĂNG NHẬP" sai ngữ cảnh).

## 10. Kiểm thử (TDD ở bước implement)

- **Unit:** sinh + hash token; kiểm tra expiry với **format ISO-UTC** (boundary qua/chưa hết hạn); `isValidPassword` cho password mới + xác nhận khớp.
- **Action `requestPasswordReset`:** member có/không tồn tại (đều trả trung tính), bị khóa/rejected (không gửi), không có email (không gửi), OAuth-only có email (gửi), vô hiệu token cũ, rate-limit chạm ngưỡng (IP + email-normalized: `Foo@x`/`foo@x` cùng bucket), lỗi DB vẫn trả trung tính.
- **Action `resetPasswordWithToken`:** token hợp lệ (đổi được, `usedAt` set), hết hạn, đã dùng, sai/giả, password không hợp lệ, **double-submit đồng thời (CAS → đúng 1 thành công)**, cookie bị xoá sau khi đổi, rate-limit.
- **`validateResetToken`:** trả binary valid/invalid; rate-limit.
- **Migration:** verify `sqlite_master` có bảng + index `token_hash` sau khi apply migration numbered.
- **i18n parity:** verify 3 file vi/en/zh có **cùng tập khoá** cho `passwordReset` + khoá `forgotPassword` + `tooManyResetRequests` (chống MISSING_MESSAGE ở zh).
- **Manual/e2e (mobile viewport):** login → forgot → lấy link (SMTP thật hoặc **dev URL log**) → reset → đăng nhập lại bằng mật khẩu mới; thử mở 2 tab cùng link (tab 2 phải báo hết hạn).

## 11. Liệt kê file đụng tới

| File                                             | Hành động                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema.ts`                               | + bảng `passwordResetTokens`                                                                                                                            |
| `src/db/migrations/0016_*.sql`                   | sinh **và commit** migration numbered (kèm unique index)                                                                                                |
| `src/lib/mailer.ts`                              | **mới** — nodemailer + `sendPasswordResetEmail` + dev-URL-log                                                                                           |
| `src/actions/password-auth.ts`                   | + 3 action: request / reset / validate (+ structured log, `clearUserCookie`, `after()`)                                                                 |
| `src/actions/members.ts`                         | **mergeMember**: vô hiệu/xử lý `password_reset_tokens` của source member TRƯỚC khi `tx.delete(members)` (cascade sẽ xoá ngầm — cần chủ động invalidate) |
| `src/app/(auth)/layout.tsx`                      | **mới** (wrapper thuần)                                                                                                                                 |
| `src/app/(auth)/forgot-password/page.tsx`        | **mới** (+ client form)                                                                                                                                 |
| `src/app/(auth)/reset-password/[token]/page.tsx` | **mới** (+ client form)                                                                                                                                 |
| `src/app/(public)/password-auth-form.tsx`        | + link "Quên mật khẩu?"                                                                                                                                 |
| `next.config.ts` _(hoặc route headers)_          | `Referrer-Policy: no-referrer` cho `/reset-password/*`                                                                                                  |
| `src/i18n/*` (vi/en/zh)                          | + namespace `passwordReset`, khoá `passwordAuth.forgotPassword`, `serverErrors.tooManyResetRequests`                                                    |
| `.env.example`                                   | + khối SMTP + `APP_BASE_URL`                                                                                                                            |
| `package.json`                                   | + `nodemailer`, `@types/nodemailer`                                                                                                                     |

## 12. Rủi ro & lưu ý

- **Residual: không evict phiên thiết bị khác.** Cookie là HMAC stateless không bind password → sau reset, phiên cũ trên thiết bị khác **vẫn sống** tới khi hết hạn cookie. Evict thật cần thêm `credentialVersion` vào cookie + reject mismatch ở mọi login path — **ngoài phạm vi** feature này; ghi nhận là residual risk.
- **Deliverability Gmail App Password:** dễ vào spam, ~500 mail/ngày — đủ nhóm nhỏ; mailer viết generic theo env nên đổi sang SMTP chuyên dụng dễ. Per-email rate-limit (đã normalize) cũng giúp không đốt quota.
- **APP_BASE_URL phải set đúng** mọi môi trường, nếu không link reset sẽ sai.
- **Thiếu env SMTP ở dev** → mailer warn + no-op + (dev-only) log URL ra server; trang vẫn báo trung tính (không crash).
- **nodemailer cần Node runtime** — không để segment `(auth)` opt vào edge.
