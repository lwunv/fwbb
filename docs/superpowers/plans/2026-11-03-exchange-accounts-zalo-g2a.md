# Tài khoản giao lưu + đăng nhập Zalo (G2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người ngoài nhóm đăng nhập bằng Zalo hoặc Google từ trang giao lưu, có tài khoản giao lưu (không cần admin duyệt) chỉ vào được phần giao lưu và danh bạ sân, không bao giờ thấy dữ liệu nhóm. Toàn bộ nằm sau cờ `exchangeEnabled` (tắt mặc định). Đăng nhập Facebook cho người ngoài để sau (quyết định 8).

**Architecture:** Người ngoài vẫn là một dòng `members` với `approvalStatus = "pending"` và cột mới `signup_intent = "exchange"`. Quyền nhóm giữ nguyên là `approved`. Quyền giao lưu là `isActive && approvalStatus !== "rejected"`. Zalo là luồng OAuth chuyển hướng đầu tiên của repo: route `start` (POST, kiểm Origin + Turnstile) và `callback` (GET). State + PKCE nằm trong cookie ký HMAC, và mỗi state chỉ dùng được 1 lần nhờ một dòng "đã dùng" ghi vào `rate_limit_buckets`. Logic tách thành hàm thuần trong `src/lib/` để test bằng fetch giả. Route group mới `(exchange)` dùng chung khung layout với `(public)` qua server component `MemberShell`, chỉ khác ở các nhánh tài khoản chờ duyệt khi cờ bật.

**Tech Stack:** Next.js 16 App Router (route handlers, server actions), Drizzle + Turso, zod, next-intl, react-query, vitest, Playwright, Cloudflare Turnstile (script `challenges.cloudflare.com/turnstile/v0/api.js`, không thêm thư viện npm).

**Spec:** `docs/superpowers/specs/2026-11-03-exchange-events-nearby-design.md` (mục 4.6b, 4.6c phần "Lớp chặn nick ảo" dòng Zalo, 4.6e, 4.7 dòng `members`, 4.9 G2).

**Nghiên cứu nền:** `D:/Lwcifer/LW/FWBB-venues/.superpowers/g2a/understand.json` (auth map, audit 174 hàm, tài liệu Zalo v4 và Turnstile đọc ngày 3/11/2026). Plan này đã qua 1 vòng rà 4 góc (36 phát hiện xác nhận, đã gộp vào), kết quả ở scratchpad phiên 3/11.

## Global Constraints

- Đọc `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `02-guides/authentication.md` và `03-api-reference/04-functions/cookies.md` trước khi viết route handler, layout, cookie.
- **An toàn cho chức năng đang chạy (user dặn 3/11):** mọi hành vi mới nằm sau `exchangeEnabled` (mặc định `false`). Khi cờ tắt, mọi URL mới trả HTTP 404 và mọi luồng cũ chạy y như trước. Test "giữ nguyên hành vi" (Task 1) viết TRƯỚC khi sửa layout hay đăng nhập, và về sau KHÔNG được sửa expected của chúng (chỉ được thêm case mới). Full suite unit + e2e cũ phải xanh y như baseline Task 0.
- **Môi trường:** làm trên nhánh `feat/g2-exchange` ở worktree `D:/Lwcifer/LW/FWBB-g2`. Không tạo, copy hay sửa file `.env*`. Env truyền qua shell cho từng lệnh. KHÔNG BAO GIỜ chạy G2 với `TURSO_DATABASE_URL` trỏ Turso PROD; trước mỗi lần chạy app/script DB, xác nhận URL bắt đầu bằng `file:`. `scripts/apply-migration.mjs` luôn gọi kèm `--env=<file không tên .env* chỉ chứa TURSO_DATABASE_URL=file:e2e/local.db>` (thiếu `--env` là nó đọc `.env.local` = PROD).
- **Deploy:** user đồng ý (3/11) deploy G2a ngay khi xong nếu an toàn. Điều kiện: đủ 4 cổng + full e2e xanh, review cả nhánh sạch, cờ vẫn tắt, sao lưu DB prod (`scripts/backup-local.mjs`) trước khi áp migration 0027. Push `main` là tự deploy prod, nên trước đó KHÔNG push `main`, KHÔNG áp migration prod.
- Migration chỉ DDL, chỉ thêm (`ADD COLUMN`). Enum giữ ở TypeScript (không CHECK) để drizzle-kit không sinh recreate-table. Sau migration kiểm `sqlite_master` so với mốc ở Task 0.
- Không đụng code tiền (ledger, cost-calculator, finalize, fund). Tài khoản giao lưu không vào fund roster (Task 3 có test khoá lại).
- Env mới, chỉ đọc lúc dùng, không log giá trị: server `ZALO_APP_SECRET`, `ZALO_REDIRECT_URI` (đúng chuỗi URL đã khai trong app Zalo), `TURNSTILE_SECRET_KEY`; công khai (nhúng lúc build, phải có trước `pnpm build`) `NEXT_PUBLIC_ZALO_APP_ID` (= `1049980137651781495`), `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Đã có sẵn: `NEXT_PUBLIC_APP_URL`, `USER_COOKIE_SECRET`. Thiếu biến khi cờ bật thì trả lỗi `config` có thông báo, log tên biến; không fallback âm thầm.
- Không log access token, code, state, uid Zalo, tên hay hồ sơ. Log kiểu đang có: `console.error("[ZaloAuth] <mã lỗi>", { memberId })`.
- **Thứ tự kiểm ở mọi điểm vào của luồng giao lưu:** cờ → Origin (route handler POST tự kiểm vì lớp CSRF của Next chỉ áp cho server action) → env → Turnstile → rate limit (rate limit ghi DB nên phải sau Turnstile). Ngoại lệ có chủ đích: đọc cờ (1 lần đọc settings) đứng đầu để cờ tắt trả 404 sạch.
- Không fail-closed thì không an toàn: Turnstile không gọi được Cloudflare → từ chối. `exchangeZaloCode`, `fetchZaloProfile`, `verifyTurnstile` không bao giờ ném lỗi; mỗi lệnh fetch có `AbortSignal.timeout(5000)`.
- Rate limit theo IP chỉ lưu khoá đã băm: `hashedIpKey(ip)` (Task 6). Không lưu IP thô (spec 4.6e).
- Cookie state Zalo: `ZALO_STATE_COOKIE_OPTS = { httpOnly: true, sameSite: "lax", secure: NODE_ENV === "production", path: "/api/auth/zalo" }`, đặt kèm `maxAge: 600`, xoá bằng đúng path đó (`cookieStore.delete({ name, path })` hoặc `set("", { ...opts, maxAge: 0 })`), không bao giờ `delete(name)` trần (Next tự điền `Path=/` nên không xoá được).
- `next` luôn đi qua `safeNextPath` (Task 6) ở MỌI chỗ redirect hay điều hướng, không chỉ lúc lưu.
- Chuỗi giao diện đủ `vi`/`en`/`zh` (`src/i18n/locale-parity.test.ts` xanh). Mobile-first: vùng chạm ≥ 44px, chữ ≥ 16px, nút chính dính đáy, skeleton, màu từ CSS variables. Thao tác ghi có optimistic qua `fireAction` khi không phụ thuộc phản hồi server.
- Commit: Conventional Commits 1 dòng, không body, không trailer. Đề xuất message, chờ user xác nhận trước khi commit (trừ khi user đã cho phép commit theo plan).

## Review Focus

1. **Uid Zalo trùng số với `facebook_id` của một member cũ:** đăng nhập Zalo KHÔNG được khớp vào member đó. Test ở Task 2 và Task 7.
2. **Callback gọi lại 2 lần với cùng cookie + state (replay, bấm Back, mở lại link):** lần 2 về `?error=state`, Zalo chỉ bị gọi 1 lần, không tạo member thứ hai. Thiếu cookie (cookie jar khác, như trình duyệt trong Zalo) cũng về `?error=state`, không trắng trang. Test ở Task 8 trên DB test thật.
3. **Tài khoản giao lưu mở URL nhóm (`/`, `/history`, `/vote/1`, `/my-fund`, `/me`):** không thấy dữ liệu nhóm, thấy màn "tài khoản giao lưu" có đường về `/giao-luu`. Test ở Task 10 và Task 13.
4. **Cờ tắt:** `/giao-luu`, `/giao-luu/dang-nhap`, `/api/auth/zalo/start`, `/api/auth/zalo/callback` trả HTTP 404 thật (không phải 200 kèm trang lỗi vì đã stream `loading.tsx`); `googleLogin` bỏ qua `intent: "exchange"`; người chờ duyệt vẫn thấy `PendingApprovalGate` ở mọi nơi như hôm nay. Test ở Task 4, 8, 9, 10, 11, 13.
5. **Admin không bị người lạ làm phiền:** tài khoản `exchange` không vào hàng chờ, không cộng vào số trên sidebar, không vào danh sách member chính, không được gợi ý gộp. Bấm "Xin vào nhóm" thì mới vào hàng chờ; admin "Không nhận vào nhóm" thì họ quay về tài khoản giao lưu, không bị cấm. Test ở Task 11 và Task 12.

---

### Task 0: Chuẩn bị worktree và đo baseline

**Files:** không sửa code. Tạo `.superpowers/g2a/` trong worktree (đã bị loại khỏi git qua `.git/info/exclude` của repo chính; kiểm lại bằng `git check-ignore`).

- [ ] **Step 1:** `pnpm install --frozen-lockfile` trong `D:/Lwcifer/LW/FWBB-g2`. Expected: exit 0, có `node_modules/next/dist/docs/`.
- [ ] **Step 2:** Lấy DB test: copy `D:/Lwcifer/LW/FWBB/e2e/local.db` sang `FWBB-g2/e2e/local.db` khi không có server nào đang mở file, xoá `-wal`/`-shm` cũ ở đích trước khi copy, rồi `PRAGMA quick_check` qua libsql → `ok`. KHÔNG chạy `db:clone-local` (script đó đọc Turso PROD).
- [ ] **Step 3:** Tạo `.superpowers/g2a/local-db.env` chỉ có `TURSO_DATABASE_URL=file:e2e/local.db` và `TURSO_AUTH_TOKEN=`; tạo `.superpowers/g2a/test-env.sh` export secret giả (`USER_COOKIE_SECRET` ≥ 16 ký tự, `JWT_SECRET` ≥ 32), `TURSO_DATABASE_URL=file:e2e/local.db`, `TURSO_AUTH_TOKEN=`, khoá Turnstile test (`NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`, `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`), `NEXT_PUBLIC_ZALO_APP_ID=1049980137651781495`, `ZALO_APP_SECRET=test-not-real`, `ZALO_REDIRECT_URI=http://localhost:3101/api/auth/zalo/callback`, `NEXT_PUBLIC_APP_URL=http://localhost:3101`. Admin e2e: dùng `ADMIN_USERNAME`/`ADMIN_PASSWORD` từ shell nếu user cung cấp; nếu không, chỉ trên bản sao DB này đặt `password_hash` của admin thành bcrypt của mật khẩu test và export cặp đó.
- [ ] **Step 4:** Ghi mốc: danh sách index của `members` trong `sqlite_master` của bản sao → `.superpowers/g2a/members-indexes-before.txt`.
- [ ] **Step 5:** Baseline trên base sạch, mỗi lệnh ghi exit riêng (`cmd > log 2>&1; echo "x_exit=$?"`): `npx tsc --noEmit -p tsconfig.json`, `npx eslint src`, `npx vitest run`, `pnpm build`, `npx playwright test`. Test nào đỏ sẵn thì ghi vào ledger là lỗi có sẵn của base.
- [ ] **Step 6:** Không commit (không có thay đổi code).

### Task 1: Test giữ nguyên hành vi (characterization) cho layout và đăng nhập

Mọi test ở task này phải XANH ngay khi viết (ngoại lệ có chủ đích của TDD: mô tả hành vi đang có). Test nào đỏ thì dừng lại, đó là hiểu sai về code hiện tại.

**Files:**
- Create: `src/test-utils/resolve-server-tree.ts`
- Create: `src/app/(public)/layout-gates.integration.test.tsx`
- Create: `src/actions/login-flows.characterization.integration.test.ts`

**Interfaces:**
- Produces: `resolveServerTree(node: React.ReactNode): Promise<React.ReactNode>` đệ quy qua `props.children` và mảng con; gặp element có `type` là hàm async (`type.constructor.name === "AsyncFunction"`) thì `await type(props)` rồi duyệt tiếp; element client đồng bộ (Header, PendingApprovalGate, ForceChangePasswordGate) thì giữ nguyên, không gọi. `findByType(tree, Component)` chạy trên cây đã resolve. Nhờ vậy test vẫn chạy đúng sau khi Task 10 bọc logic vào `MemberShell`.

- [ ] **Step 1: Test layout.** Mock `@/lib/user-identity`, `next-intl/server`, `@/db` bằng `createTestDb`, và `@/actions/settings` bằng `vi.mock(path, async (orig) => ({ ...(await orig()), getAppName: vi.fn(async () => "FWBB") }))` (giữ thật các hàm settings khác để sau này cờ đọc từ DB test). Render `PublicLayout({ children: <p>CHILD</p> })`, resolve, rồi kiểm:
  - `layout: khách → có CHILD, Header showLogin`
  - `layout: approved → có CHILD, Header showMenu`
  - `layout: pending → PendingApprovalGate, không có CHILD`
  - `layout: rejected / isActive=false / member không tồn tại → màn khoá, không có CHILD`
  - `layout: approved + mustChangePassword → ForceChangePasswordGate, không có CHILD`
- [ ] **Step 2: Test đăng nhập** (mock `@/lib/google-verify`, `fetch` cho FB, `next/headers`, spy `setUserCookie`):
  - `googleLogin: sub mới → tạo member approvalStatus=pending, có identity google`
  - `googleLogin: sub đã có → dùng lại member, không tạo thêm`
  - `findMemberByOAuth: facebook fallback cột legacy facebook_id vẫn khớp`
  - `findMemberByOAuth: google fallback cột legacy google_id vẫn khớp`
  - `signupWithPassword → member pending, không có identity`
- [ ] **Step 3: Chạy** `npx vitest run "src/app/(public)/layout-gates.integration.test.tsx" src/actions/login-flows.characterization.integration.test.ts`. Expected: PASS hết.
- [ ] **Step 4: Commit** `test(auth): pin current layout gates and login flows before g2a`

### Task 2: Thêm provider `zalo` an toàn + chặn thêm ở các hàm đọc nhóm

**Files:**
- Modify: `src/lib/oauth-identity.ts` (`OAuthProvider`, `findMemberByOAuth`, `oauthLinkState`)
- Modify: `src/db/schema.ts` (enum `provider` của `memberOauthIdentities` thêm `"zalo"`, không sinh SQL)
- Modify: `src/actions/members.ts` (`unlinkOAuthIdentity`: nhánh `else` thành `else if (provider === "facebook")`)
- Modify: `src/app/(public)/me/linked-accounts-section.tsx` (union, `PROVIDER_LABEL`, icon cho `zalo`)
- Modify: `src/actions/stats.ts`, `src/actions/sessions.ts`
- Create: `src/lib/approved-or-admin.ts`
- Test: `src/lib/oauth-identity-zalo.integration.test.ts`, `src/actions/defense-in-depth-gates.integration.test.ts`

**Interfaces:**
- Produces: `type OAuthProvider = "google" | "facebook" | "zalo"`; `requireApprovedOrAdmin(): Promise<{ ok: true } | { error: string }>` (admin JWT hợp lệ HOẶC `requireApprovedMember()` thành công).

- [ ] **Step 1: Test đỏ**
  - `findMemberByOAuth("zalo", uid) KHÔNG khớp member có facebook_id = uid` → `null`
  - `oauthLinkState("zalo", uid, self) = free khi uid trùng facebook_id của member khác`
  - `unlinkOAuthIdentity zalo không xoá members.facebook_id`
  - `getMonthlyExpenses(group, null) khi không phải admin (pending/approved/không cookie) → [], không đọc bảng sessions ; admin → có dữ liệu`
  - `getMonthlyExpenses(group, ownMemberId) của member approved → vẫn có dữ liệu của chính họ` (giữ hành vi `/stats`)
  - `getActiveMembersStats / getAttendanceTrend: pending → [] ; approved → có dữ liệu ; admin → có dữ liệu`
  - `getAdminUpcomingSession không phải admin → không INSERT session, trả giá trị "không có buổi" mà hàm đang dùng (đọc hàm để lấy đúng giá trị)`
- [ ] **Step 2: Chạy, xác nhận đỏ đúng lý do.**
- [ ] **Step 3: Sửa.** Fallback cột legacy chỉ cho `google`/`facebook`; `zalo` không có fallback. Ba hàm stats giữ nguyên kiểu trả về (`[]` khi bị chặn) để admin/stats và (public)/stats không phải sửa. `getAdminUpcomingSession` gọi `requireAdmin`. Xoá export chết `getSessions` (grep lại trước khi xoá).
- [ ] **Step 4: Chạy** 2 file test + `npx drizzle-kit generate`. Expected: PASS; drizzle-kit không sinh thay đổi cho `member_oauth_identities` (nếu sinh thì xoá file đó và ghi Ruling).
- [ ] **Step 5: Commit** `fix(auth): keep zalo identities off legacy facebook columns and gate stats reads`

### Task 3: Cột `signup_intent` + quyền giao lưu

**Files:**
- Modify: `src/db/schema.ts` (`members.signupIntent: text("signup_intent", { enum: ["group", "exchange"] }).notNull().default("group")`)
- Create: `src/db/migrations/0027_*.sql` (drizzle-kit generate; đúng 1 câu `ALTER TABLE members ADD signup_intent text DEFAULT 'group' NOT NULL`)
- Modify: `src/lib/member-auth.ts`
- Create: `src/lib/exchange-account.ts`
- Test: `src/lib/exchange-viewer.integration.test.ts`

**Interfaces:**
- Produces:
  - `getExchangeViewer(): Promise<{ status: "anonymous" } | { status: "blocked" } | { status: "ok"; user; member; isGroupMember: boolean }>`. `blocked` = không tồn tại, `!isActive`, hoặc `rejected`. `isGroupMember` = `approvalStatus === "approved"`.
  - `requireExchangeMember(): Promise<{ user; member } | { error: string }>` cùng điều kiện.
  - `isExchangeAccount(m: { approvalStatus: string; signupIntent: string }): boolean` (= pending + exchange) và `exchangeAccountWhere` / `notExchangeAccountWhere` (điều kiện Drizzle tương ứng) trong `src/lib/exchange-account.ts`. Task 10, 11, 12 dùng chung để không lệch nhau.

- [ ] **Step 1: Test đỏ**
  - `getExchangeViewer: pending exchange → ok, isGroupMember=false`
  - `getExchangeViewer: pending group → ok, isGroupMember=false`
  - `getExchangeViewer: approved → ok, isGroupMember=true`
  - `getExchangeViewer: rejected / locked / không tồn tại → blocked ; không cookie → anonymous`
  - `isExchangeAccount: chỉ đúng với pending + exchange`
  - `fund roster không gồm member pending exchange` (gọi hàm roster trong `src/lib/fund-calculator.ts` mà test hiện có đang dùng)
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Sửa schema, sinh migration, viết hàm.** Áp lên bản sao: `node scripts/apply-migration.mjs --env=.superpowers/g2a/local-db.env` (kiểm dòng "Loaded env from" đúng file đó), rồi so `sqlite_master` của `members` với mốc Task 0.
- [ ] **Step 4: Chạy test** → PASS.
- [ ] **Step 5: Commit** `feat(members): add signup_intent and exchange viewer gate`

### Task 4: Cờ `exchangeEnabled`

**Files:**
- Modify: `src/lib/settings-registry.ts` (nhóm "Vận hành": `exchangeEnabled: def({ key: "exchangeEnabled", schema: z.boolean(), default: false, perSession: false, revalidate: ["/giao-luu", "/san", "/", "/admin/members", "/admin/settings"] })`)
- Modify: `src/app/(admin)/admin/settings/section-operations.tsx` (công tắc + mô tả ngắn, theo kiểu `autoCreateSessions`; mô tả nhắc phải đặt biến Zalo/Turnstile trên Vercel trước khi bật)
- Create: `src/lib/exchange-flag.ts`
- Modify: i18n 3 file (nhãn + mô tả công tắc)
- Test: `src/lib/exchange-flag.integration.test.ts`, mở rộng `src/lib/settings-registry.test.ts` và test của section settings nếu có test snapshot danh sách key

**Interfaces:**
- Produces: `isExchangeEnabled(): Promise<boolean>` (đọc qua cùng đường đọc settings đang có, không thêm cache riêng).

- [ ] **Step 1: Test đỏ:** `exchangeEnabled mặc định false` ; `isExchangeEnabled() phản ánh giá trị đã lưu` ; `lưu cả trang settings khi không đụng công tắc thì exchangeEnabled giữ nguyên` (thanh lưu chung gửi đủ key).
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Sửa.**
- [ ] **Step 4: Chạy** các file test + `npx vitest run "src/app/(admin)/admin/settings"` → PASS.
- [ ] **Step 5: Commit** `feat(settings): add exchange feature flag, off by default`

### Task 5: Turnstile

**Files:**
- Create: `src/lib/turnstile.ts`, `src/components/security/turnstile-widget.tsx`
- Test: `src/lib/turnstile.test.ts`, `src/components/security/turnstile-widget.test.tsx`

**Interfaces:**
- Produces:
  - `verifyTurnstile(token: string | null | undefined, opts: { action: string; remoteIp?: string; expectedHostname?: string }, fetchImpl?: typeof fetch): Promise<{ ok: true } | { ok: false; reason: "missing" | "invalid" | "unavailable" | "misconfigured" }>`. Không bao giờ ném lỗi.
  - `<TurnstileWidget action={string} onToken={(t: string | null) => void} resetKey={number} />` (client; nạp script explicit render 1 lần; đổi `resetKey` thì `turnstile.reset(widgetId)` và `onToken(null)`; hết hạn/lỗi thì `onToken(null)`).
- Hằng số: `SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"`, token tối đa 2048 ký tự, timeout 5 giây. Khoá test của Cloudflare (`1x0000000000000000000000000000000AA` và các bản 2x/3x) thì bỏ qua so `action`/`hostname` vì Cloudflare trả giá trị giả.

- [ ] **Step 1: Test đỏ** (`fetchImpl` giả):
  - `token rỗng → missing, không gọi fetch` ; `token > 2048 ký tự → invalid, không gọi fetch`
  - `success=true, action và hostname khớp → ok`
  - `success=true nhưng action khác → invalid` ; `hostname khác expectedHostname → invalid`
  - `success=false (timeout-or-duplicate) → invalid`
  - `fetch ném lỗi / quá 5s / HTTP 500 / body không phải JSON → unavailable`
  - `thiếu TURNSTILE_SECRET_KEY → misconfigured, không gọi fetch`
  - `secret là khoá test → bỏ qua so action/hostname`
  - widget: `onToken nhận token khi script gọi callback` ; `đổi resetKey → gọi turnstile.reset và onToken(null)` (mock `window.turnstile`)
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Viết.** Gửi `secret`, `response`, `remoteip` (chỉ khi IP khác `"unknown"`) dạng form. Không đưa mã lỗi Cloudflare ra người dùng. `next.config.ts` chưa có CSP (dòng 48), nên không sửa header; ghi comment để ai thêm CSP sau cho phép `challenges.cloudflare.com` ở `script-src` và `frame-src`.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(security): add turnstile verification and widget`

### Task 6: Thư viện OAuth Zalo, cookie state, `next` an toàn, khoá IP đã băm

**Files:**
- Create: `src/lib/zalo-oauth.ts`, `src/lib/zalo-oauth-state.ts`, `src/lib/safe-next-path.ts`
- Modify: `src/lib/client-ip.ts` (chuyển `ipRateLimitKey` từ `src/actions/venues.ts` sang đây, thêm `hashedIpKey`), `src/actions/venues.ts` (import từ lib, hành vi không đổi)
- Test: `src/lib/zalo-oauth.test.ts`, `src/lib/zalo-oauth-state.test.ts`, `src/lib/safe-next-path.test.ts`, `src/lib/client-ip.test.ts`

**Interfaces:**
- `zalo-oauth.ts` (không hàm nào ném lỗi; mọi fetch có `AbortSignal.timeout(5000)`):
  - `pkceChallenge(verifier: string): string` = base64url không padding của SHA-256(verifier).
  - `createPkcePair(): { verifier: string; challenge: string }`: verifier 43 ký tự `[A-Za-z0-9]`.
  - `buildZaloAuthorizeUrl(p: { appId: string; redirectUri: string; challenge: string; state: string }): string` → `https://oauth.zaloapp.com/v4/permission?app_id=…&redirect_uri=…&code_challenge=…&state=…`
  - `exchangeZaloCode(p: { appId: string; secret: string; code: string; verifier: string }, fetchImpl?): Promise<{ accessToken: string } | { error: "exchange" }>`: POST `https://oauth.zaloapp.com/v4/access_token`, header `secret_key`, body form `code, app_id, grant_type=authorization_code, code_verifier`. Không dựa vào `expires_in` (có thể là chuỗi).
  - `fetchZaloProfile(accessToken: string, fetchImpl?): Promise<{ uid: string; name: string; pictureUrl: string | null } | { error: "profile" | "region" }>`: GET `https://graph.zalo.me/v2.0/me?fields=id,name,picture`, header `access_token`. Mã lỗi `-501` → `region`. `uid` luôn là chuỗi; `pictureUrl` chỉ nhận `https:`.
- `zalo-oauth-state.ts`:
  - `type ZaloOAuthState = { state: string; verifier: string; intent: "exchange"; next: string; iat: number }`
  - `sealZaloState(s): string` / `openZaloState(raw: string | undefined, now?: number): ZaloOAuthState | null`: HMAC-SHA256 với `USER_COOKIE_SECRET`, tiền tố miền `"zalo-oauth:"`, so chữ ký bằng `timingSafeEqual` sau khi so độ dài (theo `safeEqualHex` trong `src/lib/user-identity.ts`). Hết hạn sau 600 giây.
  - `statesMatch(a: string, b: string): boolean` so thời gian hằng.
  - `ZALO_STATE_COOKIE = "fwbb-zalo-oauth"`, `ZALO_STATE_COOKIE_OPTS` như Global Constraints.
- `safe-next-path.ts`: `safeNextPath(raw: unknown): string`: không phải chuỗi, không bắt đầu bằng `/`, chứa ký tự `[\x00-\x1F\x7F]` hoặc `\` → `"/giao-luu"`. Ngược lại `new URL(raw, "https://x.invalid")`, origin phải đúng `https://x.invalid`, trả `pathname + search + hash`.
- `client-ip.ts`: `ipRateLimitKey(ip: string): string` (IPv6 gom theo /64, như bản ở venues.ts) và `hashedIpKey(ip: string): string` = 32 ký tự hex đầu của HMAC-SHA256(`USER_COOKIE_SECRET`, `"rl-ip:v1:" + ipRateLimitKey(ip)`).

- [ ] **Step 1: Test đỏ**
  - PKCE: `pkceChallenge khớp vector RFC 7636` (verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`) ; `verifier dài 43, chỉ chữ và số`.
  - URL: `buildZaloAuthorizeUrl encode redirect_uri và đủ 4 tham số`.
  - Exchange: `gửi header secret_key và body đúng` ; `HTTP lỗi / JSON có error / thiếu access_token / fetch ném lỗi / quá 5s / body không phải JSON → { error: "exchange" }`.
  - Profile: `uid là chuỗi kể cả khi id là số` ; `-501 → region` ; `lỗi khác, fetch ném, quá 5s, body hỏng → profile` ; `name rỗng → "Zalo user"` ; `picture không phải https → null`.
  - State: `seal rồi open ra đúng object` ; `sửa 1 ký tự → null` ; `quá 600 giây → null` ; `chữ ký cookie fwbb-user không mở được ở đây` ; `statesMatch độ dài khác → false`.
  - `safeNextPath`: `"/giao-luu/abc?x=1" giữ` ; `"//evil.com"`, `"/\\evil.com"`, `"/\t/evil.com"`, `"/\n/evil.com"`, `"https://evil.com"`, `"javascript:alert(1)"`, `""`, `null`, `123` → `"/giao-luu"` ; `"/%09/evil.com"` giữ nguyên dạng đã encode (cùng origin).
  - `ipRateLimitKey`: IPv4 giữ ; 2 IPv6 cùng /64 → cùng khoá ; `"::1"` không lỗi. `hashedIpKey`: 32 ký tự hex, không chứa IP gốc, ổn định.
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Viết.** Ruling sẵn: tài liệu Zalo ghi "Base64"; dùng base64url không padding. Thử thật bị từ chối thì chỉ đổi `pkceChallenge`, ghi Ruling. Chạy lại test venues (`npx vitest run src/actions/venues`) sau khi chuyển `ipRateLimitKey`.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(auth): add zalo oauth, signed state and hashed ip helpers`

### Task 7: Đăng nhập Zalo: tìm hoặc tạo member

**Files:**
- Create: `src/lib/zalo-login.ts`
- Test: `src/lib/zalo-login.integration.test.ts`

**Interfaces:**
- Consumes: `findMemberByOAuth` (chỉ dùng NGOÀI transaction), `members.signupIntent` (Task 3). KHÔNG gọi `ensureOAuthIdentity` (nó ghi qua `db` toàn cục, không theo transaction).
- Produces: `loginOrCreateZaloMember(p: { uid: string; name: string; pictureUrl: string | null; intent: "exchange" }): Promise<{ memberId: number; created: boolean } | { error: "blocked" }>`. Không đặt cookie.
- Cách chạy: cả tìm lẫn tạo nằm trong `db.transaction(async (tx) => …)`, mọi truy vấn dùng `tx` (libsql mở transaction ghi ngay từ đầu nên 2 lần gọi song song chạy lần lượt). (1) `tx.query.memberOauthIdentities.findFirst` theo `provider = "zalo" AND providerUid = uid`, không fallback cột legacy. (2) Có thì nạp member bằng `tx`; khoá/từ chối → `{ error: "blocked" }`, không ghi gì; còn lại chỉ cập nhật tên + ảnh, `created: false`. (3) Không có thì `tx.insert(members)` (`approvalStatus: "pending"`, `signupIntent: intent`) rồi `tx.insert(memberOauthIdentities)` không kiểm trước. Ngoài transaction chỉ bắt lỗi UNIQUE của `member_oauth_identities`: đọc lại bằng `findMemberByOAuth("zalo", uid)`, kiểm blocked như trên, trả member đó. Lỗi khác ném tiếp.

- [ ] **Step 1: Test đỏ** (DB test thật qua `createTestDb`, `@/db` mock tới instance đó)
  - `uid mới → member pending, signup_intent=exchange, identity zalo`
  - `uid đã có → dùng lại, cập nhật tên/ảnh, KHÔNG đổi signup_intent hay approvalStatus` (member nhóm đăng nhập từ trang giao lưu vẫn là member nhóm)
  - `member bị khoá / bị từ chối → { error: "blocked" }, không sửa gì`
  - `uid trùng facebook_id của member khác → tạo member MỚI, không đụng member kia`
  - `2 lần gọi song song cùng uid → đúng 1 member, đúng 1 identity`
  - `insert identity ném lỗi → bảng members không có dòng mới`
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Viết.**
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(auth): create or reuse members from zalo logins`

### Task 8: Route handler `start` và `callback`

**Files:**
- Create: `src/app/api/auth/zalo/start/route.ts` (POST), `src/app/api/auth/zalo/callback/route.ts` (GET), `src/lib/same-origin.ts`
- Test: `src/app/api/auth/zalo/zalo-routes.integration.test.ts`, `src/lib/same-origin.test.ts`

**Interfaces:**
- Consumes: Task 4, 5, 6, 7, `setUserCookie(memberId, externalId)`, `checkRateLimit`, `getTrustedClientIp`, `rateLimitBuckets`.
- `isSameOriginRequest(req: Request, appOrigin: string): boolean`: có `Origin` thì phải bằng `appOrigin` (`"null"` là sai); không có `Origin` mà có `Sec-Fetch-Site` khác `same-origin` → sai; không có cả hai → cho qua (Turnstile chặn phía sau).
- Mọi lỗi trả 303 về `/giao-luu/dang-nhap?error=<mã>&next=<safeNextPath>`; mã: `origin, config, captcha, rate, state, denied, exchange, profile, region, blocked, server`.
- **`start`** nhận form `cf-turnstile-response`, `next`. Luôn tạo tài khoản `exchange` (không nhận `intent` từ client: người lạ không được tự vào hàng chờ nhóm). Thứ tự: cờ tắt → 404 → `isSameOriginRequest(request, request.nextUrl.origin)` sai → `origin` → thiếu `NEXT_PUBLIC_ZALO_APP_ID`/`ZALO_APP_SECRET`/`ZALO_REDIRECT_URI`/`TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_APP_URL` (hoặc không parse được URL) → `config` → `verifyTurnstile(action "zalo_login", remoteIp, expectedHostname = hostname của NEXT_PUBLIC_APP_URL)` không ok → `captcha` → `checkRateLimit("zalo-start:" + hashedIpKey(ip), 10, 5 phút)` → `rate` → đặt cookie state (`ZALO_STATE_COOKIE_OPTS`, `maxAge: 600`) → 303 tới Zalo với `redirect_uri = ZALO_REDIRECT_URI`.
- **`callback`** nhận `code`, `state` (và `error` nếu Zalo gửi). Thứ tự: cờ tắt → 404 → LUÔN gắn lệnh xoá cookie state (đúng path) vào response trả về → `openZaloState` null hoặc `!statesMatch` → `state` → **giành state một lần**: `db.insert(rateLimitBuckets).values({ key: "zalo-state:" + sha256hex(state), count: 1, resetAt: st.iat * 1000 + 600_000 }).onConflictDoNothing().returning(...)`, không có dòng trả về → `state` (Ruling: được ghi DB trước Turnstile vì cookie HMAC hợp lệ chứng minh Turnstile đã qua ở `start`) → `checkRateLimit("zalo-callback:" + hashedIpKey(ip), 10, 5 phút)` → `rate` → không có `code` hoặc có `error` → `denied` → phần còn lại trong try/catch: `exchangeZaloCode` lỗi → `exchange`; profile `region`/lỗi → `region`/`profile`; `loginOrCreateZaloMember` blocked → `blocked`; ném lỗi bất kỳ → `server` (log `"[ZaloAuth] server"`, không kèm error object); thành công → `setUserCookie(memberId, "zalo:" + uid)` rồi 303 tới `safeNextPath(st.next)`.

- [ ] **Step 1: Test đỏ** (gọi trực tiếp `POST(request)` / `GET(request)` với `NextRequest` thật; mock `next/headers` cookies bằng đối tượng ghi lại tham số từng lệnh `set`/`delete`; mock `fetch` toàn cục cho Cloudflare và Zalo; DB test thật):
  - `cờ tắt → start 404, callback 404`
  - `same-origin: Origin lạ / "null" → false ; không Origin + Sec-Fetch-Site cross-site → false ; Origin đúng → true ; không có header nào → true`
  - `start: Origin https://evil.com → error=origin, không gọi fetch, không đặt cookie, rate_limit_buckets rỗng`
  - `start: thiếu ZALO_REDIRECT_URI (hoặc biến khác trong danh sách) → error=config, không đặt cookie`
  - `start: thiếu token Turnstile → error=captcha, rate_limit_buckets rỗng`
  - `start: hợp lệ → 303 tới oauth.zaloapp.com/v4/permission với redirect_uri đúng bằng ZALO_REDIRECT_URI ; cookie fwbb-zalo-oauth có sameSite=lax, httpOnly, path=/api/auth/zalo, maxAge=600`
  - `start: khoá rate limit trong DB là hash, không chứa chuỗi IP 203.0.113.7`
  - `start: next=//evil.com → state lưu next=/giao-luu`
  - `callback: không cookie → error=state, không gọi Zalo`
  - `callback: state lệch → error=state, rate_limit_buckets không có dòng zalo-state`
  - `callback: gọi 2 lần cùng cookie + state → lần 2 error=state, fetch Zalo chỉ bị gọi 1 lần (cho exchange), chỉ 1 member`
  - `callback: không có code hoặc có error=access_denied → error=denied`
  - `callback: fetch Zalo ném lỗi → error=exchange, không 500`
  - `callback: Zalo -501 → error=region`
  - `callback: loginOrCreateZaloMember ném lỗi → error=server, không gọi setUserCookie`
  - `callback: member bị khoá → error=blocked, không gọi setUserCookie`
  - `callback: thành công → setUserCookie("zalo:<uid>"), 303 tới next ; mọi nhánh (lỗi lẫn thành công) đều có lệnh xoá cookie state với path=/api/auth/zalo`
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Viết.** Không render lỗi thô của Zalo.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(auth): add zalo oauth start and callback routes`

### Task 9: Google từ trang giao lưu

**Files:**
- Modify: `src/actions/google-auth.ts` (`googleLogin(idToken, opts?)`)
- Test: mở rộng `src/actions/login-flows.characterization.integration.test.ts` (chỉ THÊM case)

**Interfaces:**
- Produces: `googleLogin(idToken: string, opts?: { intent?: "exchange"; turnstileToken?: string })`. Không truyền `opts` thì y như cũ.

- [ ] **Step 1: Test đỏ**
  - `intent exchange + cờ bật + Turnstile ok + sub mới → member signup_intent=exchange`
  - `intent exchange + Turnstile hỏng → { error }, không tạo member, không gọi verify Google, không ghi rate_limit_buckets`
  - `intent exchange + cờ tắt → bỏ qua intent, tạo member group như cũ, không đòi Turnstile`
  - `intent exchange + sub đã có → không đổi signup_intent`
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Sửa.** Thứ tự khi `intent = exchange` và cờ bật: Turnstile (`action "google_login"`, `expectedHostname` như Task 8) → rate limit đang có → verify token Google. Thêm `revalidatePath("/giao-luu")`.
- [ ] **Step 4: Chạy** file test → PASS (case cũ không sửa).
- [ ] **Step 5: Commit** `feat(auth): let google sign-ins start exchange accounts`

### Task 10: Khung layout dùng chung, route group `(exchange)`, chuyển `/san`

**Files:**
- Create: `src/components/layout/member-shell.tsx` (server component, chứa toàn bộ logic layout `(public)` hiện tại)
- Modify: `src/app/(public)/layout.tsx` (chỉ còn `<MemberShell mode="group">{children}</MemberShell>`)
- Create: `src/app/(exchange)/layout.tsx` (`<MemberShell mode="exchange">`, KHÔNG kiểm cờ ở đây vì `/san` phải chạy khi cờ tắt)
- Move: `src/app/(public)/san/**` → `src/app/(exchange)/san/**` bằng `git mv` (URL không đổi). Sửa import tương đối `../...` thành `@/...` nếu có.
- Create: `src/app/(public)/exchange-account-notice.tsx` (tên, nút "Về trang giao lưu", nút đăng xuất; chưa có nút xin vào nhóm, Task 11 thêm)
- Modify: `src/components/layout/header.tsx` (thêm `loginHref?: string` mặc định `"/login"`, `homeHref?: string` mặc định `"/"`; khi `loginHref` khác mặc định thì tự gắn `?next=<pathname>` và ẩn nút đăng nhập nếu đang ở chính trang đó)
- Modify: `src/components/layout/nav-drawer.tsx` (prop `navItems?: "group" | "exchange"`; `exchange` chỉ có Giao lưu `/giao-luu`, Sân `/san`, không có nút Hướng dẫn. Ý định mở tour lưu thêm vào `sessionStorage["fwbb:tourPending"]` (đọc/ghi trong try/catch) để sống qua lần đổi layout `/san` ↔ `/`; effect ở trang chủ đọc và xoá cờ đó rồi chạy tour sau 800 ms như cũ)
- Test: thêm case vào `src/app/(public)/layout-gates.integration.test.tsx`, tạo `src/app/(exchange)/exchange-layout.integration.test.tsx`, thêm case vào `e2e/product-tour.spec.ts`

**Interfaces:**
- Produces: `MemberShell({ mode, children }: { mode: "group" | "exchange"; children: React.ReactNode })`. Chỉ gọi `isExchangeEnabled()` khi cần (khách ở mode exchange, hoặc member pending) để member approved không tốn thêm lần đọc settings.
- Thứ tự kiểm: (1) khoá/từ chối/không tồn tại → màn khoá. (2) pending và (cờ tắt hoặc (intent `group` và mode `group`)) → PendingApprovalGate. (3) `mustChangePassword` → ForceChangePasswordGate. (4) pending, cờ bật: mode `group` + intent `exchange` → `ExchangeAccountNotice`; mode `exchange` → children + Header `navItems="exchange"` `homeHref="/giao-luu"`. (5) approved → như hiện tại.
- Bảng hành vi (mỗi ô một test):

| Người xem | mode `group` | mode `exchange` |
|---|---|---|
| Khách | như hiện tại | cờ tắt: như hiện tại; cờ bật: Header `loginHref="/giao-luu/dang-nhap"` |
| Bị khoá / từ chối / không tồn tại | màn khoá | màn khoá |
| approved + `mustChangePassword` | ForceChangePasswordGate | ForceChangePasswordGate |
| pending (bất kỳ intent), cờ tắt | PendingApprovalGate | PendingApprovalGate |
| pending group, cờ bật | PendingApprovalGate | children + nav exchange |
| pending exchange, cờ bật | `ExchangeAccountNotice` | children + nav exchange |
| pending exchange + `mustChangePassword`, cờ bật | ForceChangePasswordGate | ForceChangePasswordGate |
| approved | như hiện tại | như hiện tại |

- [ ] **Step 1: Test đỏ** cho mọi ô mới của bảng. Thêm e2e đỏ trong `product-tour.spec.ts`: `từ /san mở menu, bấm Hướng dẫn → về / và thấy bước tour đầu tiên`.
- [ ] **Step 2: Chạy → ô mới đỏ, test Task 1 vẫn xanh.**
- [ ] **Step 3: Sửa.** Task 1 phải xanh mà KHÔNG sửa file test Task 1. Trang `/history`, `/stats`, `/vote/[id]` đã trả `null` cho người không `approved` (commit `4cb8a19`), không cần sửa.
- [ ] **Step 4: Chạy** test layout + Task 1 + `npx vitest run src/app src/components/layout` + build lại (`pnpm build`, xem memory "e2e build cũ") + `npx playwright test e2e/venue-directory.spec.ts e2e/product-tour.spec.ts e2e/public.spec.ts` → PASS. Kiểm thêm bằng tay qua Playwright: member approved đi `/` → Sân → Trang chủ, menu và mục đang chọn vẫn đúng.
- [ ] **Step 5: Commit** `refactor(layout): share member shell and add exchange route group`

### Task 11: Trang `/giao-luu`, `/giao-luu/dang-nhap`, "Xin vào nhóm"

**Files:**
- Create: `src/app/(exchange)/giao-luu/layout.tsx` (server: `if (!(await isExchangeEnabled())) notFound(); return children;`; đặt trên `loading.tsx` để cờ tắt trả HTTP 404 thật)
- Create: `src/app/(exchange)/giao-luu/page.tsx`, `loading.tsx`, `join-group-button.tsx` (client, dùng chung)
- Create: `src/app/(exchange)/giao-luu/dang-nhap/page.tsx`, `exchange-login-form.tsx` (client)
- Modify: `src/app/(public)/exchange-account-notice.tsx` (thêm `JoinGroupButton`)
- Modify: `src/actions/member-approval.ts` (thêm `requestGroupMembership`)
- Test: `src/actions/request-group-membership.integration.test.ts`, `src/app/(exchange)/giao-luu/dang-nhap/exchange-login-form.test.tsx`, `src/app/(exchange)/giao-luu/join-group-button.test.tsx`

**Interfaces:**
- Produces: `requestGroupMembership(): Promise<{ success: true } | { error: string }>`: chỉ cho `isActive` + `pending`; `exchange` → đổi thành `group`; đã `group` hoặc `approved` → success, không ghi; `rejected`/khoá/không cookie → error. `revalidatePath("/admin/members")`, `"/giao-luu"`, `"/"`. Cờ tắt → error.
- `/giao-luu`: giới thiệu ngắn, empty state "Buổi giao lưu sắp có" với nút "Xem sân quanh đây" (`/san`). Khách: nút "Đăng nhập để giao lưu" → `/giao-luu/dang-nhap?next=/giao-luu`. Pending exchange: thẻ tài khoản (tên, ảnh, `JoinGroupButton`, đăng xuất qua `pendingLogout`). Pending group: thẻ tài khoản với nhãn cố định "Đã gửi, chờ admin duyệt", không có nút xin, có đăng xuất. Approved: không có thẻ.
- `JoinGroupButton`: optimistic qua `fireAction` (đổi ngay sang "Đã gửi, chờ admin duyệt"; lỗi thì rollback + `toast.error`), rồi `router.refresh()`.
- `/giao-luu/dang-nhap` (đã đăng nhập → redirect `safeNextPath(next)`): `TurnstileWidget`; nút Zalo là `<form method="post" action="/api/auth/zalo/start">` với input ẩn `cf-turnstile-response` và `next`, khoá tới khi có token (chạy được trong trình duyệt của Zalo vì không cần popup). Nút Google: chỉ chép `initGoogleSDK`/`renderGoogleButton` và guard `isIAB` từ `src/app/(public)/facebook-login-gate.tsx` (không mount FacebookLoginGate); callback đọc token qua `useRef` (không qua closure), gọi `googleLogin(idToken, { intent: "exchange", turnstileToken })`, sau mỗi lần gọi (thành công hay lỗi) tăng `resetKey` để lấy token mới; thành công thì điều hướng tới `safeNextPath(next)`. Đọc `?error=` và hiện thông báo đã dịch cho từng mã ở Task 8. Mã `region`: "Đăng nhập Zalo tạm thời không dùng được, hãy dùng Google".

- [ ] **Step 1: Test đỏ**
  - `requestGroupMembership: pending exchange → signup_intent=group`
  - `requestGroupMembership: pending group / approved → success, không đổi ; rejected / khoá / không cookie / cờ tắt → error`
  - `JoinGroupButton: bấm → hiện "Đã gửi" ngay ; action lỗi → quay lại nút + toast`
  - `form: nút Zalo khoá khi chưa có token, mở khi có token, input ẩn chứa token ; next=//evil.com → input next=/giao-luu`
  - `form: sau khi googleLogin trả lỗi → resetKey tăng, nút Zalo khoá lại`
  - `form: ?error=region hiện thông báo dùng Google`
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Viết.** Trang đủ skeleton, chữ ≥ 16px, nút chính dính đáy trên mobile.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(exchange): add exchange hub, login page and join request`

### Task 12: Admin: không để tài khoản giao lưu làm phiền

**Files:**
- Modify: `src/app/(admin)/admin/members/page.tsx`: hàng chờ = pending + `group`; danh sách member chính, truy vấn số dư theo `memberIds` và số đếm "Tất cả" chỉ gồm dòng KHÔNG phải tài khoản giao lưu; thêm mục thu gọn "Tài khoản giao lưu" chỉ đọc (tên, ngày tạo, nhà cung cấp đăng nhập, nút Khoá dùng action khoá đang có). Nạp `member_oauth_identities` (`memberId`, `provider`) cho các id pending và id giao lưu trong 1 truy vấn `inArray`.
- Modify: `src/app/(admin)/admin/layout.tsx` (số trên sidebar = pending + `group`)
- Modify: `src/actions/member-approval.ts`: `getNameMatches`/`getNameMatchesBatch` coi member "do admin tạo" = không `facebookId`, không `googleId` VÀ không có dòng identity nào; thêm `declineGroupRequest(memberId)`.
- Modify: `src/actions/members.ts`: `findDuplicateMembers` bỏ qua tài khoản giao lưu; `mergeMember` từ chối khi nguồn hoặc đích là tài khoản giao lưu.
- Modify: `src/app/(admin)/admin/members/pending-members-section.tsx` (huy hiệu `Z` cho identity zalo; nút "Không nhận vào nhóm" gọi `declineGroupRequest`, optimistic qua `fireAction`; nút "Từ chối" cũ giữ nguyên nghĩa là cấm hẳn)
- Test: `src/app/(admin)/admin/members/pending-queue.integration.test.ts`, mở rộng `src/actions/member-approval.integration.test.ts`, `src/actions/members.integration.test.ts`

**Interfaces:**
- Consumes: `exchangeAccountWhere` / `notExchangeAccountWhere` / `isExchangeAccount` (Task 3).
- Produces: `declineGroupRequest(memberId: number): Promise<{ success: true } | { error: string }>`: `requireAdmin`; chỉ nhận pending + `group` + `isActive`; đặt `signupIntent = "exchange"`, không đụng `approvalStatus`; revalidate `/admin/members`, `/giao-luu`.

- [ ] **Step 1: Test đỏ**
  - `hàng chờ: pending group có, pending exchange không có` ; `số sidebar chỉ đếm pending group`
  - `sau requestGroupMembership: member xuất hiện trong hàng chờ và danh sách chính`
  - `danh sách chính và số Tất cả không gồm tài khoản giao lưu`
  - `findDuplicateMembers bỏ qua tài khoản giao lưu trùng tên member approved`
  - `mergeMember từ chối khi nguồn là tài khoản giao lưu, không chuyển identity`
  - `getNameMatches: member approved chỉ có identity zalo KHÔNG được gợi ý như member do admin tạo ; member approved không có identity nào vẫn được gợi ý`
  - `declineGroupRequest: pending group → exchange, approvalStatus vẫn pending ; không phải admin → error ; approved → error`
- [ ] **Step 2: Chạy → đỏ.**
- [ ] **Step 3: Sửa.**
- [ ] **Step 4: Chạy** → PASS, kèm toàn bộ `src/actions/member-approval*.test.ts` và `src/actions/members*.test.ts`.
- [ ] **Step 5: Commit** `feat(admin): keep exchange accounts out of the approval queue and member list`

### Task 13: i18n, e2e, đủ 4 cổng

**Files:**
- Modify: `src/i18n/messages/{vi,en,zh}.json` (namespace `exchange`, `exchangeLogin` gồm 11 mã lỗi, `exchangeNotice`, nhãn nav, nhãn công tắc admin, "Không nhận vào nhóm")
- Create: `e2e/exchange-accounts.spec.ts`

- [ ] **Step 1: Viết e2e** (bật/tắt cờ bằng cách ghi bảng `app_settings` trong `e2e/local.db` ở `beforeAll`/`afterAll` và khôi phục giá trị cũ; tạo member bằng libsql như fixture `e2e/reset-password.spec.ts`, xoá theo id ở `afterAll`; đăng nhập member bằng form mật khẩu ở `/login`; viewport mobile theo project đang có trong `playwright.config.ts`, không đổi browser):
  - `cờ tắt: /giao-luu, /giao-luu/dang-nhap → status 404 ; POST /api/auth/zalo/start → 404 ; member pending vẫn thấy PendingApprovalGate ở /san`
  - `cờ bật, khách: /giao-luu thấy nút đăng nhập ; nút Đăng nhập trên header ở /san trỏ /giao-luu/dang-nhap?next=/san ; /giao-luu/dang-nhap có widget Turnstile (khoá test) và nút Zalo mở khoá sau khi có token`
  - `cờ bật, tài khoản giao lưu: /giao-luu thấy thẻ tài khoản ; /san xem được ; /, /history, /my-fund thấy màn tài khoản giao lưu, không thấy dữ liệu nhóm`
  - `cờ bật, bấm Xin vào nhóm → reload /giao-luu vẫn mở, thẻ hiện "Đã gửi, chờ admin duyệt" ; / và /history hiện PendingApprovalGate ; admin thấy người này trong hàng chờ ; admin bấm Không nhận vào nhóm → người đó lại là tài khoản giao lưu`
  - `cờ bật, member đã duyệt: /, /history, /san như cũ, menu đủ mục cũ`
  - không cuộn ngang ở `/giao-luu` và `/giao-luu/dang-nhap`
- [ ] **Step 2: Chạy e2e mới → đỏ** ở phần chưa có chuỗi dịch (đã xanh vì Task 11 làm đủ thì ghi lại, không coi là lỗi).
- [ ] **Step 3: Bổ sung chuỗi 3 ngôn ngữ**, sửa tới khi xanh.
- [ ] **Step 4: Đủ 4 cổng + e2e** (env của Task 0, DB là bản sao đã áp 0027), mỗi lệnh ghi exit riêng:
  - `npx tsc --noEmit -p tsconfig.json` → exit 0
  - `npx eslint src` → 0 lỗi
  - `npx vitest run` → xanh hết
  - `pnpm build` → exit 0
  - `npx playwright test` → xanh hết (cả spec cũ; so với baseline Task 0)
- [ ] **Step 5: Commit** `test(e2e): cover exchange accounts behind the feature flag`

### Sau Task 13 (không phải task code)

- Review cả nhánh (người review mới, model mạnh nhất) theo Review Focus; sửa Critical/Important theo TDD.
- Thử Zalo thật ở local (cần user): khai thêm Callback `https://localhost:8888/api/auth/zalo/callback` trong app Zalo. Chạy trong worktree với env shell, DB là bản sao `file:`: `TURSO_DATABASE_URL=file:e2e/local.db TURSO_AUTH_TOKEN= ZALO_REDIRECT_URI=https://localhost:8888/api/auth/zalo/callback NEXT_PUBLIC_APP_URL=https://localhost:8888 NEXT_PUBLIC_ZALO_APP_ID=1049980137651781495 ZALO_APP_SECRET=<user tự nhập vào shell> <khoá Turnstile test> pnpm dev`. Mình không đọc/sửa `.env*` và không nhận secret qua chat. Chốt 2 điều: challenge base64url có được nhận không; hồ sơ trả đủ `id/name/picture` không. Lỗi `-501` chỉ kiểm được trên Vercel. Nếu user chưa sẵn sàng thì bỏ qua bước này: cờ tắt nên deploy vẫn an toàn.
- Deploy: `git fetch` + cập nhật nhánh theo `origin/main` mới nhất, chạy lại 4 cổng + e2e; sao lưu DB prod (`scripts/backup-local.mjs`); áp migration 0027 lên prod (chỉ `ADD COLUMN`, kiểm `sqlite_master`); merge vào `main` và push (tự deploy); kiểm prod bằng Playwright: chức năng cũ như trước, `/giao-luu` trả 404 vì cờ còn tắt. Bật cờ là việc của user sau khi đặt `ZALO_APP_SECRET`, `ZALO_REDIRECT_URI`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_ZALO_APP_ID` trên Vercel (biến `NEXT_PUBLIC_*` cần build lại).
- Cập nhật memory tiến độ.

## Quyết định của mình trong plan này (user soát)

1. `public_code` (mã hồ sơ công khai, spec 4.7) để sang G2b, lúc có trang hồ sơ và buổi. G2a chưa có chỗ nào cần nó.
2. Tài khoản giao lưu chưa có `/me` riêng ở G2a. Thẻ tài khoản (tên, ảnh, xin vào nhóm, đăng xuất) nằm trên `/giao-luu`. `/me` cho tài khoản giao lưu làm ở G2b cùng "Giao lưu của tôi".
3. Member nhóm tự gắn thêm Zalo từ `/me` để sau. G2a chỉ mở rộng phần hiển thị và gỡ liên kết cho `zalo`.
4. Trang `/login` cũ giữ nguyên, không thêm nút Zalo. Nút Zalo chỉ có ở `/giao-luu/dang-nhap`.
5. Turnstile bắt buộc ở MỌI lần bấm đăng nhập Zalo (không chỉ lần đầu), vì ở bước `start` chưa biết người đó là ai. Phần lớn người dùng không phải bấm gì.
6. Thiếu biến môi trường Zalo/Turnstile thì báo lỗi lúc dùng (khi cờ bật), không chặn khởi động app, vì cờ nằm trong DB và prod hiện không có các biến này. Mô tả công tắc ở trang admin nhắc phải đặt biến trước khi bật.
7. `/san` chuyển sang route group `(exchange)` để tài khoản giao lưu xem được. URL không đổi; với khách và member hiện tại, layout render y hệt (Task 10 có test bảng hành vi). Đổi layout khi đi `/` ↔ `/san` làm header dựng lại; tour hướng dẫn được giữ qua `sessionStorage`.
8. Đăng nhập Facebook cho người ngoài để sau. Nút FB đã ẩn toàn app từ 6/7/2026 (`SHOW_FACEBOOK_LOGIN = false`), và FB dùng popup hay hỏng trong trình duyệt của Zalo/Messenger. Khác quyết định 14 của spec; user đã đồng ý ngày 3/11/2026. Khi bật lại FB thì làm theo đúng khuôn Task 9.
9. Người lạ không tự chọn vào hàng chờ nhóm lúc đăng nhập Zalo: `start` luôn tạo tài khoản `exchange`, muốn vào nhóm thì bấm "Xin vào nhóm".
10. Admin có 2 nút cho người xin vào nhóm: "Không nhận vào nhóm" (họ quay về tài khoản giao lưu) và "Từ chối" (cấm hẳn, như hôm nay).
11. Mỗi state Zalo chỉ dùng 1 lần, chặn bằng một dòng `zalo-state:<hash>` trong `rate_limit_buckets` (ghi trước Turnstile vì cookie HMAC hợp lệ đã chứng minh Turnstile qua ở `start`).
