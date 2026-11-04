# Thông báo N1 (chuông + email + nhắc đúng giờ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member và superadmin có chuông thông báo trên site cho mọi việc quanh buổi chơi, tiền và tài khoản (danh mục spec 4.5), cảnh báo ngưỡng sân cho admin, email cho ai đã xác minh email, nhắc đúng giờ qua QStash có cron hằng ngày dự phòng. Toàn bộ nằm sau công tắc `notificationsEnabled` (mặc định tắt).

**Architecture:** Một hàm `notify(dbOrTx, input)` ghi mỗi người nhận 1 dòng `notifications` (có `dedup_key` UNIQUE, `onConflictDoNothing`) bên trong cùng `db.transaction` với hành động nghiệp vụ. Tin lưu `kind` + `payload` (chỉ dữ liệu của người nhận), chữ hiển thị được dựng lúc đọc bằng next-intl theo ngôn ngữ người xem. Chuông đọc qua server action + react-query (không polling). N1b thêm outbox email (`notification_deliveries`, gửi sau phản hồi bằng `after()`), lịch hẹn QStash (`scheduled_jobs`, route kiểm chữ ký, mỗi job đọc lại trạng thái buổi) và một cron Vercel hằng ngày bù việc lỡ.

**Tech Stack:** Next.js 16.2.1 App Router (server actions, route handlers, `after` từ `next/server`), Drizzle + Turso, zod, next-intl 4 (`createTranslator` cho email), @tanstack/react-query 5, nodemailer qua SMTP relay của Brevo, `@upstash/qstash` (N1b), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-notifications-design.md` (user duyệt 4/11/2026).

**Nghiên cứu nền:** bản đồ code 5 vùng (phiên, vote, tiền, tài khoản, giao diện, hạ tầng) đọc ngày 4/11/2026, lưu ở `.superpowers/n1/map-*.md` (gitignored). Số dòng trong plan lấy từ đó, có thể lệch vài dòng: grep tên hàm trước khi sửa. Plan đã qua 1 vòng rà 4 góc có kiểm chéo (43 phát hiện xác nhận, 0 bác, đã gộp vào bản này; danh sách ở `.superpowers/n1/plan-review.md`).

## Global Constraints

- **Nhánh và thứ tự merge:** làm trên `feat/notifications` ở worktree `D:/Lwcifer/LW/FWBB-notify`, đã rebase lên `feat/g2-exchange` (301d835, có migration 0027). N1 dùng migration **0028**. Nhánh này CHỈ được merge vào `main` SAU khi G2a đã lên `main`. Trước khi merge, rebase lên `origin/main` mới nhất và chạy lại đủ cổng.
- Đọc `D:/Lwcifer/LW/FWBB/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` trước khi dùng `after()`, và `.../01-getting-started/15-route-handlers.md` trước khi viết route.
- **An toàn cho chức năng đang chạy:** công tắc `notificationsEnabled` (setting, mặc định `false`). Khi tắt: MỌI helper thông báo (`notify`, `evaluateCapacity`, `notifyFinalized`, `notifyLateDropout`, các `notifySession*`, `checkLowStockAndNotify`, `rescheduleSessionJobs`...) phải trả về NGAY sau 1 lần đọc setting, trước mọi truy vấn khác (không đọc vote, ledger, bảng thông báo). Action gọi nhiều helper thì đọc cờ 1 lần (`const on = await isNotificationsEnabled(tx)`) rồi truyền xuống qua tham số `gate?: boolean`. Chuông không hiện, route jobs/cron trả 200 không làm gì. Mọi test cũ phải xanh y như baseline Task 0 mà không sửa expected.
- **Chạy sau phản hồi:** KHÔNG gọi `after()` trần. Dùng `runAfterResponse(fn)` (Task 3): bọc `after()` trong try/catch, ngoài request scope (test cũ không mock `next/server`, script) thì bỏ qua có chủ đích (cron hằng ngày bù), không bao giờ ném lỗi vào action đã commit tiền. Mọi chỗ hẹn việc sau commit (kho, email, QStash) đi qua helper này và chỉ gọi khi cờ bật.
- **Cổng `finance-invariant-reviewer`:** agent này mặc định đọc repo `D:/Lwcifer/LW/FWBB` (worktree khác). Prompt ở mọi bước gác tiền phải ghi rõ: "Review `git -C D:/Lwcifer/LW/FWBB-notify diff <base-task>..HEAD -- <files>`, đọc file dưới `D:/Lwcifer/LW/FWBB-notify`, bỏ qua đường dẫn mặc định."
- **Ghi tin trong cùng transaction** với nghiệp vụ (spec 4.9). Action nào đang ghi ngoài tx thì bọc phần ghi + `notify` vào `db.transaction`. Không gọi mạng (SMTP, QStash) trong tx; việc đó chạy sau commit qua `after()`.
- **Code tiền:** chỉ THÊM lệnh `notify(tx, …)` sau các lệnh ghi sổ có sẵn, trên nhánh không phải replay/trả sớm. Không đổi số tiền, thứ tự ghi, idempotencyKey, cờ confirm. Số tiền trong tin lấy từ giá trị vừa ghi vào `session_debts` / ledger, không tính lại. Mọi task đụng `src/actions/finance.ts`, `fund.ts`, `sessions.ts` (cancel/reopen/unlock/delete), `payment-matcher.ts`, `court-rent.ts`, `reconcile-fund.ts`, `inventory.ts` phải qua agent `finance-invariant-reviewer` (PASS) trước khi đóng task.
- **Dữ liệu riêng tư:** payload tin cho member chỉ chứa dữ liệu của chính member đó (không tên, không tiền của người khác). Tin cho admin được chứa tên member. Không log PII, không `console.log`; log lỗi kiểu `console.error("[Notify] <mã>", { kind, count })`.
- **Quota Turso:** không thêm `usePolling`, không quét bảng định kỳ ngoài cron hằng ngày; mọi truy vấn mới phải đi theo index khai trong Task 1. Đếm chưa đọc giới hạn `LIMIT 100`.
- **Giờ:** mọi mốc thời gian tính theo giờ VN bằng `+07:00` rõ ràng (server Vercel chạy UTC). Không dùng `formatLocalDeadline`, `computeDefaultDeadline` hay `new Date("YYYY-MM-DDTHH:MM")` không có offset cho việc mới.
- Thời điểm ghi mới (`created_at`, `read_at`, `run_at`, `next_attempt_at`) là ISO UTC có `Z` do app ghi (`new Date().toISOString()`), không dựa vào default `current_timestamp`.
- Migration chỉ DDL, chỉ thêm. Enum ở TypeScript, không CHECK, unique bằng `uniqueIndex` riêng (không `.unique()` inline) để drizzle-kit không sinh recreate-table. Không seed trong migration.
- **Env và DB khi chạy local:** không tạo/sửa file `.env*`. Env test để ở `.superpowers/n1/test-env.sh` (gitignored, copy cách làm của G2a). Mọi lệnh app/script DB phải có `TURSO_DATABASE_URL=file:e2e/local.db`; `scripts/apply-migration.mjs` luôn gọi kèm `--env=.superpowers/n1/local-db.env`.
- Env mới (N1b), chỉ đọc lúc dùng, thiếu thì tính năng tương ứng tắt và admin thấy cảnh báo, không fallback âm thầm: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `QSTASH_URL` (tuỳ vùng, mặc định theo SDK). Email dùng lại `SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM` (Brevo: `smtp-relay.brevo.com`, cổng 587, `SMTP_SECURE=false`). Link tuyệt đối dùng `NEXT_PUBLIC_APP_URL`. Token ký dùng `USER_COOKIE_SECRET` với tiền tố miền riêng.
- Chuỗi giao diện đủ `vi`/`en`/`zh` (`src/i18n/locale-parity.test.ts` xanh). Email chỉ tiếng Việt (member chưa có cột ngôn ngữ). Mobile-first: vùng chạm ≥ 44px, chữ ≥ 16px, bottom sheet trên mobile, dialog từ `sm:` (dùng `useIsMobile()`), skeleton, màu từ CSS variables (đếm chưa đọc: `bg-destructive text-white`).
- Thao tác đánh dấu đã đọc và đổi tuỳ chọn là optimistic qua `fireAction` + `queryClient.setQueryData`, rollback khi lỗi.
- Không động vào bot Messenger (`src/lib/messenger.ts`) (spec quyết định 8).
- Commit: Conventional Commits 1 dòng, không body, không trailer. Implementer được tự commit đúng message của plan nếu user cho phép như G2a; nếu chưa, đề xuất và chờ.

### Quy ước dùng chung (mọi task phải theo)

| Việc | Quy ước |
|---|---|
| Kiểu tx | `src/db/tx.ts`: `export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]; export type DbOrTx = typeof db \| Tx;` (file mới chỉ import type) |
| Người nhận | `type Recipient = { type: "member" \| "admin"; id: number }`. Admin = dòng `admins` có `role = 'superadmin'`. Member nhận tin nhóm = `isActive && approvalStatus = 'approved'`. Tin tài khoản gửi cho đúng member đó bất kể trạng thái |
| `dedup_key` | `${base}:${r.type === "member" ? "m" : "a"}${r.id}`. `base` theo bảng dưới. Sự kiện lặp hợp lệ (đổi giờ hai lần) mang `token` = ISO thời điểm hành động |
| Liên kết | Dựng lúc hiển thị bằng `notificationHref(item, scope)` (Task 2), không lưu URL |

| `base` dedup | Sự kiện |
|---|---|
| `sopen:s{sid}` | buổi mở vote |
| `schg:s{sid}:{field}:{token}` | đổi giờ / sân / giá sân |
| `scancel:s{sid}:{token}`, `sreopen:s{sid}:{token}` | hủy, mở lại buổi |
| `vreopen:s{sid}:{token}` | gia hạn / mở lại vote |
| `vedit:s{sid}:m{mid}:{token}` | admin sửa vote của member |
| `salmost:s{sid}:x{max}` | member: còn ≤ 2 chỗ |
| `cap:s{sid}:x{max}:r{rank}` | admin: ngưỡng sức chứa (Task 7) |
| `drop:s{sid}:m{mid}:{token}` | admin: bỏ chơi sát giờ |
| `fin:s{sid}:n{k}` | chốt sổ lần thứ k của người nhận cho buổi đó (gồm cả tin "số tiền đổi" về 0 cho người bị bỏ khỏi buổi) |
| `sdel:s{sid}` | xoá buổi đã chốt, hoàn quỹ |
| `paycf:d{debtId}:{key}`, `payundo:d{debtId}:{lastDeductionId}` | xác nhận / hoàn tác thanh toán (hoàn tác chỉ khi thật sự có dòng đảo được ghi) |
| `acct:decline:m{id}:{token}` | admin không nhận vào nhóm (tài khoản giao lưu) |
| `txrev:{key}`, `fcontrib:{key}`, `fclaim:{notifId}`, `frefund:{key}`, `bank:{transId}[:d{debtId}]` | giao dịch quỹ |
| `paymember:d{debtId}:{key}`, `fclaimreq:{gmailMessageId}` | admin: member báo đã chuyển |
| `acct:{approve\|reject\|merge}:m{id}[:{token}]`, `pwd:m{id}:{token}`, `oauth:{link\|unlink}:{provider}:m{id}:{token}` | tài khoản |
| `signup:m{id}`, `joinreq:m{id}:{token}`, `venue:v{vid}`, `venuest:v{vid}:{status}` | admin duyệt / sân |
| `lowstock:b{brandId}:p{lastPurchaseId\|0}` | cầu dưới ngưỡng |
| `vdue:s{sid}:{h}h:{fp}`, `unvoted:s{sid}:{fp}`, `courtlock:s{sid}:h{N}:{fp}`, `day:s{sid}:{morning\|3h}:{fp}` | tin hẹn giờ (N1b), `fp` = vân tay buổi (Task 17), `N` = `courtLockHoursBefore` |
| `debt:m{mid}:{YYYY-MM-DD}` | nhắc nợ: tối đa 1 tin/người/ngày (N1b) |
| `rent:{YYYY-MM}`, `reconcile:{YYYY-MM-DD}`, `weekly:{YYYY-MM-DD}` | tin cron (N1b), ngày theo giờ VN |

## Quyết định của plan (spec chưa nói, cần user soát)

1. Có công tắc `notificationsEnabled`, mặc định TẮT. Deploy xong không ai thấy gì cho tới khi admin bật trong Cài đặt.
2. "Buổi mới mở vote" của buổi xa hơn 48h: cron sáng gửi lên chuông khi buổi vào khung 48h (thay vì chỉ nằm trong mail tóm tắt), để member không có email vẫn biết.
3. Email chỉ tiếng Việt (member chưa có cột ngôn ngữ). Chuông theo ngôn ngữ người xem.
4. Member tắt nhận email (hoặc bấm huỷ nhận) thì không nhận email nào, kể cả tin bắt buộc. Tin bắt buộc vẫn luôn có trên chuông.
5. Email admin dùng `admins.email` sẵn có, không cần bấm xác minh.
6. Tóm tắt tuần cho admin hiện cả trên chuông (spec chỉ ghi email).
7. Cảnh báo cầu dưới ngưỡng ghi ngay sau khi lưu xong (ngoài transaction), vì đây là tin suy ra, không phải nghiệp vụ.
8. Có gắn tin cho luồng tự khớp chuyển khoản ngân hàng (Gmail), dù luồng này chưa bật ở prod, để sau này bật không bị thiếu tin tiền.
9. Ngưỡng "vượt" báo ở 17/16, 19/16, 21/16... (mỗi lần vượt thêm 2). Số người tụt rồi tăng lại không báo lại mức đã báo.
10. **Sửa luôn lỗi lệch 7 tiếng của "gia hạn vote"** (`extendVoteDeadline`, kiểm "hạn ở tương lai" của `setVoteDeadline`), lỗi đang treo trong memory. Lý do: nhắc vote và tin "vote mở lại" dựa vào hạn này; để nguyên thì có thể báo "vote mở lại" trong khi vote vẫn đóng. Có test với `TZ=UTC`. User không đồng ý thì Task 6 chỉ gửi tin khi hạn mới thật sự ở tương lai, không sửa action.
11. Nhắc nợ tính tuổi nợ từ lúc số dư chuyển sang âm lần gần nhất (spec ghi "sau chốt sổ"). Nhóm chơi nhiều buổi một tuần, nên tính theo từng buổi sẽ nhắc 3-4 tin cùng ngày và không bao giờ dừng. Mỗi người tối đa 1 tin nhắc mỗi ngày.
12. Kiểm sổ quỹ (I1-I10) tự chạy 1 lần/ngày trong cron sáng (spec ghi "Ngay"; app hiện không có lúc nào chạy tự động khác).
13. Dọn dữ liệu cũ trong cron sáng: tin đã đọc quá 90 ngày, lượt gửi email xong quá 30 ngày, job đã xong quá 30 ngày. Lý do: bản sao lưu mỗi giờ đọc toàn bộ bảng, để phình mãi thì tốn quota Turso.
14. Tin "bị từ chối" của tài khoản: member bị từ chối vẫn thấy chuông, nhưng chỉ thấy tin nhóm "tài khoản" của mình. "Không nhận vào nhóm" (tài khoản giao lưu) cũng có tin.
15. Thêm cron thứ hai lúc 07:00 VN chỉ để gửi email (tóm tắt ngày + mail bị dồn vì giờ yên lặng), vì cron chính 06:00 còn trong giờ yên lặng. Vercel Hobby cho 100 cron, mỗi cron 1 lần/ngày.

## Review Focus

1. **Bấm hai lần, `fireAction` tự retry, QStash gọi lại, cron chạy lại, chốt sổ lại cùng số tiền:** mỗi người chỉ nhận đúng 1 tin cho 1 sự kiện. Test ở Task 3 (dedup), 6, 8 (chốt lại cùng số tiền → 0 tin mới; khác số tiền → 1 tin "số tiền đổi"), 18 (job chạy 2 lần).
2. **Member A đoán id tin của member B, hoặc gọi action với `scope: "admin"` không có cookie admin:** không đọc, không đánh dấu được tin người khác. Test IDOR ở Task 4.
3. **Admin đổi giờ, đổi hạn vote hoặc hủy buổi sau khi đã hẹn nhắc:** job cũ chạy tới vẫn không gửi gì (vân tay lệch hoặc buổi đã hủy), job mới đúng giờ VN. Test ở Task 17 và 18, chạy với `TZ=UTC`.
4. **Số dư trong tin tiền khác số dư member thấy ở `/my-fund`** (do `autoApplyFundToDebts` chạy sau tx): test ở Task 8 so `balanceAfter` với `getFundBalance(memberId)` SAU khi action trả về. Nếu lệch, bỏ `balanceAfter` khỏi tin đó (tin chỉ dẫn link), KHÔNG dời `notify` ra ngoài tx.
5. **Công tắc tắt (mặc định sau deploy):** mọi action cũ chạy đúng như trước, không dòng nào vào bảng thông báo, chuông không hiện, route jobs/cron không gửi gì. Test ở Task 3, 5, 18, 19 và e2e Task 12.

---

# Phần A: N1a, chuông + tin gửi ngay (deploy được riêng)

### Task 0: Chuẩn bị worktree và đo baseline

**Files:** không đổi code. Tạo `.superpowers/n1/` (đã gitignored qua `.superpowers`).

- [ ] **Step 1:** `cd D:/Lwcifer/LW/FWBB-notify && pnpm install`. Copy `D:/Lwcifer/LW/FWBB-g2/e2e/local.db` (đã có 0027) vào `e2e/local.db`. Tạo `.superpowers/n1/local-db.env` (2 dòng `TURSO_DATABASE_URL=file:e2e/local.db`, `TURSO_AUTH_TOKEN=`) và `.superpowers/n1/test-env.sh` bằng cách chạy lại script `D:/Lwcifer/LW/FWBB-g2/.superpowers/g2a/prep-admin.mjs` (copy sang `.superpowers/n1/`, đổi tiền tố mật khẩu và tên file ra) để có mật khẩu admin + secret giả mới.
- [ ] **Step 2:** `node scripts/apply-migration.mjs --env=.superpowers/n1/local-db.env --dry-run`. Expected: mọi migration tới 0027 "applied", không có dòng "WOULD APPLY". Lưu `select name, sql from sqlite_master` vào `.superpowers/n1/sqlite-master-before.txt`.
- [ ] **Step 3:** Baseline, mỗi lệnh ghi exit code riêng (`cmd > log 2>&1; echo $?`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/n1/test-env.sh && pnpm build`, `source .superpowers/n1/test-env.sh && pnpm test:e2e`. Expected: tất cả exit 0 (G2a ghi: vitest 1803/1803, e2e 87/87). Ghi số liệu vào ledger SDD. Lỗi có sẵn thì ghi rõ, không sửa trong task này.

### Task 1: Bảng dữ liệu, migration 0028, công tắc

**Files:**
- Create: `src/db/tx.ts`
- Modify: `src/db/schema.ts` (4 bảng mới, `admins.role`, `members.notifyEmailVerifiedFor`)
- Create: `src/db/migrations/0028_*.sql` (+ meta, qua `pnpm db:generate`)
- Modify: `src/lib/settings-registry.ts` (`notificationsEnabled`, `courtLockHoursBefore`, `zaloGroupUrl`)
- Test: `src/db/notifications-schema.integration.test.ts`

**Interfaces:**
- Produces (bảng Drizzle, tên TS → tên cột):
  - `notifications`: `id` pk autoincrement; `recipientType` text enum `["member","admin"]` notNull; `recipientId` int notNull; `kind` text notNull; `entityType` text enum `["session","member","transaction","venue","brand","month"]` nullable; `entityId` int nullable; `payload` `text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull()`; `mandatory` boolean notNull default false; `readAt` text nullable; `createdAt` text notNull; `dedupKey` text notNull. Index: `uniqueIndex("notifications_dedup_key_unique").on(dedupKey)`, `index("notifications_recipient_unread_idx").on(recipientType, recipientId, readAt, createdAt)`, `index("notifications_recipient_created_idx").on(recipientType, recipientId, createdAt)`, `index("notifications_entity_idx").on(entityType, entityId)`. Không FK tới members/sessions (buổi có thể bị xoá cứng, member bị gộp).
  - `notificationDeliveries`: `id`; `notificationId` int notNull FK `notifications.id` onDelete cascade; `recipientType`, `recipientId` (như trên); `channel` text enum `["email"]` notNull; `status` text enum `["pending","sent","failed","skipped"]` notNull default `"pending"`; `attempts` int notNull default 0; `nextAttemptAt` text notNull; `errorCode` text nullable; `sentAt` text nullable; `createdAt` text notNull. Index: `uniqueIndex(...).on(notificationId, channel)`, `index(...).on(status, nextAttemptAt)`, `index(...).on(recipientType, recipientId, sentAt)`.
  - `notificationPrefs`: `id`; `recipientType`, `recipientId`; `mutedGroups` json `string[]` notNull default `[]`; `emailEnabled` boolean notNull default true; `unsubToken` text nullable (chuỗi ngẫu nhiên 32 byte base64url, tạo khi gửi mail tuỳ chọn đầu tiên); `updatedAt` text notNull. `uniqueIndex(...).on(recipientType, recipientId)`, `uniqueIndex(...).on(unsubToken)`.
  - `scheduledJobs`: `id`; `jobKey` text notNull (`uniqueIndex`); `kind` text notNull; `sessionId` int nullable; `runAt` text notNull; `status` text enum `["scheduled","done","skipped","cancelled","failed"]` notNull default `"scheduled"`; `messageId` text nullable; `payload` json notNull default `{}`; `createdAt`, `updatedAt` text notNull. Index: `(status, runAt)`, `(sessionId, status)`.
  - `admins.role`: `text("role", { enum: ["superadmin"] }).notNull().default("superadmin")`. KHÁC claim `role: "admin"` trong JWT (`src/lib/auth.ts`); không đổi JWT, không đổi `requireAdmin`.
  - `members.notifyEmailVerifiedFor`: `text("notify_email_verified_for")` nullable = địa chỉ email (chữ thường) đã bấm link xác minh. Member chỉ được coi là "đã xác minh" khi giá trị này bằng `lower(members.email)` hiện tại, nên mọi đường đổi email (member tự sửa, admin sửa, gộp tài khoản, Google) tự mất hiệu lực mà không cần sửa từng chỗ. (Spec 4.8 gọi là `notify_email_verified_at`; đổi để chặn gửi nhầm địa chỉ.)
- Settings mới (`SETTINGS` registry, `perSession: false`): `notificationsEnabled: z.boolean()` default `false`, revalidate `["/", "/admin", "/admin/settings"]`; `courtLockHoursBefore: z.number().int().min(1).max(72)` default `24`, revalidate `["/admin/settings"]`; `zaloGroupUrl: z.union([z.literal(""), z.string().url().startsWith("https://zalo.me/")])` default `""`, revalidate `["/admin/settings"]`.

- [ ] **Step 1: Test đỏ** (`notifications-schema.integration.test.ts`, đọc `sqlite_master` qua `createTestDb()` như `src/db/venues-schema.integration.test.ts`):
  - `creates the four notification tables with their indexes` (khẳng định đủ tên bảng và từng tên index khai ở Interfaces)
  - `admins.role defaults to superadmin for existing rows` (insert admin không truyền role → `role === "superadmin"`)
  - `dedup_key is unique` (insert 2 dòng cùng key → dòng 2 lỗi UNIQUE)
  - `settings registry: notificationsEnabled defaults to false, courtLockHoursBefore to 24, zaloGroupUrl to ""` (qua `defaultSettings()`)
- [ ] **Step 2:** `pnpm test src/db/notifications-schema.integration.test.ts` → FAIL (bảng chưa có).
- [ ] **Step 3:** Sửa schema + registry, `pnpm db:generate`. Mở file 0028: chỉ được có `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, và đúng 2 `ALTER TABLE ... ADD`. Thấy `__new_`, `INSERT INTO`, `DROP TABLE` là sai, sửa schema rồi sinh lại.
- [ ] **Step 4:** `pnpm test src/db/notifications-schema.integration.test.ts` → PASS. Áp lên bản sao: `node scripts/apply-migration.mjs --env=.superpowers/n1/local-db.env` (kiểm dòng "Loaded env from" đúng file), so `sqlite_master` với mốc Task 0: chỉ có thêm, index cũ của `members`/`admins` còn nguyên.
- [ ] **Step 5: Commit** `feat(notifications): add notification tables, admin role and kill switch`

### Task 2: Danh mục tin, payload, cách hiển thị và liên kết

**Files:**
- Create: `src/lib/notifications/catalog.ts`, `src/lib/notifications/render.ts`
- Modify: `src/i18n/messages/{vi,en,zh}.json` (namespace `notifications`)
- Test: `src/lib/notifications/catalog.test.ts`, `src/lib/notifications/render.test.ts`

**Interfaces:**
- Produces:
  - `type NotificationGroup = "session" | "money" | "account" | "venue" | "admin_session" | "admin_money" | "admin_members" | "admin_inventory"`; `MEMBER_GROUPS`, `ADMIN_GROUPS` (mảng hằng).
  - `interface KindDef { audience: "member" | "admin"; group: NotificationGroup; mandatory: boolean; email: boolean; level: "now" | "scheduled" | "digest"; quietHoursBypassSameDay: boolean }`.
  - `NOTIFICATION_CATALOG: Record<NotificationKind, KindDef>` và `type NotificationPayloads` (map kind → kiểu payload). Danh sách kind và cờ, chép đúng từ spec 4.5:

    | kind | audience/group | mandatory | email | level |
    |---|---|---|---|---|
    | `session_opened` | member/session | no | no | now |
    | `vote_due_soon` (`{hoursLeft: 24\|2}`) | member/session | no | yes | scheduled |
    | `vote_reopened` | member/session | no | no | now |
    | `vote_edited_by_admin` | member/session | yes | no | now |
    | `session_changed` (`fields: ("time"\|"court"\|"price")[]`) | member/session | yes | yes | now, bypass |
    | `session_cancelled` | member/session | yes | yes | now, bypass |
    | `session_reopened` | member/session | yes | no | now |
    | `session_almost_full` | member/session | no | no | now |
    | `game_day_reminder` (`{when: "morning"\|"3h"}`) | member/session | no | no | scheduled |
    | `session_finalized`, `session_amount_changed`, `session_deleted_refund` | member/money | yes | yes | now |
    | `payment_confirmed`, `payment_undone`, `transaction_reversed`, `fund_contribution_recorded`, `fund_refund_recorded` | member/money | yes | yes | now |
    | `debt_reminder` | member/money | yes | yes | scheduled |
    | `account_approved`, `account_rejected`, `group_request_declined`, `account_merged`, `password_changed`, `login_method_linked`, `login_method_unlinked` | member/account | yes | yes | now |
    | `venue_approved`, `venue_hidden` | member/venue | no | yes | digest |
    | `capacity_alert` (`{rank, headcount, maxPlayers, courtLockAt}`) | admin/admin_session | yes | yes | now |
    | `low_attendance` | admin/admin_session | yes | yes | scheduled |
    | `member_dropped_late` | admin/admin_session | no | no | now |
    | `unvoted_before_deadline` (`{names: string[]}`) | admin/admin_session | no | no | scheduled |
    | `member_reported_transfer` | admin/admin_money | no | no | now |
    | `signup_pending`, `group_join_request` | admin/admin_members | no | no | now |
    | `venue_pending` | admin/admin_members | yes | yes | now |
    | `low_stock` | admin/admin_inventory | no | no | now |
    | `court_rent_unpaid` | admin/admin_money | no | yes | scheduled |
    | `reconcile_failed` | admin/admin_money | yes | yes | now |
    | `weekly_summary` | admin/admin_session | no | yes | scheduled |

    Mọi payload chỉ có `string | number | boolean | null | string[]`; tiền là số nguyên VND; ngày buổi là `sessionDate: "YYYY-MM-DD"` + `startTime: "HH:MM"`.
  - `type NotificationView = { id: number; kind: NotificationKind; entityType: string | null; entityId: number | null; payload: Record<string, unknown>; mandatory: boolean; readAt: string | null; createdAt: string }`.
  - `type Translate = (key: string, values?: Record<string, string | number>) => string`.
  - `renderNotification(t: Translate, item: NotificationView, locale: "vi" | "en" | "zh"): { title: string; body: string }`: tra `kinds.<kind>.title|body`, định dạng tiền bằng `formatVND` (`src/lib/utils.ts`), ngày bằng `formatSessionDate` (`src/lib/date-format.ts`) theo `locale` trước khi đưa vào ICU. Chuông truyền `useLocale()`, email truyền `"vi"`. Kind lạ → `kinds.unknown.*` (không throw).
  - `notificationHref(item: NotificationView, scope: "member" | "admin"): string`: member: session → `/vote/{id}`, money → `/my-fund`, account → `/me`, venue → `/san`; tin `session_deleted_refund` → `/my-fund`. Admin: session → `/admin/sessions/{id}`, member/signup → `/admin/members`, venue → `/admin/venues`, low_stock → `/admin/inventory`, money → `/admin/finance`, rent → `/admin/court-rent`.
- i18n `notifications`: `bell.{title, empty, markAll, loadMore, error, unreadCount}`, `kinds.<kind>.{title, body}` cho mọi kind ở bảng + `unknown`, `groups.<group>`, `prefs.*` (Task 10 thêm).

- [ ] **Step 1: Test đỏ:**
  - `catalog: every kind has vi/en/zh title and body` (đọc 3 file JSON)
  - `catalog: mandatory kinds match spec` (khẳng định đúng tập `mandatory` ở bảng)
  - `render: session_finalized shows own total as VND` (payload `{sessionDate:"2026-11-05", startTime:"20:30", total: 85000, ...}` → body chứa `formatVND(85000)`)
  - `render: unknown kind falls back without throwing`
  - `render: en locale formats the session date in English`
  - `href: member session kinds link to /vote/{id}; admin capacity_alert links to /admin/sessions/{id}; deleted refund links to /my-fund`
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** Viết catalog, render, i18n (vi viết tự nhiên như người, en/zh dịch tương ứng; không em dash).
- [ ] **Step 4:** `pnpm test src/lib/notifications src/i18n` → PASS.
- [ ] **Step 5: Commit** `feat(notifications): add notification catalog and rendering`

### Task 3: Lõi `notify()` và người nhận

**Files:**
- Create: `src/lib/notifications/notify.ts`, `src/lib/notifications/recipients.ts`, `src/lib/notifications/after.ts`, `src/lib/notifications/test-helpers.ts`
- Test: `src/lib/notifications/notify.integration.test.ts`

**Interfaces:**
- Consumes: `Tx`, `DbOrTx` (Task 1), `NOTIFICATION_CATALOG` (Task 2).
- Produces:
  - `isNotificationsEnabled(db: DbOrTx): Promise<boolean>`: đọc đúng 1 dòng `app_settings` theo khoá `notificationsEnabled`, parse như `settings-resolve`. Mọi helper sự kiện ở Task 6-11, 17-19 nhận thêm tham số cuối `gate?: boolean`; không truyền thì tự đọc cờ; `false` thì return ngay trước mọi truy vấn khác.
  - `runAfterResponse(fn: () => Promise<unknown>): void` trong `src/lib/notifications/after.ts`: `try { after(() => fn().catch(logCode)) } catch { /* ngoài request scope: bỏ qua, cron bù */ }`. Callback PHẢI return promise để `waitUntil` chờ được. Không bao giờ ném lỗi ra ngoài.
  - `type NotifyInput<K extends NotificationKind> = { kind: K; recipients: Recipient[]; payload: NotificationPayloads[K]; dedupBase: string; entity?: { type: EntityType; id: number }; now?: Date }`.
  - `notify<K>(db: DbOrTx, input: NotifyInput<K>): Promise<{ inserted: number; ids: number[] }>`: công tắc tắt hoặc `recipients` rỗng → `{inserted:0, ids:[]}` không đụng bảng thông báo. Bỏ người nhận trùng. Kind không bắt buộc: bỏ người nhận có `group` nằm trong `mutedGroups` (1 truy vấn `IN` lên `notification_prefs`). Một lệnh insert nhiều dòng `.onConflictDoNothing({ target: notifications.dedupKey }).returning({ id })`. `createdAt = (now ?? new Date()).toISOString()`. Lỗi DB thì ném ra (để tx nghiệp vụ rollback, đúng spec 4.9). Task 15 sẽ thêm bước xếp hàng email ở đây.
  - `superadminRecipients(db: DbOrTx): Promise<Recipient[]>`
  - `groupMemberRecipients(db: DbOrTx): Promise<Recipient[]>` (active + approved)
  - `sessionVoteRecipients(db: DbOrTx, sessionId: number, which: "voted" | "notVoted" | "play"): Promise<Recipient[]>`: dùng `splitMembersByVote` (`src/lib/vote-list-utils.ts`) trên member active + approved, `"play"` = vote có `willPlay`.
  - `memberName(db: DbOrTx, memberId: number): Promise<string>` (nickname nếu có, không thì name; chỉ cho tin admin).
  - `enableNotificationsForTest(db)` trong `test-helpers.ts` (insert setting `true`).

- [ ] **Step 1: Test đỏ** (`createTestDb` + mock `@/db` như `submit-vote.integration.test.ts`):
  - `switch off: inserts nothing and reads no notification table` (spy: không có câu SQL nào nhắc `notifications`)
  - `runAfterResponse outside a request scope does not throw` (không mock `next/server`)
  - `inserts one row per recipient with suffixed dedup keys`
  - `same dedupBase twice: second call inserts 0`
  - `muted optional group is skipped; mandatory kind ignores mutes`
  - `rolls back with the caller transaction` (gọi trong `db.transaction`, ném lỗi sau notify → 0 dòng)
  - `superadminRecipients returns only role=superadmin admins`
  - `sessionVoteRecipients: notVoted includes stale false/false rows and excludes locked or pending members`
- [ ] **Step 2:** chạy → FAIL.
- [ ] **Step 3:** Viết code.
- [ ] **Step 4:** `pnpm test src/lib/notifications` → PASS.
- [ ] **Step 5: Commit** `feat(notifications): add notify core and recipient helpers`

### Task 4: Server action đọc và đánh dấu đã đọc

**Files:**
- Create: `src/actions/notifications.ts`
- Test: `src/actions/notifications.integration.test.ts`

**Interfaces:**
- Consumes: `notifications`, `NotificationView`.
- Produces (`"use server"`, `scope: "member" | "admin"`):
  - `getUnreadNotificationCount(scope): Promise<number>`: chưa đăng nhập, công tắc tắt → 0. Đếm qua `SELECT count(*) FROM (SELECT 1 ... WHERE read_at IS NULL LIMIT 100)`.
  - `listNotifications(scope, cursor: { createdAt: string; id: number } | null): Promise<{ items: NotificationView[]; nextCursor: { createdAt: string; id: number } | null } | { error: string }>`: 20 tin, mới nhất trước, phân trang theo `(createdAt, id)` giảm dần.
  - `markNotificationRead(scope, id: number): Promise<{ success: true } | { error: string }>`: `UPDATE ... WHERE id = ? AND recipient_type = ? AND recipient_id = ? AND read_at IS NULL`.
  - `markAllNotificationsRead(scope): Promise<{ success: true } | { error: string }>`.
  - Người xem: `scope "member"` = `getUserFromCookie()` + member tồn tại và `isActive` (tài khoản giao lưu pending thấy tin của mình). Member `rejected` chỉ đọc/đánh dấu được tin có `group === "account"` (quyết định 14); count và list lọc theo tập kind đó. `scope "admin"` = `requireAdmin()` rồi `Number(admin.sub)`. Không có người xem hợp lệ → `{ error }` (list) hoặc 0 (count). Không `revalidatePath` (client tự cập nhật cache).

- [ ] **Step 1: Test đỏ:**
  - `count caps at 100 and ignores read rows`
  - `list returns 20 newest then pages by cursor without duplicates`
  - `member cannot read or mark another member's notification` (IDOR: id của người khác → 0 dòng đổi, list không chứa)
  - `admin scope without admin cookie returns error / 0`
  - `exchange pending account sees own notifications; rejected sees only account-group notifications; locked (isActive=false) sees none`
  - `markAll only touches the caller's rows`
- [ ] **Step 2:** chạy → FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): add read and mark-read actions`

### Task 5: Chuông member + admin

**Files:**
- Create: `src/components/notifications/use-notifications.ts`, `notification-bell.tsx`, `notification-panel.tsx`, `notification-row.tsx`
- Modify: `src/components/layout/header.tsx` (prop `showBell?: boolean`), `src/components/layout/member-shell.tsx`, `src/app/(admin)/admin/layout.tsx`, `src/components/layout/admin-sidebar.tsx`, `src/components/layout/admin-mobile-nav.tsx`
- Test: `src/components/notifications/notification-bell.test.tsx` (jsdom), `src/components/layout/member-shell.integration.test.tsx` nếu G2a đã có file tương ứng thì thêm case vào đó

**Interfaces:**
- Consumes: 4 action Task 4, `renderNotification`, `notificationHref`, `fireAction`, `useIsMobile`.
- Produces:
  - `useUnreadCount(scope)`: `useQuery({ queryKey: ["notifications", scope, "unread", pathname], queryFn, staleTime: 15_000, refetchOnWindowFocus: true })` với `pathname = usePathname()`, nên chuyển trang là đếm lại (cache 15s chặn đếm dồn), không `useEffect` + fetch. Provider đang tắt `refetchOnWindowFocus` toàn cục nên phải bật riêng ở query này. Cập nhật optimistic dùng `queryClient.setQueriesData({ queryKey: ["notifications", scope, "unread"] }, ...)` để trúng mọi `pathname`.
  - `useNotificationList(scope, enabled)`: `useInfiniteQuery` theo cursor, chỉ chạy khi panel mở.
  - `NotificationBell({ scope }: { scope: "member" | "admin" })`: nút 44×44, icon `Bell` (lucide), chấm đếm `bg-destructive text-white`, hiện `99+` khi ≥ 100. Bấm mở `NotificationPanel`: mobile `Sheet side="bottom"`, từ `sm:` `Dialog`. Skeleton dạng `SkeletonCard variant="row"` khi tải, `EmptyState` khi rỗng, nút "Đánh dấu đã đọc tất cả", "Xem thêm". Bấm 1 tin: optimistic đặt `readAt` + giảm đếm qua `setQueryData`, gọi `fireAction(() => markNotificationRead(...), rollback)`, rồi `router.push(notificationHref(...))`. Tin chưa đọc có nền nhấn (`bg-primary/5`).
  - `Header` nhận `showBell` và đặt chuông NGOÀI `div[data-tour="header-prefs"]` (giữ khung tour cũ).
  - `MemberShell`: nhánh "approved", "exchange pending" và "rejected" truyền `showBell={settings.notificationsEnabled}` (nhánh khoá `isActive=false`, guest, pending nhóm, đổi mật khẩu bắt buộc thì không). Không đếm chưa đọc ở server (trang chủ có `AutoRefresh` 30s làm render lại layout).
  - Admin layout đọc setting rồi truyền `showBell` cho `AdminSidebar` (khối logo) và `AdminMobileNav` (giữa logo và nút menu). Badge "member chờ duyệt", "sân chờ duyệt" giữ nguyên.

- [ ] **Step 1: Test đỏ:**
  - `bell shows 99+ when count is 100`
  - `clicking an unread row marks it read optimistically and rolls back on error` (mock action trả `{error}` → `readAt` trở lại null, `toast.error` được gọi)
  - `mobile renders a bottom sheet, desktop a dialog` (mock `useIsMobile`)
  - `member shell: guest, locked and pending-group branches render no bell; approved and rejected branches render it only when notificationsEnabled`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS. Mở app local (`source .superpowers/n1/test-env.sh && pnpm build && pnpm exec next start --port 3101`), xem ở 375px và 1280px: chuông không đè logo, tour trang chủ vẫn khoanh đúng cụm ngôn ngữ/giao diện.
- [ ] **Step 5: Commit** `feat(notifications): add notification bell for members and admins`

### Task 6: Tin vòng đời buổi chơi

**Files:**
- Create: `src/lib/notifications/session-events.ts`, `src/lib/notifications/time.ts`
- Modify: `src/actions/sessions.ts` (`createSessionManually`, `getNextSession`, `getAdminUpcomingSession`, `setSessionTime`, `selectCourt`, `confirmSession`, `setSessionCourtPriceOverride`, `cancelSession`, `reopenSession`, `setVoteDeadline`, `extendVoteDeadline`), `src/app/api/cron/create-session/route.ts`, `src/lib/session-status.ts` (`isVoteOpen` thêm tham số `now = new Date()`, tương thích ngược)
- Test: `src/lib/notifications/session-events.integration.test.ts`, `src/actions/vote-deadline-tz.integration.test.ts`

**Interfaces:**
- Consumes: `notify`, `groupMemberRecipients`, `sessionVoteRecipients`.
- Produces:
  - `sessionStartInstant(date: string, startTime: string): Date` trong `src/lib/notifications/time.ts` (= `new Date(\`${date}T${startTime}:00+07:00\`)`).
  - `notifySessionOpened(db: DbOrTx, sessionId: number, now?: Date, gate?: boolean): Promise<void>`: đọc lại buổi; chỉ gửi khi `status` là `voting`/`confirmed`, `isVoteOpen(session, now)` mở, và giờ bắt đầu ≤ 48h kể từ `now` (buổi xa hơn do cron hằng ngày gửi khi vào khung 48h, Task 19). Người nhận: `groupMemberRecipients`. Dedup `sopen:s{sid}`.
  - `notifySessionChanged(db, sessionId, fields: ("time"|"court"|"price")[], token: string)`: người vote chơi hoặc ăn (`"voted"`). Payload gồm giá trị mới (`startTime`, `endTime`, `courtName`, `courtPrice`).
  - `notifySessionCancelled(db, sessionId, token)`, `notifySessionReopened(db, sessionId, token)`: người đã vote (cancel không xoá vote).
  - `notifyVoteReopened(db, sessionId, token)`: người chưa vote, payload `{ voteDeadline: string | null }`.
- Gắn vào action (mỗi chỗ: bọc lệnh ghi hiện có + notify vào `db.transaction`, `token = new Date().toISOString()` dùng chung cho `updatedAt` và dedup):
  - `createSessionManually`, cron `createSessionIfMissing` (chỉ khi insert thật sự tạo dòng), 2 chỗ tự tạo buổi lúc render: gọi `notifySessionOpened` sau insert.
  - `setSessionTime`: chỉ khi `startTime` hoặc `endTime` đổi so với giá trị cũ. `selectCourt`: chỉ khi `courtId` hoặc `courtQuantity` đổi. `confirmSession` và `setSessionCourtPriceOverride`: chỉ khi `courtPrice` đổi. `fields` gộp trong 1 tin nếu cùng action đổi nhiều thứ.
  - `cancelSession`: trong tx sẵn có, đổi lệnh cập nhật trạng thái thành `UPDATE sessions SET status='cancelled' ... WHERE id = ? AND status NOT IN ('cancelled','completed') RETURNING id`; không có dòng trả về → trả `{ success: true, alreadyCancelled: true }` như hôm nay và không gửi tin. Ghi tiền pass chỉ chạy khi có dòng trả về (giữ đúng thứ tự ghi cũ). `reopenSession`: tương tự với `WHERE status = 'cancelled'`.
  - Hạn vote (quyết định 10): `extendVoteDeadline` tính bằng `parseVoteDeadline` + `nowDeadlineVN` thay cho `new Date(voteDeadline)` + `formatLocalDeadline`; kiểm "hạn ở tương lai" của `setVoteDeadline` dùng `parseVoteDeadline(deadline) > now`. Sau khi ghi: gửi `vote_reopened` CHỈ khi `parseVoteDeadline(hạn vừa ghi) > now` (hoặc hạn `null`) VÀ (vote đang đóng trước đó HOẶC hạn mới muộn hơn hạn cũ). `lockVoteNow`: không gửi.

- [ ] **Step 1: Test đỏ** (bật công tắc bằng `enableNotificationsForTest`):
  - `opened: session in 30h notifies all active approved members once; session in 5 days notifies nobody`
  - `setSessionTime same values sends nothing; new time notifies voters only with new time in payload`
  - `cancel then cancel again: one notification; cancel, reopen, cancel: two cancel notifications`
  - `two concurrent cancelSession calls (Promise.all) send one notification per voter and record pass revenue once`
  - `a session cancelled before entering the 48h window gets no "session opened" notification`
  - `extendVoteDeadline notifies only members who have not voted`
  - `TZ=UTC: extending a vote closed 3h ago by 2h reopens it until now+2h VN and notifies; an extension that still ends in the past sends nothing` (file `vote-deadline-tz.integration.test.ts`, kèm case `setVoteDeadline` từ chối hạn đã qua 3h theo giờ VN)
  - `switch off: cancelSession result and DB state identical to before, zero notification rows`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS, cộng full `pnpm test` (test cũ của sessions phải xanh không sửa).
- [ ] **Step 5:** chạy `finance-invariant-reviewer` cho diff `cancelSession`/`reopenSession` → PASS.
- [ ] **Step 6: Commit** `feat(notifications): notify members about session changes`

### Task 7: Tin vote, ngưỡng sân, bỏ chơi sát giờ

**Files:**
- Create: `src/lib/notifications/capacity.ts`
- Modify: `src/actions/votes.ts` (`submitVote`, `adminSetVote`, `adminSetPartner`, `adminSetGuestCount`, `adminRemoveVote`), `src/actions/sessions.ts` (`setSessionMaxPlayers`, `setAdminGuestCount`)
- Test: `src/lib/notifications/capacity.test.ts`, `src/lib/notifications/vote-events.integration.test.ts`

**Interfaces:**
- Produces:
  - `capacityRank(headcount: number, maxPlayers: number): number` (thuần): `0` khi `headcount < max - 2`; `1` (sắp đầy) khi `max - 2 ≤ headcount < max`; `2` (đầy) khi `headcount === max`; `3 + floor((headcount - max - 1) / 2)` khi vượt (17/16 → 3, 18/16 → 3, 19/16 → 4).
  - `courtLockAt(session: { date; startTime; voteDeadline }, hoursBefore: number): Date`: `start - hoursBefore`, nếu hạn vote muộn hơn mốc đó thì lấy hạn vote (spec 4.3).
  - `evaluateCapacity(tx: DbOrTx, sessionId: number, now?: Date): Promise<void>`: đếm `playHeadcount(votes của member active+approved, session.adminGuestPlayCount)` (`src/lib/vote-capacity.ts`). Admin: lấy rank cao nhất đã gửi cho `(sid, max)` bằng truy vấn khoảng `dedup_key >= 'cap:s{sid}:x{max}:' AND dedup_key < 'cap:s{sid}:x{max};'`; nếu rank hiện tại > rank đã gửi thì gửi `capacity_alert` (payload `{ rank, headcount, maxPlayers, courtLockAt, sessionDate, startTime }`). Member: nếu vote đang mở và còn 1-2 chỗ, gửi `session_almost_full` cho người chưa vote (dedup `salmost:s{sid}:x{max}`).
  - `notifyLateDropout(tx, sessionId, memberId, token, now?)`: khi `willPlay` từ true thành false (hoặc xoá vote) trong 24h trước giờ bắt đầu và trước giờ bắt đầu → superadmin nhận `member_dropped_late` (tên, ngày, số người còn lại / max).
  - `notifyVoteEditedByAdmin(tx, sessionId, memberId, token)`: payload là vote mới của chính member (`willPlay`, `willDine`, `withPartner`, `guestPlayCount`, `guestDineCount`); xoá vote gửi tất cả false.
- Gắn: bọc phần ghi của 5 action vote + `setSessionMaxPlayers` + `setAdminGuestCount` vào `db.transaction`; trong tx gọi `evaluateCapacity` sau lệnh ghi; `submitVote` thêm `notifyLateDropout` (đọc vote cũ trước khi ghi); 4 action admin thêm `notifyVoteEditedByAdmin`. Rate limit giữ nguyên chỗ cũ (trước tx).

- [ ] **Step 1: Test đỏ:**
  - `capacityRank: 13/16=0, 14/16=1, 16/16=2, 17/16=3, 18/16=3, 19/16=4`
  - `courtLockAt: 24h before start; vote deadline later than that wins` (`TZ=UTC`, buổi `2026-11-05 20:30` → `2026-11-04T13:30:00.000Z`)
  - `votes 13→14→15: one "almost full" alert; →16: one "full"; →17: one "over"; drop to 14 then back to 16: no new alert`
  - `raising maxPlayers to 20 resets alerts for the new capacity`
  - `members who have not voted get one "almost full" when 2 slots remain; nothing once full`
  - `dropout 10h before start notifies superadmins; dropout 3 days before does not`
  - `adminSetGuestCount notifies the member with their own new guest count only`
  - `switch off: submitVote runs no query on notifications/notification_prefs/admins and returns exactly as before` (spy SQL)
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS + full `pnpm test`.
- [ ] **Step 5: Commit** `feat(notifications): alert admins on court capacity and notify vote edits`

### Task 8: Tin tiền

**Files:**
- Create: `src/lib/notifications/money-events.ts`
- Modify: `src/actions/finance.ts` (`finalizeSession`, `confirmPaymentByMember`, `confirmPaymentByAdmin`, `undoPaymentByAdmin`), `src/actions/fund.ts` (`recordContribution`, `recordRefund`, `reverseFinancialTransaction`, `confirmFundClaim`), `src/actions/auto-fund.ts` (`claimFundContribution`), `src/actions/sessions.ts` (`deleteSession`), `src/lib/payment-matcher.ts`
- Test: `src/lib/notifications/money-events.integration.test.ts`

**Interfaces:**
- Produces:
  - `memberBalanceInTx(tx: DbOrTx, memberId: number): Promise<number>`: `tx.query.financialTransactions.findMany({ where: eq(memberId) })` rồi `computeBalanceFromTransactions(memberId, rows).balance` (`src/lib/fund-core.ts`), đúng mẫu `fund.ts:154-165`.
  - `notifyFinalized(tx, sessionId: number, debts: { memberId: number; playAmount: number; dineAmount: number; guestPlayAmount: number; guestDineAmount: number; totalAmount: number }[], adminMemberId: number | null, gate?: boolean): Promise<void>`: `debts` là đúng danh sách vừa insert vào `session_debts` (`memberDebts` sau sàn min-deduction, không phải `breakdown.memberDebts`). Đọc tin chốt sổ cũ của buổi bằng index `(entity_type, entity_id)`, lấy `total` của tin mới nhất theo từng người nhận. Với từng người trong `debts`: chưa có tin cũ → `session_finalized`; có và tổng tiền khác → `session_amount_changed` (`oldTotal`, `newTotal`); có và bằng → bỏ. Người ĐÃ có tin cũ nhưng không còn trong `debts` (bị bỏ khỏi buổi khi chốt lại) → `session_amount_changed` với `newTotal: 0`. Dedup `fin:s{sid}:n{k}` (k = số tin chốt sổ đã có của người đó cho buổi). Payload gồm các khoản, `total`, `balanceAfter` (`memberBalanceInTx` sau khi ghi sổ). Member gắn với admin (`memberId === adminMemberId`, cùng cách `finalizeSession` nhận ra `isAdminDebt`): `total = playAmount + dineAmount` (đúng số bị trừ khỏi số dư), tiền khách gửi riêng ở `guestToFund` (khoản vào quỹ chung, không trừ của admin).
  - `notifySessionDeletedRefund(tx, session, deltas: Map<memberId, number>)`: trong tx của `deleteSession`, cộng dồn `deltas` NGAY TRONG các vòng đảo sẵn có, chỉ khi một dòng đảo thật sự được insert (không phải `alreadyReversed`, không phải replay): đảo `fund_deduction` → `+amount`, đảo `fund_contribution` (pass/penalty) → `-amount`. Gửi `session_deleted_refund` (`refundAmount = delta`) cho người có `delta !== 0`. Không gom từ `liveDeductions` (danh sách đó còn chứa khoản đã bị đảo sau mở khoá/hoàn tác). Đọc `session.date` trước bước xoá.
  - Các tin còn lại gọi `notify` trực tiếp trong tx sẵn có, đúng dedup ở bảng quy ước: `confirmPaymentByAdmin` → `payment_confirmed` (chỉ nhánh vào tx); `undoPaymentByAdmin` → `payment_undone`, chỉ khi tx này thật sự ghi ít nhất 1 dòng đảo (hàm không có nhánh trả sớm; bấm lần 2 chạy tx rỗng), `amount` = tổng các dòng đảo vừa ghi; `reverseFinancialTransaction` → `transaction_reversed` (kèm `reason`, chỉ khi `original.memberId` có, không phải replay); `recordContribution`, `confirmFundClaim` → `fund_contribution_recorded`; `recordRefund` → `fund_refund_recorded` (`balanceAfter = bal - amount`); payment-matcher: `matchFundContribution` → `fund_contribution_recorded`, `matchAllDebts` / `confirmDebtFromBankTransfer` → `payment_confirmed` mỗi debt.
  - Tin cho admin: `confirmPaymentByMember` (nhánh vào tx) và `claimFundContribution` → `member_reported_transfer` (`memberName`, `amount`, `purpose: "debt" | "fund"`, `sessionDate?`). `claimFundContribution` đang insert ngoài tx: bọc insert + notify vào `db.transaction`, thêm `.returning({ id })`.
- Không gắn tin ở nhánh trả sớm (`memberConfirmed`/`adminConfirmed` đã true, `replayed`, matcher `pending`/`duplicate`).

- [ ] **Step 1: Test đỏ** (dựng buổi + vote + chốt sổ bằng chính action, như `confirm-payment.integration.test.ts`):
  - `finalize notifies each attendee with their own amounts only` (payload không chứa memberId hay tiền của người khác)
  - `re-finalize with same amounts sends nothing; after unlock and edit, changed total sends session_amount_changed with old and new totals`
  - `balanceAfter equals getFundBalance after the action returns` cho `recordContribution`, `confirmFundClaim`, `matchFundContribution`, với fixture có nợ đã bị hoàn tác: chốt sổ → `undoPaymentByAdmin(debt)` → nạp quỹ ≥ số nợ (chỉ trạng thái này mới làm `autoApplyFundToDebts` trừ tiền). Kind nào lệch: bỏ `balanceAfter` khỏi kind đó (áp Review Focus 4), ghi tên kind vào ledger SDD, đổi test thành "payload không có balanceAfter".
  - `recordContribution replay with same idempotencyKey sends no second notification`
  - `deleteSession refund amount equals each member's getFundBalance change` cho 3 kịch bản: (a) chốt sổ → chốt lại → xoá; (b) chốt sổ → mở khoá → xoá (0 tin); (c) buổi có tiền pass cho member gắn admin
  - `undoPaymentByAdmin twice sends exactly one payment_undone`
  - `finalize 3 members, unlock, remove 1, re-finalize: the removed member gets one session_amount_changed with newTotal 0`
  - `admin member with admin guests: payload total = play + dine, guest amount reported as going to the fund`
  - `switch off: finalizeSession runs no query on notification tables and no extra financial_transactions read` (spy SQL, so số câu với baseline)
  - `confirmPaymentByMember notifies superadmins once; second call (already confirmed) sends nothing`
  - `notification insert failure rolls back the money write` (mock `notify` ném lỗi trong `recordRefund` → không có dòng `fund_refund`)
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS + full `pnpm test` (mọi test tiền cũ xanh không sửa) + `/reconcile-check` trên bản sao e2e nếu chạy được local.
- [ ] **Step 5:** `finance-invariant-reviewer` trên diff task này (prompt theo Global Constraints) → PASS (bắt buộc).
- [ ] **Step 6: Commit** `feat(notifications): notify members about money changes`

### Task 9: Tin tài khoản, đăng ký, sân

**Files:**
- Create: `src/lib/notifications/account-events.ts`
- Modify: `src/actions/member-approval.ts` (`approveMember`, `rejectMember`, `approveAndMergeMember`, `requestGroupMembership`), `src/actions/members.ts` (`mergeMember`, `resetMemberPassword`, `unlinkOAuthIdentity`), `src/actions/password-auth.ts` (`setPassword`, `signupWithPassword`), `src/actions/password-reset.ts` (`resetPasswordWithToken` nhánh member), `src/actions/google-auth.ts` (tạo member pending, `linkGoogleIdentity`), `src/actions/fb-auth.ts` (tạo member pending), `src/lib/oauth-identity.ts` (`ensureOAuthIdentity` nhận `db: DbOrTx = db`), `src/actions/venues.ts` (`submitVenue`, `setVenueStatus`)
- Test: `src/lib/notifications/account-events.integration.test.ts`

**Interfaces:**
- Produces:
  - `repointNotifications(tx: Tx, fromMemberId: number, toMemberId: number): Promise<void>`: đổi `recipient_id` của tin member và xoá dòng prefs của member nguồn. Gọi trong tx của `mergeMember` và `approveAndMergeMember` trước khi xoá member nguồn.
  - Các tin (dedup theo bảng quy ước):
    - `approveMember` / `rejectMember`: đổi thành `UPDATE ... WHERE approval_status != <đích> RETURNING`, chỉ gửi khi có dòng đổi; bọc tx. `account_approved` / `account_rejected`.
    - `approveAndMergeMember`: `account_merged` gửi cho `targetMemberId`.
    - `setPassword`, `resetPasswordWithToken` (member), `resetMemberPassword` (payload `byAdmin: true`): `password_changed`.
    - `linkGoogleIdentity` (chỉ khi thêm mới), `unlinkOAuthIdentity`: `login_method_linked|unlinked` (`provider`).
    - 3 chỗ tạo member pending của Google/FB/mật khẩu: bọc insert + notify vào tx, gửi superadmin `signup_pending` (`memberName`, `provider`) CHỈ khi `signupIntent === "group"`. Zalo (luôn exchange) không gửi.
    - `requestGroupMembership`: `group_join_request` chỉ khi update thực sự đổi dòng.
    - `declineGroupRequest`: `group_request_declined` cho tài khoản đó, chỉ khi update trả về dòng (dedup `acct:decline:m{id}:{token}`).
    - `submitVenue`: bọc câu `INSERT ... RETURNING` thô vào tx (`tx.all`), gửi superadmin `venue_pending` (`venueName`).
    - `setVenueStatus`: thêm `submittedByMemberId`, `name` vào `returning`; gửi người đề xuất `venue_approved` / `venue_hidden`.

- [ ] **Step 1: Test đỏ:**
  - `approve twice sends one account_approved`
  - `approveAndMergeMember: target receives account_merged and the pending member's earlier notifications now belong to the target`
  - `password signup with group intent notifies superadmins; Zalo exchange signup does not`
  - `submitVenue notifies superadmins once; setVenueStatus approved notifies only the submitter`
  - `unlinking the last login method rolls back and sends nothing`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS + full `pnpm test`.
- [ ] **Step 5:** `finance-invariant-reviewer` cho phần `mergeMember` → PASS.
- [ ] **Step 6: Commit** `feat(notifications): notify account, signup and venue events`

### Task 10: Tuỳ chọn thông báo (member + admin) và nút soạn tin Zalo

**Files:**
- Modify: `src/actions/notifications.ts` (thêm 2 action), `src/app/(public)/me/page.tsx`, `src/app/(admin)/admin/account/page.tsx`, `src/app/(admin)/admin/sessions/[id]/session-detail.tsx`, `src/app/(admin)/admin/settings/section-operations.tsx` (công tắc `notificationsEnabled` + ô `zaloGroupUrl` + ô `courtLockHoursBefore`, theo đúng mẫu `get()`/`set()` của `useSettingsDraft`), `src/components/notifications/notification-row.tsx` + `notification-bell.tsx` (khe nút theo kind), `src/app/(admin)/admin/layout.tsx` (truyền `zaloGroupUrl`), i18n
- Create: `src/components/notifications/notification-prefs-section.tsx`, `src/components/notifications/zalo-share-button.tsx`, `src/lib/zalo-share.ts`
- Test: `src/lib/zalo-share.test.ts`, `src/actions/notification-prefs.integration.test.ts`, `src/components/notifications/zalo-share-button.test.tsx`, `src/app/(admin)/admin/settings/section-operations-notifications.test.tsx` (cạnh `section-operations-exchange.test.tsx`)

**Interfaces:**
- Produces:
  - `getMyNotificationPrefs(scope): Promise<{ mutedGroups: NotificationGroup[]; emailEnabled: boolean; email: string | null; emailVerified: boolean } | { error: string }>`
  - `updateMyNotificationPrefs(scope, patch: { mutedGroups?: NotificationGroup[]; emailEnabled?: boolean }): Promise<{ success: true } | { error: string }>`: zod kiểm nhóm thuộc `MEMBER_GROUPS` hoặc `ADMIN_GROUPS` theo scope; upsert theo `(recipientType, recipientId)`.
  - `NotificationPrefsSection({ scope })`: dạng thẻ thu gọn như `SkillLevelSection`, mỗi nhóm 1 `Switch` (nhóm toàn tin bắt buộc thì hiện khoá + dòng giải thích "tin quan trọng luôn được gửi"), optimistic qua `fireAction`. Phần email để trống chỗ, Task 14 điền.
  - `buildUnvotedReminderText({ sessionDate, startTime, voteDeadline, names }): string`, `buildLowAttendanceText({ sessionDate, startTime, headcount, maxPlayers, link }): string` (tiếng Việt, liệt kê tên ngăn bằng dấu phẩy, kèm link `/vote/{id}` tuyệt đối).
  - `ZaloShareButton({ text, zaloGroupUrl })`: `navigator.share({ text })` nếu có; không thì `navigator.clipboard.writeText(text)` + `toast.success` (chuỗi i18n "Đã chép, dán vào nhóm Zalo"), và nếu `zaloGroupUrl` có thì mở link đó sau khi chép. Đặt ở trang chi tiết buổi của admin cạnh danh sách "chưa vote".
  - Khe nút trong `NotificationRow` (scope admin): kind `unvoted_before_deadline` → `ZaloShareButton` với `buildUnvotedReminderText` từ payload (`sessionDate`, `startTime`, `voteDeadline`, `names`); kind `low_attendance` → `buildLowAttendanceText` (`sessionDate`, `startTime`, `headcount`, `maxPlayers`, link từ `entityId`). `zaloGroupUrl` đi từ admin layout (server đọc setting) xuống `NotificationBell` qua prop. Hai kind này do Task 18 tạo; nút đã sẵn từ đây.

- [ ] **Step 1: Test đỏ:**
  - `prefs: member cannot mute an admin group; muting session then notify(session_opened) skips the member`
  - `unvoted text lists names and deadline in VN time` (`TZ=UTC`)
  - `share button falls back to clipboard when navigator.share is missing`
  - `admin row for unvoted_before_deadline renders a share button whose text lists the payload names`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): add notification preferences and zalo share helper`

### Task 11: Cầu dưới ngưỡng

**Files:**
- Create: `src/lib/inventory-stock.ts` (chuyển nguyên phần tính của `getStockByBrand` ra hàm nhận `db`), `src/lib/notifications/inventory-events.ts`
- Modify: `src/actions/inventory.ts` (`getStockByBrand` gọi hàm mới; `setStockQua`, `updatePurchaseTubes` gọi kiểm sau commit), `src/actions/finance.ts` (`finalizeSession` gọi kiểm sau commit)
- Test: `src/lib/notifications/inventory-events.integration.test.ts`

**Interfaces:**
- Produces:
  - `computeStockByBrand(db: DbOrTx): Promise<StockByBrand[]>`: đúng kết quả `getStockByBrand` hôm nay (không auth bên trong); `getStockByBrand` = `requireAdmin` + gọi hàm này.
  - `checkLowStockAndNotify(db: DbOrTx): Promise<void>`: ngưỡng từ setting `lowStockThresholdQua`; hãng đang dùng có `rawStockQua` dưới ngưỡng → `low_stock` (`brandName`, `stockQua`) dedup `lowstock:b{brandId}:p{mã lần nhập gần nhất hoặc 0}` (nhập cầu mới thì chu kỳ mới).
  - Gọi qua `runAfterResponse(() => checkLowStockAndNotify(db))` sau commit, chỉ khi cờ bật (tin suy ra, không phải nghiệp vụ tiền; ghi ngoài tx là chủ ý, comment lý do). Cờ tắt thì không quét kho.

- [ ] **Step 1: Test đỏ:**
  - `computeStockByBrand matches the previous getStockByBrand output on the same data` (chụp kết quả hàm cũ trước khi tách, so bằng nhau)
  - `low stock notifies once per purchase cycle; a new purchase then low again notifies again`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS + full `pnpm test`; riêng các file test chốt sổ (`finalize-*`) và kho cũ phải xanh mà KHÔNG thêm mock `next/server`.
- [ ] **Step 5:** `finance-invariant-reviewer` → PASS.
- [ ] **Step 6: Commit** `feat(notifications): alert admins when shuttlecock stock runs low`

### Task 12: Cổng N1a, e2e, chuẩn bị deploy

**Files:**
- Create: `e2e/notifications-bell.spec.ts`
- Modify: ledger SDD

- [ ] **Step 1: e2e** (seed SQL thô trên `e2e/local.db` như `e2e/venue-directory.spec.ts`, dọn theo tiền tố):
  - `bell hidden while notificationsEnabled is off` (member + admin)
  - `admin cancels a session; voter sees unread badge, opens sheet at 390px, taps the row, lands on /vote/{id}, badge clears`
  - `admin bell lists a capacity alert after a seeded vote fills the session`
- [ ] **Step 2:** 4 cổng + e2e, đọc exit code từng lệnh: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. Expected: tất cả 0, e2e cũ xanh như Task 0.
- [ ] **Step 3:** Agent `mobile-ui-reviewer` trên các file `.tsx` mới/sửa → không vi phạm nặng. Review cả phần A (requesting-code-review).
- [ ] **Step 4: Commit** `test(e2e): cover the notification bell`
- [ ] **Step 5: Deploy N1a (cần user OK từng bước, KHÔNG tự làm):** điều kiện trước: G2a đã ở `main` VÀ standby đã có 0027 (việc của phiên G2a/standby, kiểm bằng `check-standby`). Rồi: rebase lên `origin/main` → chạy lại cổng → `scripts/backup-local.mjs` → `apply-migration --dry-run` prod và standby chỉ thấy 0028 (standby còn thiếu 0027 thì DỪNG, báo user) → áp prod + standby → kiểm `sqlite_master` cả hai → nếu D1 dự phòng đã được dựng lúc đó thì áp 0028 cho D1 hoặc loại 4 bảng thông báo khỏi bản dump D1 (dữ liệu suy ra) → merge + push `main` (tự deploy) → smoke prod (chuông ẩn vì công tắc tắt). Bật công tắc khi user muốn.

---

# Phần B: N1b, email + nhắc hẹn giờ + cron hằng ngày

### Task 13: Mailer trả kết quả rõ và mẫu email thông báo

**Files:**
- Modify: `src/lib/mailer.ts`
- Create: `src/lib/notifications/email-render.ts`
- Test: `src/lib/mailer.test.ts` (thêm case), `src/lib/notifications/email-render.test.ts`

**Interfaces:**
- Produces:
  - `type MailOutcome = { ok: true } | { ok: false; code: "not_configured" | "transient" | "permanent" }`.
  - `sendMail(msg: { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }): Promise<MailOutcome>`: không bao giờ throw. Phân loại lỗi nodemailer: `responseCode` 5xx hoặc `EENVELOPE` → `permanent`; còn lại (mạng, 4xx, timeout) → `transient`. `sendPasswordResetEmail` và `sendInviteEmail` giữ nguyên chữ ký và hành vi.
  - `renderNotificationEmail(item: NotificationView, ctx: { recipientType: "member" | "admin"; recipientId: number; appUrl: string; unsubscribeUrl: string | null; manageUrl: string; bank?: ResolvedBankAccount }): { subject: string; text: string; html: string }` (`recipientId` dùng cho nội dung QR `FWBB NO {memberId}`; `drainOutbox` lấy từ `notification_deliveries`): dùng `createTranslator({ locale: "vi", messages: vi, namespace: "notifications" })` + `renderNotification`. Mọi giá trị chèn vào HTML phải escape. `session_finalized` / `session_amount_changed` / `debt_reminder` khi số dư âm kèm ảnh QR `getVietQRUrl` với nội dung `FWBB NO {memberId}` và số tiền nợ. Có bản text thuần. Tin không bắt buộc có link huỷ nhận; tin nào cũng có link "Quản lý thông báo" về `/me`.
  - `renderDigestEmail(items: NotificationView[], ctx): { subject; text; html }`.

- [ ] **Step 1: Test đỏ:**
  - `sendMail returns not_configured without SMTP env and never throws`
  - `sendMail maps a 550 reply to permanent and a timeout to transient` (mock transporter)
  - `email escapes a venue name containing <script>`
  - `finalized email with negative balance includes a VietQR image for the owed amount`
  - `optional kinds carry an unsubscribe link; mandatory kinds do not`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): add typed mail results and notification email templates`

### Task 14: Xác minh email nhận thông báo

**Files:**
- Create: `src/lib/notifications/tokens.ts`, `src/lib/notifications/email-eligibility.ts`, `src/app/api/notifications/verify-email/route.ts`
- Modify: `src/actions/notifications.ts` (`requestNotifyEmailVerification`), `notification-prefs-section.tsx` (phần email), i18n. KHÔNG cần sửa các đường đổi email (`updateMyProfile`, `updateMember`, gộp tài khoản, Google, `setPassword` ở `password-auth.ts`): đã xác minh = `notifyEmailVerifiedFor === lower(email)` nên đổi email là tự mất hiệu lực.
- Test: `src/lib/notifications/tokens.test.ts`, `src/app/api/notifications/verify-email/route.integration.test.ts`

**Interfaces:**
- Produces:
  - `sealVerifyToken(memberId: number, email: string, now?: Date): string` và `openVerifyToken(raw: string, now?: Date): { mid: number; eh: string } | null` trong `tokens.ts`: định dạng `base64url(json).hexsig`, HMAC-SHA256 với `USER_COOKIE_SECRET` và tiền tố `"notify-verify:"` (theo mẫu `src/lib/zalo-oauth-state.ts`), so chữ ký timing-safe, hết hạn sau 7 ngày. Payload chỉ có `mid` và `eh = sha256(lower(email))` hex, KHÔNG có email dạng đọc được (link nằm trong log request).
  - `newUnsubToken(): string` (32 byte ngẫu nhiên base64url) và `ensureUnsubToken(db, recipient): Promise<string>` (upsert dòng prefs, chỉ tạo token khi chưa có). Token huỷ nhận là chuỗi ngẫu nhiên lưu ở `notification_prefs.unsubToken`, không chứa id (spec 4.6).
  - `isEmailRecipientEligible(db, r: Recipient): Promise<{ to: string } | null>` trong `email-eligibility.ts`: member: có `email`, `notifyEmailVerifiedFor === lower(email)`, prefs `emailEnabled`; admin: có `admins.email`, prefs `emailEnabled`. Task 15 dùng ở cả lúc xếp hàng và lúc gửi.
  - `requestNotifyEmailVerification(): Promise<{ success: true } | { error: string }>`: member đã đăng nhập, có email, rate limit `notify-verify:{memberId}` 3 lần/giờ; gửi mail chứa `/api/notifications/verify-email?token=...` qua `runAfterResponse`.
  - `GET /api/notifications/verify-email`: token hợp lệ VÀ `eh` khớp sha256 email hiện tại của member → đặt `notifyEmailVerifiedFor = lower(email)`, redirect 303 `/me?email=verified`; sai/hết hạn → `/me?email=invalid`.
  - Phần email trong `NotificationPrefsSection`: hiện email (hoặc nhắc điền email ở mục hồ sơ), trạng thái đã/chưa xác minh, nút "Gửi link xác minh", `Switch` nhận email.
  - Admin: dùng `admins.email` không cần xác minh (admin tự điền ở trang tài khoản).

- [ ] **Step 1: Test đỏ:**
  - `verify token round-trips; tampered token returns null; expires after 7 days; base64-decoding it reveals no email`
  - `verify link for an email the member has since changed does not verify`
  - `admin changes a verified member's email: isEmailRecipientEligible returns null`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): verify member emails before sending notifications`

### Task 15: Outbox email, giờ yên lặng, trần 6 mail

**Files:**
- Create: `src/lib/notifications/outbox.ts`
- Modify: `src/lib/notifications/time.ts` (Task 6 đã tạo; thêm hàm giờ VN, không ghi đè `sessionStartInstant`)
- Modify: `src/lib/notifications/notify.ts` (xếp hàng email), các action đã gọi `notify` không cần sửa
- Test: `src/lib/notifications/outbox.integration.test.ts`, `src/lib/notifications/time.test.ts`

**Interfaces:**
- Produces:
  - `isQuietHourVN(d: Date): boolean` (22:00 ≤ giờ VN hoặc < 07:00), `nextQuietEndVN(d: Date): Date` (07:00 VN kế tiếp).
  - Trong `notify`: với kind có `email: true` và `level !== "digest"`, người nhận qua `isEmailRecipientEligible` (Task 14) → insert `notification_deliveries` cùng tx, `nextAttemptAt` = bây giờ, hoặc `nextQuietEndVN` khi đang giờ yên lặng (trừ `quietHoursBypassSameDay` và buổi diễn ra trong ngày VN hôm nay). Sau đó `scheduleOutboxDrain(ids)`.
  - `scheduleOutboxDrain(deliveryIds: number[]): void` = `runAfterResponse(() => drainOutbox(db, { ids }))`.
  - `drainOutbox(db: DbOrTx, opts: { ids?: number[]; now?: Date; limit?: number }): Promise<{ sent: number; failed: number; deferred: number; skipped: number }>`: lấy `pending` có `nextAttemptAt ≤ now` (theo index `(status, nextAttemptAt)`, mặc định `limit 50`). Kiểm lại `isEmailRecipientEligible` lúc gửi (mất điều kiện → `skipped`). Tin không bắt buộc: đã có ≥ 6 mail tuỳ chọn gửi trong ngày VN cho người đó → `skipped` với `errorCode = "daily_cap"` (tin vẫn ở chuông và vào tóm tắt). Trước khi gửi, giữ chỗ (lease) bằng `UPDATE ... SET attempts = attempts + 1, next_attempt_at = <now + 10 phút> WHERE id = ? AND status = 'pending' AND next_attempt_at <= <now> RETURNING`; không nhận được dòng thì bỏ qua. Nhờ đẩy `next_attempt_at` lên, một lần drain khác chạy SAU khi dòng đã được giữ cũng không gửi lại; lần gửi bị sập giữa chừng sẽ được thử lại khi hết hạn giữ chỗ. Gửi qua `sendMail`; tin không bắt buộc kèm header `List-Unsubscribe: <{appUrl}/api/notifications/unsubscribe?token={unsubToken}>` và `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (token qua `ensureUnsubToken`). `ok` → `sent` + `sentAt`. `transient` → giữ `pending`, `nextAttemptAt` = now + `[5, 30, 120, 720]` phút theo số lần đã thử; lần thử thứ 5 vẫn lỗi → `failed`. `permanent` / `not_configured` → `failed` ngay, ghi `errorCode`.
  - Kích hoạt lại đúng giờ: mỗi khi một delivery được đặt `nextAttemptAt` ở tương lai (thử lại, hoặc dồn vì giờ yên lặng) và QStash có cấu hình, gọi `publishJob({ jobKey: "outbox_retry:" + <nextAttemptAt làm tròn lên phút, dạng YYYY-MM-DDTHH:MM>, runAt })` (Task 17; job trùng phút tự gộp). Không có QStash: các mốc trong ngày chờ lượt cron 06:00 / 07:00 (Task 19), ghi rõ giới hạn này trong `docs/notifications-setup.md`.
  - `getLastEmailFailure(db): Promise<{ at: string; errorCode: string } | null>` (cho trang cài đặt, Task 17 hiển thị).

- [ ] **Step 1: Test đỏ:**
  - `quiet hours: 23:10 VN defers to 07:00 VN; same-day cancellation bypasses` (`TZ=UTC`)
  - `two concurrent drains send each delivery once`
  - `drain A claims and is held inside sendMail; drain B runs to completion; A resumes: sendMail called exactly once` (giữ `sendMail` bằng một promise hoãn)
  - `a transient failure publishes an outbox_retry job at the retry minute` (mock `publishJob`)
  - `transient failure retries with backoff and fails after 5 attempts; permanent fails at once`
  - `seventh optional email of the day is skipped with daily_cap; mandatory still sends`
  - `member who removed their email before send is skipped`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS + full `pnpm test`.
- [ ] **Step 5: Commit** `feat(notifications): send notification emails through an outbox`

### Task 16: Huỷ nhận email 1 chạm

**Files:**
- Create: `src/app/api/notifications/unsubscribe/route.ts`, `src/app/huy-nhan-thong-bao/page.tsx` (ngoài route group, không cần đăng nhập)
- Test: `src/app/api/notifications/unsubscribe/route.integration.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/notifications/unsubscribe?token=` (one-click RFC 8058 và nút trên trang): tìm dòng prefs theo `unsubToken` (uniqueIndex) → đặt `emailEnabled = false`, trả 200. Không tìm thấy → 400. Không cần cookie, không kiểm Origin (mail client gọi thẳng).
  - Trang `/huy-nhan-thong-bao?token=`: GET chỉ hiện nút "Ngừng nhận email" (GET không đổi gì, tránh máy quét link tự huỷ), bấm thì POST rồi hiện "Đã ngừng nhận email. Thông báo vẫn có trên chuông của bạn." kèm link `/me` để bật lại.

- [ ] **Step 1: Test đỏ:**
  - `POST with a valid token turns email off for that recipient only`
  - `GET page does not change prefs`
  - `invalid token returns 400`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): add one-click email unsubscribe`

### Task 17: QStash: hẹn, huỷ, route nhận có kiểm chữ ký

**Files:**
- Modify: `package.json` (`@upstash/qstash`, ghim đúng phiên bản đã phát hành ≥ 2 tuần)
- Create: `src/lib/notifications/qstash.ts`, `src/lib/notifications/jobs.ts`, `src/app/api/notifications/jobs/route.ts`
- Modify (điểm móc `rescheduleSessionJobs`): `src/actions/sessions.ts` (`createSessionManually`, `getNextSession`, `getAdminUpcomingSession`, `setSessionTime`, `setVoteDeadline`, `extendVoteDeadline`, `lockVoteNow`, `cancelSession`, `reopenSession`, `unlockSession`, `setSessionMaxPlayers`, `deleteSession`), `src/actions/finance.ts` (`finalizeSession`), `src/app/api/cron/create-session/route.ts`, `src/app/(admin)/admin/settings/page.tsx` (cảnh báo cấu hình)
- Test: `src/lib/notifications/jobs.test.ts`, `src/lib/notifications/jobs.integration.test.ts`, `src/app/api/notifications/jobs/route.integration.test.ts`

Đọc README và kiểu trong `node_modules/@upstash/qstash` trước khi viết (publish có `notBefore`/`delay`, `deduplicationId`; huỷ message; `Receiver.verify`). QStash gói free hẹn tối đa 7 ngày.

**Interfaces:**
- Produces:
  - `getQstashConfig(): { token: string; currentSigningKey: string; nextSigningKey: string; baseUrl?: string } | null` (thiếu biến nào → `null`).
  - `publishJob(job: { jobKey: string; runAt: Date }): Promise<{ messageId: string } | null>`: đích `${NEXT_PUBLIC_APP_URL}/api/notifications/jobs`, body JSON `{ jobKey, runAt: runAt.toISOString() }`, `deduplicationId = \`${jobKey}:${runAt.toISOString()}\`` (đổi giờ cùng key vẫn đăng được message mới). Không cấu hình hoặc `runAt` > now + 7 ngày → `null`. Job `outbox_retry:*` (Task 15) cũng đăng qua hàm này, kèm 1 dòng `scheduled_jobs` (`kind: "outbox_retry"`, `sessionId: null`).
  - `cancelJobMessage(messageId: string): Promise<void>` (best-effort, nuốt lỗi có log mã; an toàn vì job cũ tự bỏ khi vân tay lệch).
  - `verifyQstashRequest(rawBody: string, signature: string | null): Promise<boolean>`: `Receiver` với cả 2 khoá, `url` = URL đích ở trên; mọi lỗi → `false`.
  - `sessionFingerprint(s: { date: string; startTime: string; voteDeadline: string | null }): string` (8 ký tự hex sha256 của `date|startTime|voteDeadline`). KHÔNG chứa `status`: trạng thái được `runJob` đọc lại lúc chạy, và `desiredSessionJobs` trả rỗng cho buổi hủy/đã chốt (nếu chứa `status` thì `confirmSession` sẽ làm lệch mọi job).
  - `type SessionJobKind = "vote_due_24h" | "vote_due_2h" | "court_lock" | "day_morning" | "day_3h"`.
  - `desiredSessionJobs(session, settings: { courtLockHoursBefore: number }, now: Date): { kind: SessionJobKind; jobKey: string; runAt: Date }[]` (thuần): `vote_due_24h` = hạn vote - 24h, `vote_due_2h` = hạn - 2h (không có hạn → bỏ cả hai), `court_lock` = `courtLockAt(...)`, `day_morning` = 08:00 VN ngày chơi, `day_3h` = giờ bắt đầu - 3h; chỉ lấy mốc > now; buổi `cancelled`/`completed` → rỗng. `jobKey = ${kind}:s{sid}:${fp}`, riêng `court_lock` là `court_lock:s{sid}:h{courtLockHoursBefore}:${fp}` (đổi setting thì job cũ thành cũ).
  - `rescheduleSessionJobs(db, sessionId, now?, gate?)`: (1) job `scheduled` của buổi có `jobKey` không còn trong danh sách mong muốn → `cancelled` + `cancelJobMessage(messageId)`; (2) với mỗi job mong muốn: upsert theo `jobKey`; khi xung đột thì đặt `status = 'scheduled'` và nếu `runAt` đổi hoặc dòng không còn `scheduled` (ví dụ `cancelled` rồi đổi giờ ngược lại) thì huỷ `messageId` cũ và đặt `messageId = null`; (3) mọi dòng mong muốn có `messageId = null` và `runAt ≤ now + 7 ngày` → `publishJob` rồi lưu `messageId` (dòng xa hơn 7 ngày giữ `null`, cron hằng ngày đăng sau). Gọi qua `runAfterResponse` sau commit ở mọi điểm móc trong Files; với setting `courtLockHoursBefore` thì cron sáng hôm sau tự hẹn lại (key mới), job cũ tự bỏ.
  - `runJob(db, job, now): Promise<"done" | "skipped">` trong `jobs.ts`: Task 17 viết khung với đúng chữ ký này (kind chưa hỗ trợ → `"skipped"`), Task 18 điền các kind buổi, Task 19 điền `weekly_summary` và `outbox_retry`.
  - `POST /api/notifications/jobs`: đọc `await req.text()` → `verifyQstashRequest` TRƯỚC mọi truy cập DB; sai → 401. Công tắc tắt → 200 `{ skipped: "disabled" }`. Tìm job theo `jobKey`; không có, không còn `scheduled`, hoặc `runAt` trong DB khác `runAt` trong body (message cũ của lần hẹn trước) → 200 noop. Gọi `runJob`, đặt `done` / `skipped`. Lỗi → 500 để QStash thử lại (an toàn nhờ dedup tin).
  - Cảnh báo cấu hình: trang `/admin/settings` hiện `InlineNotice tone="warning"` khi công tắc bật mà `getQstashConfig()` null ("Nhắc đúng giờ đang chạy theo lịch hằng ngày vì thiếu khoá QStash") hoặc SMTP chưa cấu hình, và dòng lỗi mail cuối cùng từ `getLastEmailFailure`.

- [ ] **Step 1: Test đỏ:**
  - `desiredSessionJobs computes VN instants` (`TZ=UTC`, buổi 2026-11-07 20:30, hạn 2026-11-07T16:30 → vote_due_2h `2026-11-07T07:30:00.000Z`, day_morning `2026-11-07T01:00:00.000Z`, day_3h `2026-11-07T10:30:00.000Z`)
  - `changing the start time changes every jobKey; cancelled session wants no jobs; confirmSession changes no jobKey`
  - `changing courtLockHoursBefore changes only the court_lock jobKey`
  - `route rejects a missing or forged signature with 401 before touching the DB` (ký JWT HS256 bằng `jose` với claim `iss: "Upstash"`, `sub` = URL đích, `body` = base64url sha256 body, `exp`, `nbf`; khoá sai → 401)
  - `route runs a scheduled job once; a second delivery is a noop; a message carrying an old runAt is a noop`
  - `reschedule cancels stale jobs and publishes only jobs within 7 days` (mock `publishJob`)
  - `time changed then changed back: the cancelled job is revived and republished`
  - `a job stored more than 7 days out is published by a later reschedule once inside the window`
  - `switch off: reschedule writes no scheduled_jobs row and never calls publishJob`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): schedule session reminders with signed qstash jobs`

### Task 18: Các tin hẹn giờ

**Files:**
- Create: `src/lib/notifications/scheduled-events.ts`
- Modify: `src/lib/notifications/jobs.ts` (`runJob`)
- Test: `src/lib/notifications/scheduled-events.integration.test.ts`

**Interfaces:**
- Produces: điền các nhánh buổi của `runJob(db, job: { jobKey; kind; sessionId; payload }, now: Date): Promise<"done" | "skipped">` (khung từ Task 17). Quy tắc đọc lại chỉ áp cho 5 kind buổi: buổi không còn, đã hủy hoặc đã chốt, `fp` hiện tại khác `fp` trong `jobKey`, hoặc đã qua mốc liên quan → `"skipped"`, không gửi. Mọi kiểm "vote còn mở" gọi `isVoteOpen(session, now)` (tham số `now` thêm ở Task 6), không dùng đồng hồ thật.
  - `vote_due_24h` / `vote_due_2h`: chỉ khi vote còn mở và `now <` hạn; người chưa vote nhận `vote_due_soon` (`hoursLeft`). Riêng `vote_due_2h` thêm superadmin nhận `unvoted_before_deadline` (`names`, `voteDeadline`, `sessionDate`, `startTime`) khi còn người chưa vote; nút Zalo trong chuông admin đã có từ Task 10.
  - `court_lock`: `now <` giờ bắt đầu; `headcount < 50% maxPlayers` → superadmin `low_attendance` (`headcount`, `maxPlayers`, `sessionDate`, `startTime`).
  - `day_morning` / `day_3h`: `now <` giờ bắt đầu; người vote chơi nhận `game_day_reminder` (`when`, `courtName`, `mapLink` của sân nếu có).

- [ ] **Step 1: Test đỏ:**
  - `vote_due_2h after admin moved the deadline is skipped`
  - `vote_due_2h notifies non-voters and gives admins the unvoted names`
  - `court_lock with 7/16 players alerts admins; with 8/16 does not`
  - `day_3h for a cancelled session sends nothing`
  - `confirmSession after scheduling: day_3h still sends`
  - `old court_lock job after courtLockHoursBefore changed is skipped`
  - `running the same job twice creates no duplicate notifications`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(notifications): send scheduled vote, court and game-day reminders`

### Task 19: Cron hằng ngày (dự phòng + nhắc nợ + tóm tắt + dọn dẹp)

**Files:**
- Create: `src/app/api/cron/notifications-daily/route.ts`, `src/app/api/cron/notifications-mail/route.ts`, `src/lib/notifications/daily.ts`, `src/lib/notifications/debt-age.ts`, `src/lib/court-rent-report.ts`, `src/lib/reconcile-core.ts`
- Modify: `vercel.json` (thêm `{ "path": "/api/cron/notifications-daily", "schedule": "0 23 * * *" }` = 06:00 VN và `{ "path": "/api/cron/notifications-mail", "schedule": "0 0 * * *" }` = 07:00 VN; cả hai lệch tối đa 59 phút), `src/lib/notifications/jobs.ts` (nhánh `weekly_summary`, `outbox_retry` của `runJob`), `src/actions/court-rent.ts` (`getCourtRentReport` = auth + gọi lõi), `src/actions/reconcile-fund.ts` (`reconcileFund` = auth + gọi lõi), `.claude/agents/finance-invariant-reviewer.md` (ghi I1-I10 nay nằm ở `src/lib/reconcile-core.ts`)
- Test: `src/lib/notifications/daily.integration.test.ts`, `src/lib/notifications/debt-age.test.ts`, `src/app/api/cron/notifications-daily/route.test.ts`

**Interfaces:**
- Produces:
  - `computeCourtRentReport(db, year): Promise<CourtRentReport>` và `runReconcile(db): Promise<ReconcileReport>`: chuyển nguyên thân hàm hiện tại, không đổi logic.
  - `debtSinceYmd(rows: FinancialTransactionRow[], todayYmd: string): string | null` (thuần, `debt-age.ts`): duyệt ledger của 1 member theo thời gian bằng đúng quy tắc của `computeBalanceFromTransactions` (bỏ cặp đảo, bỏ `bank_payment_received`); trả ngày VN của giao dịch làm số dư chuyển sang âm lần gần nhất (sau lần cuối số dư ≥ 0), `null` nếu số dư hiện tại ≥ 0. `debtAgeDays = số ngày giữa debtSinceYmd và todayYmd`.
  - Mọi ngày/thứ/tháng suy từ `now` dùng `ymdInVN`, `ymdInVNAddDays`, `dayOfWeekVN` (`src/lib/date-format.ts`), không `getDay()` / `toISOString().slice(0, 10)` (cron chạy 23:xx UTC = ngày hôm sau ở VN).
  - `runDailyNotifications(db, now: Date): Promise<DailyReport>` (cron 06:00) với `DailyReport = { opened: number; jobsRun: number; rescheduled: number; debtReminders: number; drained: number; rentChecked: boolean; reconcileChecked: boolean; cleaned: number; errors: string[] }`. Mỗi bước try/catch riêng, ghi mã lỗi vào `errors` (một bước hỏng không chặn bước khác):
    1. Buổi `voting`/`confirmed` trong 48h tới (truy vấn theo `sessions.date`, có index): `notifySessionOpened`.
    2. Job `scheduled` có `runAt < now - 10 phút` (index `(status, runAt)`): `runJob` (bù QStash lỡ hoặc thiếu khoá).
    3. Buổi từ hôm nay tới 8 ngày tới: `rescheduleSessionJobs`.
    4. Nhắc nợ (quyết định 11): đọc ledger 1 lần cho mọi member (1 truy vấn, cùng cỡ với `runReconcile`), tính số dư và `debtAgeDays`; số dư ≤ -10.000 và tuổi nợ ∈ {1, 7, 14, 30} → `debt_reminder` (`debt: -balance`, `day`), dedup `debt:m{mid}:{YYYY-MM-DD}`. Quá 30 ngày thì không nhắc member nữa.
    5. Thứ 2 (theo `dayOfWeekVN`): đăng job `weekly_summary` lúc 08:00 VN qua QStash (không có QStash thì chạy luôn): superadmin nhận danh sách member nợ quá 30 ngày (dùng cùng `debtAgeDays`), buổi tuần tới, số việc chờ duyệt.
    6. `drainOutbox(db, { now })`.
    7. Ngày 1 tới 5 hằng tháng VN: `computeCourtRentReport` của tháng VN trước còn `remaining > 0` → `court_rent_unpaid` (dedup `rent:{YYYY-MM}`).
    8. `runReconcile(db)` có issue `error` → `reconcile_failed` (mã lỗi, không kèm số liệu member) dedup `reconcile:{YYYY-MM-DD}` (quyết định 12).
    9. Dọn (quyết định 13), theo index sẵn có: `notifications` đã đọc và `createdAt` < now - 90 ngày; `notification_deliveries` khác `pending` và `createdAt` < now - 30 ngày; `scheduled_jobs` khác `scheduled` và `updatedAt` < now - 30 ngày. Xoá mỗi bảng tối đa 500 dòng mỗi lần chạy.
  - `runMorningMail(db, now: Date): Promise<{ digests: number; drained: number }>` (cron 07:00, sau giờ yên lặng): (a) `drainOutbox(db, { now })` gửi các mail đã dồn tới 07:00; (b) tóm tắt ngày: mỗi người có email hợp lệ và có tin `level: "digest"` hoặc delivery `skipped` vì `daily_cap`, chưa đọc, tạo trong 24h qua → 1 mail `renderDigestEmail`. Claim bằng dòng `scheduled_jobs` `jobKey = digest:{YYYY-MM-DD}:{m|a}{id}` insert với `status: "done"` (insert-first, trùng thì bỏ), để bước 2 của cron 06:00 không bao giờ nhặt nó.
  - Nhánh `runJob`: `weekly_summary` (không đọc lại buổi) và `outbox_retry` (= `drainOutbox(db, { now })`).
  - Hai route GET: kiểm `CRON_SECRET` y như `src/app/api/cron/create-session/route.ts` (thiếu biến → 500, sai → 401), công tắc tắt → 200 `{ skipped: "disabled" }`, trả report. `export const maxDuration = 60`.

- [ ] **Step 1: Test đỏ** (chạy với `TZ=UTC`, `now` cố định ở 23:30Z):
  - `computeCourtRentReport and runReconcile return exactly what the actions returned before` (chụp kết quả trước khi tách)
  - `debtSinceYmd: member who went negative on Nov 2, topped up, went negative again on Nov 5 → Nov 5; balance ≥ 0 → null`
  - `member playing Mon/Wed/Fri who stays at -60.000 gets one reminder on each of day 1, 7, 14, 30 of debt age and none after; never two in one day`
  - `no reminder for -9.000 or for a member who paid`
  - `now = 2026-11-08T23:30:00Z (Mon Nov 9 VN) creates weekly_summary; now = 2026-11-30T23:30:00Z (Dec 1 VN) checks November court rent`
  - `missed scheduled job older than 10 minutes is run by the daily sweep; digest claim rows are never picked by the sweep`
  - `digest is sent once per person per day even if the mail cron runs twice`
  - `a 23:10 VN email deferred to 07:00 is sent by runMorningMail`
  - `cleanup removes only read notifications older than 90 days and finished deliveries/jobs older than 30 days`
  - `route: missing CRON_SECRET → 500, wrong bearer → 401, switch off → skipped`
- [ ] **Step 2:** FAIL. **Step 3:** viết. **Step 4:** PASS + full `pnpm test`.
- [ ] **Step 5:** `finance-invariant-reviewer` cho `court-rent.ts`, `reconcile-fund.ts` → PASS.
- [ ] **Step 6: Commit** `feat(notifications): add daily notification cron with debt reminders and digests`

### Task 20: Cổng N1b, hướng dẫn cấu hình, chuẩn bị deploy

**Files:**
- Create: `e2e/notifications-prefs.spec.ts`, `docs/notifications-setup.md` (tiếng Việt, cho user: tạo tài khoản Brevo, thêm SPF/DKIM/DMARC cho `lwcifer.io.vn`, đặt `SMTP_*`/`MAIL_FROM` trên Vercel; tạo QStash, đặt 3 khoá; kiểm `CRON_SECRET`; cách bật công tắc)
- Modify: `docs/database.md` (mô tả 4 bảng mới)

- [ ] **Step 1: e2e:** `member mutes the session group in /me and the toggle survives reload`; `unsubscribe page GET shows a button and changes nothing until pressed`.
- [ ] **Step 2:** 4 cổng + full e2e, đọc exit code từng lệnh. Expected: tất cả 0.
- [ ] **Step 3:** Review cả nhánh (requesting-code-review, model mạnh nhất) + `finance-invariant-reviewer` trên toàn diff tiền + `mobile-ui-reviewer`.
- [ ] **Step 4: Commit** `docs(notifications): add setup guide and document notification tables`
- [ ] **Step 5: Deploy N1b (user OK từng bước):** không có migration mới. User đặt env (Brevo, QStash) trên Vercel trước → rebase `origin/main` → cổng → push `main` → kiểm cron mới hiện trong Vercel → smoke: bật công tắc, user tự gửi 1 mail xác minh tới email của mình và bấm link. Không tạo hay hủy buổi giả trên prod để thử.
