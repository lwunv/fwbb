# G2b Buổi giao lưu (mở, tìm, đăng ký, chốt phí, điểm danh) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member đã duyệt mở được buổi giao lưu tại một sân trong danh bạ; ai cũng tìm được buổi quanh mình (danh sách và ghim trên bản đồ G3); người đã đăng nhập (kể cả tài khoản giao lưu chờ duyệt) đăng ký, vào danh sách chờ, huỷ; host duyệt, nhận cọc, chốt phí, đánh dấu đã trả, điểm danh; người tham gia thấy số tiền và QR chuyển khoản tới tài khoản của host. Có thông báo cho các việc trên, có chặn và báo cáo. Toàn bộ nằm sau cờ `exchangeEnabled` (mặc định tắt).

**Architecture:** Hai bảng chính `exchange_events`, `exchange_registrations` cùng `host_blocks`, `abuse_reports` (migration 0029, chỉ thêm). Logic thuần nằm ở `src/lib/exchange-fee.ts` (phí, gọi `computeGroupPlayRates`) và `src/lib/exchange/slots.ts` (đếm slot, slot giữ cho nữ, đẩy danh sách chờ first-fit). Lõi nghiệp vụ nhận `tx` (`settleEvent`, `cancelEventCore`, `repointExchangeRows`) nằm ở `src/lib/exchange/` (server-only, không `"use server"`); file trong `src/actions/` chỉ là vỏ server action tự kiểm quyền rồi gọi lõi. Mọi thao tác ghi chạy `settleEvent(tx, …)` trong cùng `db.transaction` để đẩy danh sách chờ và cập nhật `open/full`, rồi gọi `notify(tx, …)` của N1 ngay trong transaction đó. Trang công khai đọc qua `unstable_cache` theo ô lưới toạ độ (cùng mẫu `getCandidatesNearCell` của `src/actions/venues.ts`), mọi thao tác ghi gọi `updateTag("exchange")`. Không có cột tiền nào chạm `financial_transactions` hay `session_debts`.

**Tech Stack:** Next.js 16.2.1 App Router (server actions, `unstable_cache`, `updateTag`), Drizzle + Turso (libsql), zod, react-hook-form, next-intl (vi/en/zh), @tanstack/react-query 5, nuqs, framer-motion, maplibre-gl (qua `LazyMapView` của G3), Cloudflare Turnstile (`verifyTurnstile` + `TurnstileWidget` của G2a), vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-exchange-events-nearby-design.md` (4.3, 4.4, 4.5, 4.6, 4.6b, 4.6c phần lớp chặn, 4.6e, 4.7, 4.8, mục 6). Thông báo: `docs/superpowers/specs/2026-11-04-notifications-design.md` (4.10 mục N2: tin giao lưu làm cùng G2b). Bản rà plan: `.superpowers/g2b/plan-review.md` (29 mục, xử lý ở cuối plan).

## Global Constraints

- **Nơi làm:** worktree `D:/Lwcifer/LW/FWBB-g2b`, nhánh `feat/g2b-events` (từ `feat/notifications` b2d1206 = G2a + N1). Task 0 merge `feat/g3-map` ở HEAD lúc bắt đầu thực thi (coordinator sẽ merge đợt sửa `feat/g3-ui` vào `feat/g3-map` trước đó; G2b KHÔNG merge `feat/g3-ui` trực tiếp). KHÔNG sửa gì ở `D:/Lwcifer/LW/FWBB-g3` hay `D:/Lwcifer/LW/FWBB-g3ui`. Không push, không merge vào `main`, không deploy (user 4/11: chỉ lên prod khi xong cả G2a+N1+G3+G2b+G2c+G2d).
- **Env và DB:** KHÔNG đọc, tạo hay sửa file `.env*` (`D:/Lwcifer/LW/FWBB/.env.local` trỏ DB PROD). Env test ở `.superpowers/g2b/test-env.sh` và `.superpowers/g2b/local-db.env` (copy từ `D:/Lwcifer/LW/FWBB-notify/.superpowers/n1/`). Mọi lệnh app/script DB phải có `TURSO_DATABASE_URL=file:e2e/local.db`; `scripts/apply-migration.mjs` luôn kèm `--env=.superpowers/g2b/local-db.env`.
- **Cờ:** mọi URL mới (`/giao-luu/*` đã 404 qua `src/app/(exchange)/giao-luu/layout.tsx`; `/admin/giao-luu` có layout riêng kiểm cờ), mọi server action mới (dòng đầu gọi `exchangeGate()`), mọi phần thêm vào màn cũ (`/san`, thẻ sân, `/me`, menu nhóm, menu admin, cài đặt thông báo, route xác minh email) chỉ hiện hoặc chạy khi cờ bật. Màn cũ nhận cờ qua prop do server component đọc 1 lần, KHÔNG đọc cờ trong server action được gọi lặp từ client (mỗi lần đọc là 1 truy vấn `app_settings`, `getSettings` chỉ dedup trong 1 request).
- **Không đổi hành vi cũ:** Task 1 viết test giữ nguyên hành vi TRƯỚC khi đụng code dùng chung. Về sau KHÔNG sửa expected của các test đó và của test có sẵn trên nhánh (chỉ thêm case). Ngoại lệ có chủ đích duy nhất: danh sách mục menu của tài khoản giao lưu (Task 18, spec 4.6b đòi "Cá nhân"), ghi lý do trong commit.
- **Ranh giới server action (C3):** file trong `src/actions/` mở đầu `"use server"` nên MỌI export là endpoint POST. Chỉ export server action có tự kiểm quyền. Hàm nhận `tx` hoặc làm lõi dùng chung đặt ở `src/lib/exchange/` (đầu file `import "server-only"`). Người thực hiện (host, admin, member) luôn suy ra từ cookie phiên (`requireApprovedMember`, `requireExchangeMember`, `requireAdmin`), KHÔNG BAO GIỜ nhận từ input của client (không có trường `actor`, `memberId`, `hostId` trong input).
- **Thứ tự kiểm ở mọi action ghi của luồng giao lưu:** cờ → quyền → zod → Turnstile (chỉ ở mở buổi, đăng ký, báo cáo) → rate limit (`checkRateLimit`, ghi DB nên sau Turnstile) → `db.transaction`. Cờ và quyền đứng trước Turnstile là lệch spec 4.6e có chủ đích (quyết định 30). Tài khoản giao lưu (`pending`) chỉ làm được: đăng ký, huỷ đăng ký của mình, báo cáo, xem "Giao lưu của tôi", chỉnh tin thông báo của mình. Host action luôn kiểm `event.hostMemberId === member.id`.
- **Host còn hiệu lực (I14):** buổi chỉ hiện công khai và nhận đăng ký khi host `is_active = 1 AND approval_status = 'approved'` (join `members` theo PK).
- **Tiền (spec quyết định 1):** KHÔNG ghi `financial_transactions`, KHÔNG đụng `session_debts`, `cost-calculator.ts`, `group-policy.ts`, `finalizeSession`, `payment-matcher`. Tiền là số nguyên VND, zod `z.number().int().min(0)`, không `parseFloat`. Cách chia đi qua `computeGroupPlayRates` (không công thức chia mới, không sửa engine). Server luôn tính lại phí từ DB. Task 3, 4, 8, 12, 21 phải qua agent `finance-invariant-reviewer` (PASS) trước khi đóng, prompt ghi rõ: "Review `git -C D:/Lwcifer/LW/FWBB-g2b diff <base>..HEAD -- <files>`, đọc file dưới `D:/Lwcifer/LW/FWBB-g2b`, bỏ qua đường dẫn mặc định. Khẳng định không ghi financial_transactions/session_debts, mọi số tiền là số nguyên, mergeMember vẫn chuyển đủ nợ và sổ quỹ."
- **Migration:** chỉ DDL, chỉ thêm, số **0029** (mới nhất trên nhánh là 0028; G3 không có migration). Enum ở TypeScript, unique bằng `uniqueIndex` riêng, CHECK chỉ trong `CREATE TABLE` của bảng mới, không `ALTER TABLE` bảng cũ. Không seed. Sau khi áp lên `e2e/local.db`, so `sqlite_master` với mốc Task 0: chỉ có thêm.
- **Cache:** giá trị trả qua `unstable_cache` phải là JSON thuần (không `Map`, `Set`, `Date`, `undefined` có nghĩa); `unstable_cache` lưu bằng `JSON.stringify`. Dựng `Map` bên ngoài hàm cache. Test hàm cache bằng mock `next/cache` có serialize JSON (không passthrough).
- **Thông báo:** `notify(tx, …)` trong cùng transaction nghiệp vụ, có `dedupBase`. Action đọc cờ thông báo 1 lần (`isNotificationsEnabled(tx)`) rồi truyền `gate`. Payload cho member không chứa tên hay tiền của người khác (host chỉ nhận số người).
- **Quota Turso:** không `usePolling`, không `refetchInterval`, không tự làm mới theo giờ. react-query `staleTime: 60_000`, `placeholderData: keepPreviousData` như `venue-directory.tsx` của G3. Trang công khai qua `unstable_cache` (`revalidate: 60`, tag `"exchange"`); action ghi gọi `updateTag("exchange")` sau commit. Tìm kiếm công khai không có rate limit theo IP (quyết định 31). Mọi truy vấn mới đi theo index ở Task 2; danh sách tối đa 50 dòng.
- **Giờ:** form nhận `YYYY-MM-DD` + `HH:MM` giờ VN, đổi sang instant bằng `sessionStartInstant(date, time)` (`src/lib/notifications/time.ts`). DB lưu ISO UTC có `Z`, so sánh bằng `Date`. Hiển thị theo `Asia/Ho_Chi_Minh`. Test giờ chạy cả với `TZ=UTC`.
- **Riêng tư (4.6, 4.6e):** payload công khai đi qua whitelist `PublicExchangeEvent` (Task 9), không spread row. Không sđt/email member. Liên hệ host, link nhóm Zalo và tên người tham gia chỉ cho host và đăng ký `approved`. URL buổi dùng `public_code` ngẫu nhiên. Vị trí người dùng không lưu, không log. Log kiểu `console.error("[Exchange] <mã>", { eventId })`, không `console.log`.
- **Turnstile ở client (I1):** action có Turnstile gọi bằng `fireAction(..., { retry: false })` hoặc gọi thẳng (token chỉ dùng 1 lần; `fireAction` mặc định gửi lại cùng closure). Sau mỗi lần gửi, dù thành công hay lỗi, tăng `resetKey` của `TurnstileWidget` để lấy token mới.
- **Giao diện:** mobile-first, vùng chạm ≥ 44px, chữ ≥ 16px, nút chính dính đáy trên mobile, `Sheet side="bottom"` trên mobile và dialog/panel từ `sm:` (`useIsMobile()`), skeleton đúng kích thước, empty state có nút hành động, framer-motion, màu từ CSS variables. Thao tác host và huỷ đăng ký optimistic qua `fireAction`, rollback + `toast.error`. Chuỗi đủ `vi`/`en`/`zh` trong namespace `exchange` (lỗi ở `exchange.errors.*`; mỗi task server tự thêm key lỗi của mình), `src/i18n/locale-parity.test.ts` xanh. Không em dash trong chuỗi giao diện.
- **Next 16:** đọc trước khi code `D:/Lwcifer/LW/FWBB/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/{unstable_cache,updateTag,not-found}.md`.
- **Commit:** Conventional Commits 1 dòng, không body, không trailer. Implementer tự commit đúng message của plan.

### Quy ước dùng chung

| Việc | Quy ước |
|---|---|
| Hằng số | `src/lib/exchange/constants.ts` (Task 2) là nguồn duy nhất cho enum và giới hạn |
| Trạng thái giữ slot | `HOLDING = ["pending", "approved"]`; `waitlist` không giữ slot |
| Đầu người | `heads = maleCount + femaleCount` (gồm người đăng ký). Chưa khai hoặc LGBT tính là nam |
| Host | Không phải dòng đăng ký. `hostHeads` (mặc định 1): không chiếm slot, có trong mẫu số khi chia, không có `feeAmount` |
| Kết quả action | `{ success: true, data? } \| { error: string }` (+ `needsConfirm` riêng ở chốt phí), lỗi đã dịch |
| Đẩy danh sách chờ | Chỉ khi buổi `open/full`, chưa ẩn, host còn hiệu lực và `now < startAt` (I11) |
| `dedupBase` | `xreg:r{regId}:new:{token}`, `xreg:r{regId}:{approved\|rejected\|promoted}:{token}`, `xcancel:r{regId}:{token}`, `xfee:e{eventId}:n{lockCount}`, `xevcancel:e{eventId}`, `xhide:e{eventId}:{token}`, `xreport:{reportId}`. `token` = ISO thời điểm hành động |

## Review Focus

1. **Hai người cùng bấm đăng ký slot cuối, hoặc một người gửi lại cùng input:** đúng một người vào `pending/approved`, người kia vào `waitlist`; không dòng trùng; tổng đầu người giữ slot không vượt `slotsTotal`. Test ở Task 10.
2. **Đầu danh sách chờ là nhóm 3 người, chỉ trống 1 slot; slot nữ giữ chỗ vừa tới hạn và người mới tới đăng ký:** first-fit đẩy người vừa chỗ phía sau; người đang chờ được xét TRƯỚC người mới. Test ở Task 5 (thuần) và Task 10, 11 (qua action, `now` giả).
3. **Chốt phí thiếu người, rồi có người đã trả rời khỏi buổi, mở khoá và chốt lại:** lần đầu trả `needsConfirm`; người đã trả mà không còn bị tính có `feeAmount = null`, nhận tin phí đổi và hiện "cần hoàn" cho host dựa trên `paidAmount`; cọc lớn hơn phí hiện "cần hoàn". Test ở Task 4, 12.
4. **Tài khoản giao lưu hoặc member không phải host gọi thẳng action của host** (duyệt, đã trả, điểm danh, chốt phí, huỷ buổi, bỏ chặn) bằng id đoán được, kể cả gửi thêm trường lạ như `actor`: luôn bị từ chối, không ghi gì. Test IDOR ở Task 7, 8, 11, 12.
5. **Cờ tắt (mặc định sau deploy):** `/giao-luu/*` và `/admin/giao-luu` trả 404; `/san`, thẻ sân, `/me`, menu, cài đặt thông báo, link xác minh email y như trước; tìm sân không thêm truy vấn nào; gộp/xoá member chạy như cũ. Test ở Task 1, 3, 18, 19, 20 và e2e Task 22.

---

### Task 0: Merge bản đồ G3, chuẩn bị env, đo baseline

**Files:** không sửa code ngoài phần giải xung đột merge. Tạo `.superpowers/g2b/` (gitignored).

- [ ] **Step 1:** Trong `D:/Lwcifer/LW/FWBB-g2b`: `git status` sạch (chỉ có file plan chưa theo dõi). Ghi `git rev-parse feat/g3-map` vào ledger rồi `git merge --no-ff feat/g3-map -m "chore: merge feat/g3-map into feat/g2b-events"`. Xung đột thường gặp: `src/i18n/messages/{vi,en,zh}.json` (namespace `venues` của G3, `notifications` của N1: giữ cả hai), `package.json`/`pnpm-lock.yaml` (giữ `maplibre-gl`, rồi `pnpm install`). Không sửa code G3 lúc giải xung đột. Kiểm có mặt: `src/lib/map/{map-points,sovereignty,webgl}.ts`, `src/components/map/{map-view,lazy-map-view}.tsx`, `src/app/(exchange)/san/venue-map-panel.tsx`. Nếu `src/lib/map/webgl.ts` hoặc prop `cooperativeGestures` của `MapView` không có, đợt sửa G3 chưa vào `feat/g3-map`: dừng, báo coordinator.
- [ ] **Step 2:** `pnpm install`. Copy `D:/Lwcifer/LW/FWBB-notify/.superpowers/n1/{test-env.sh,local-db.env}` sang `.superpowers/g2b/`, copy `D:/Lwcifer/LW/FWBB-notify/e2e/local.db` sang `e2e/local.db` khi không có server nào mở file. `git check-ignore .superpowers/g2b/test-env.sh e2e/local.db` in cả hai.
- [ ] **Step 3:** `node scripts/apply-migration.mjs --env=.superpowers/g2b/local-db.env --dry-run`: tới 0028 "applied", không "WOULD APPLY". Lưu `select type, name, tbl_name, sql from sqlite_master order by name` vào `.superpowers/g2b/sqlite-master-before.txt`.
- [ ] **Step 4:** Baseline, mỗi lệnh ghi exit riêng (`cmd > .superpowers/g2b/base-<x>.log 2>&1; echo "x_exit=$?"`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/g2b/test-env.sh && pnpm build`, `source .superpowers/g2b/test-env.sh && pnpm test:e2e`. Expected: exit 0 hết. Ghi số test vào ledger. Đỏ sẵn thì chạy lại trên `feat/notifications` và `feat/g3-map` riêng để tách lỗi do merge hay có sẵn; do merge thì dừng, hỏi.

### Task 1: Test giữ nguyên hành vi cho code dùng chung sẽ đụng tới

Mọi test ở task này phải XANH ngay khi viết. Đỏ nghĩa là hiểu sai code hiện tại: dừng lại.

**Files:**
- Create: `src/lib/notifications/href.characterization.test.ts`, `src/components/notifications/notification-prefs-groups.characterization.test.tsx`, `src/actions/venues-near-shape.characterization.integration.test.ts`, `src/components/layout/nav.characterization.test.tsx`, `src/app/api/notifications/verify-email/verify-email-redirect.characterization.integration.test.ts`
- Create: `src/app/(public)/me/me-exchange-link.tsx` (component `MeExchangeLink({ enabled }: { enabled: boolean })` trả `null` khi `enabled = false`; Task 18 mới cho nội dung), test `me-exchange-link.test.tsx`

- [ ] **Step 1: Viết test:**
  - `notificationHref: every existing kind keeps its current member/admin link` (bảng cứng kết quả hiện tại cho mọi kind trong `NOTIFICATION_KINDS`, `entityId: 7`).
  - `render: every existing kind renders the same title and body` (bảng cứng cho 3 kind có tiền và 1 kind có boolean, locale vi).
  - `prefs section lists exactly session, money, account, venue for a member`.
  - `listVenuesNear returns venue objects with exactly the current keys` (DB test, `PUBLIC_VENUE_KEYS` + `distanceM`) và `listVenuesNear reads app_settings zero times` (spy `db.select` theo bảng).
  - `group nav drawer, exchange nav drawer, admin sidebar and admin mobile nav show the current hrefs` (danh sách cứng của từng nơi).
  - `verify-email link redirects to /me?email=verified for an approved member`.
  - `MeExchangeLink renders nothing when disabled`.
- [ ] **Step 2:** `pnpm test` trên các file trên → PASS hết. Ghi vào ledger danh sách test G3 làm khoá hành vi bản đồ (không được sửa expected ở Task 15, 19): toàn bộ `src/components/map/map-view.test.tsx`, `src/app/(exchange)/san/venue-directory-map.test.tsx`, `src/components/venues/venue-mini-map.test.tsx`, `src/lib/map/map-points.test.ts`.
- [ ] **Step 3: Commit** `test(exchange): pin shared behavior before g2b`

### Task 2: Bảng dữ liệu, migration 0029, hằng số

**Files:**
- Create: `src/lib/exchange/constants.ts`
- Modify: `src/db/schema.ts` (4 bảng mới; thêm `"exchange_event"` vào enum TS `notifications.entityType`, không sinh DDL)
- Create: `src/db/migrations/0029_*.sql` + meta (`pnpm db:generate`)
- Test: `src/db/exchange-schema.integration.test.ts`

**Interfaces:**
- `constants.ts`:
  - `EXCHANGE_EVENT_STATUSES = ["open","full","locked","done","cancelled"]`; `EXCHANGE_REG_STATUSES = ["pending","approved","rejected","waitlist","cancelled","late_cancelled","no_show"]`; `HOLDING_STATUSES = ["pending","approved"]`; `CHARGEABLE_STATUSES = ["approved","no_show","late_cancelled"]`
  - `FEE_MODES = ["fixed","fixed_gender","split_equal","split_female_discount"]`
  - `REPORT_TARGET_TYPES = ["member","event"]` (G2c thêm `comment`, G2d thêm `review`, `venue`, chỉ ở TS); `REPORT_REASONS = ["spam","fake_account","abusive","wrong_info","no_show","other"]`; `REPORT_STATUSES = ["open","resolved","dismissed"]`
  - `MAX_COMPANIONS = 2`, `NEW_ACCOUNT_MAX_WAITING = 2`, `MAX_SLOTS = 60`, `MAX_HOST_HEADS = 10`, `MAX_FEE_PER_HEAD = 2_000_000`, `MAX_TOTAL_COST = 50_000_000`, `LIST_LIMIT = 50`, `CANDIDATE_LIMIT = 200`, `GRID_MARGIN_M = 1500`, `CHECKIN_OPEN_BEFORE_MIN = 60`, `CHECKIN_CLOSE_AFTER_DAYS = 7`
  - `RL_REGISTER = { limit: 10, windowMs: 3_600_000 }`, `RL_OPEN = { limit: 5, windowMs: 86_400_000 }`, `RL_REPORT = { limit: 10, windowMs: 86_400_000 }`; `TS_OPEN = "exchange_open"`, `TS_REGISTER = "exchange_register"`, `TS_REPORT = "exchange_report"`
- Bảng:
  - `exchangeEvents`: `id`; `publicCode` notNull; `idempotencyKey` nullable; `hostMemberId` FK members notNull; `venueId` FK venues notNull; `title` notNull; `description`; `startAt`, `endAt` notNull (ISO UTC); `skillMin`, `skillMax` (enum `SKILL_LEVELS`) nullable; `slotsTotal` notNull; `femaleReservedSlots` default 0; `reserveReleaseAt` nullable; `hostHeads` default 1; `shuttleType`; `feeMode` notNull; `feeAmountMale`, `feeAmountFemale`, `feeFemalePercent`, `estimatedTotalCost`, `minHeads` nullable; `depositAmount` default 0; `registerDeadline`, `cancelDeadline` notNull; `autoApprove`, `allowPlusOnes` boolean default false; `payoutBankBin`, `payoutAccountNo`, `payoutAccountName`, `hostContact`, `zaloGroupLink` nullable; `status` default `"open"`; `lockCount` default 0; `lockedAt`, `doneAt`, `cancelledAt`, `hiddenAt` nullable; `createdAt`, `updatedAt` notNull. Index: unique `public_code`, unique `idempotency_key`, `(status, start_at)`, `(venue_id, start_at)`, `(host_member_id, start_at)`. CHECK: tiền `IS NULL OR >= 0`, `slots_total >= 1`, `female_reserved_slots BETWEEN 0 AND slots_total`, `host_heads >= 0`, `fee_female_percent IS NULL OR BETWEEN 0 AND 100`.
  - `exchangeRegistrations`: `id`; `eventId` FK; `memberId` FK; `status`; `maleCount`, `femaleCount`; `note`; `waitlistPos`; `feeAmount` nullable; `feeWaived` default false; `depositPaid` default false; `depositPaidAt`; `paid` default false; `paidAmount` nullable (số tiền lúc host đánh dấu đã trả, C2); `paidAt`; `checkedIn` default false; `checkedInAt`; `decidedAt`, `cancelledAt`; `createdAt`, `updatedAt`. Index: unique `(event_id, member_id)`, `(event_id, status)`, `(member_id, status)`, `(member_id, checked_in)`. CHECK: `male_count >= 0`, `female_count >= 0`, `male_count + female_count >= 1`, `fee_amount IS NULL OR >= 0`, `paid_amount IS NULL OR >= 0`.
  - `hostBlocks`: `id`, `hostMemberId`, `blockedMemberId` (FK), `createdAt`; unique `(host_member_id, blocked_member_id)`.
  - `abuseReports`: `id`, `reporterMemberId` FK, `targetType`, `targetId`, `reason`, `note`, `status` default `"open"`, `createdAt`, `resolvedAt`; unique `(reporter_member_id, target_type, target_id)`, `(status, created_at)`, `(target_type, target_id)`.

- [ ] **Step 1: Test đỏ** (`sqlite_master` qua `createTestDb()` như `src/db/notifications-schema.integration.test.ts`): `creates the four exchange tables with every declared index`; `registration (event, member) is unique`; `negative fee_amount and paid_amount are rejected`; `male_count + female_count = 0 is rejected`; `female_reserved_slots above slots_total is rejected`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Viết, `pnpm db:generate`. File 0029 chỉ có `CREATE TABLE` và `CREATE [UNIQUE] INDEX`; thấy `ALTER`, `__new_`, `INSERT`, `DROP` là sai, sửa rồi sinh lại.
- [ ] **Step 4:** PASS. `node scripts/apply-migration.mjs --env=.superpowers/g2b/local-db.env` (kiểm "Loaded env from"), so `sqlite_master` với mốc: chỉ thêm.
- [ ] **Step 5: Commit** `feat(exchange): add exchange event tables`

### Task 3: Gộp và xoá member khi có dữ liệu giao lưu (C1)

FK bật thật ở runtime (`src/db/index.ts:28`); `mergeMember` (`src/actions/members.ts`, xoá nguồn sau `repointNotifications`), duyệt kiểu gộp (`src/actions/member-approval.ts`, xoá pending sau `repointNotifications`) và `deleteMember` sẽ lỗi FK nếu không xử lý bảng mới.

**Files:**
- Create: `src/lib/exchange/member-rows.ts` (`import "server-only"`)
- Modify: `src/actions/members.ts` (`mergeMember` gọi `repointExchangeRows` ngay sau `repointNotifications`; `deleteMember` đếm thêm), `src/actions/member-approval.ts` (cùng chỗ), i18n `members.refExchange` (vi/en/zh)
- Test: `src/actions/merge-member-exchange.integration.test.ts`

**Interfaces:**
- `repointExchangeRows(tx: Tx, sourceId: number, targetId: number): Promise<void>`:
  - `exchange_events.host_member_id`: chuyển sang target.
  - `exchange_registrations`: chuyển sang target; trùng `(event_id, target)` thì giữ dòng của target, xoá dòng của nguồn. Nguồn đăng ký vào buổi mà target là host thì dòng đó thành `cancelled` rồi mới chuyển (host không tự đăng ký buổi mình).
  - `host_blocks`: chuyển cả hai cột; trùng cặp thì xoá dòng của nguồn; cặp tự chặn mình (host = blocked) thì xoá.
  - `abuse_reports.reporter_member_id` chuyển sang target, trùng unique thì xoá dòng của nguồn; báo cáo nhắm tới nguồn (`target_type = member`) đổi `target_id` sang target.
- `countExchangeRefs(db: DbOrTx, memberId: number): Promise<number>` (tổng dòng ở 4 bảng). `deleteMember` chặn khi > 0 với chuỗi `refExchange` như các ref khác.

- [ ] **Step 1: Test đỏ:** `mergeMember with exchange registrations, a hosted event, blocks and reports moves them to the target`; `merge keeps the target's registration when both registered for the same event`; `merge cancels the source's registration to an event the target hosts`; `approve-as-merge of a pending exchange account with a registration succeeds`; `deleteMember with exchange rows returns the friendly ref error and deletes nothing`; `merge of members with no exchange rows behaves as before` (nợ, sổ quỹ, vote chuyển y như test merge hiện có).
- [ ] **Step 2:** FAIL (lỗi FK).
- [ ] **Step 3:** Viết. Không đổi thứ tự hay logic tiền của `mergeMember`, chỉ thêm 1 lệnh gọi.
- [ ] **Step 4:** PASS + toàn bộ test merge/approval có sẵn (`pnpm test src/actions/merge src/actions/member-approval src/actions/members`). Chạy `finance-invariant-reviewer` (files `src/actions/members.ts`, `src/actions/member-approval.ts`, `src/lib/exchange/member-rows.ts`). PASS mới đóng.
- [ ] **Step 5: Commit** `fix(members): carry exchange rows through merge and block delete`

### Task 4: Tính phí giao lưu `src/lib/exchange-fee.ts`

**Files:** Create `src/lib/exchange-fee.ts`, `src/lib/exchange-fee.test.ts`

**Interfaces:**
- Consumes: `computeGroupPlayRates`, `GROUP_KEYS`, `GroupPolicy`, `roundToThousand`.
- Produces:
  - `type ExchangeFeeConfig = { feeMode; feeAmountMale; feeAmountFemale; feeFemalePercent; estimatedTotalCost; minHeads; hostHeads }` (số hoặc null)
  - `type HeadRates = { male: number; female: number }`
  - `computeExchangeFees(cfg, heads: { male: number; female: number }): HeadRates`
  - `exchangeFeeEstimate(cfg): HeadRates` (cách chia: `minHeads` nam + `hostHeads`; cách cố định: chính số cố định). Với `split_equal` đây là mức tối đa thật; với `split_female_discount` chỉ là ước tính (quyết định 32), tên hàm không gọi là "ceiling".
  - `registrationFee(rates, r: { maleCount; femaleCount }): number`
  - `computeLockedFees(cfg, regs: { id; status; maleCount; femaleCount; waived }[]): { rates: HeadRates; fees: { id: number; amount: number }[]; chargedHeads: number; aboveEstimate: boolean }` (mảng, không `Map`, để đi qua cache/JSON an toàn). Bị tính: `CHARGEABLE_STATUSES` không `waived`; người được miễn có `amount: 0`.
  - `depositSettlement(r: { depositPaid: boolean; feeAmount: number | null }, depositAmount: number): { remaining: number; refundDue: number }` với `paidDeposit = depositPaid ? depositAmount : 0`, `remaining = max(0, (feeAmount ?? 0) - paidDeposit)`, `refundDue = max(0, paidDeposit - (feeAmount ?? 0))` (I8).
- Ánh xạ (spec 4.4). Cách **chia** gọi engine với `headsByGroup = { member: male + hostHeads, memberFemale: female, còn lại 0 }`, `totalPlayCost = estimatedTotalCost`: `split_equal` cả hai equal; `split_female_discount` `member` equal, `memberFemale` = `{ mode: "percent", percent }` nếu có `feeFemalePercent`, ngược lại `{ mode: "fixed", amount: feeAmountFemale, capAtEqual: true }`; nhóm khác equal. Cách **cố định** trả thẳng số host nhập, không gọi engine (quyết định 2: engine trả trung bình khi rổ chia đều rỗng, `group-policy.ts:213-217`).

- [ ] **Step 1: Test đỏ:** `fixed: 80K for everyone regardless of heads`; `fixed_gender: 100K male, 80K female, never averaged`; `split_equal: 600K over 5 registered + 1 host = 100K`; `split_equal: 500K over 3 heads rounds up to 167K`; `split_female_discount percent: equals a direct computeGroupPlayRates call with the same policy`; `split_female_discount fixed female capped at equal share`; `0 registered heads puts the cost on host heads; 0 host heads and 0 registered returns 0`; `all-female split`; `split_equal estimate uses minHeads male + host heads; 3 real men exceed it`; `split_female_discount with minHeads reached but 2 women present reports aboveEstimate` (600K, minHeads 5, host 1, nữ 50%, 3 nam 2 nữ → nam 120K > 100K, I7); `no_show and late_cancelled charged unless waived; waived leave the divisor`; `depositSettlement covers lower fee, waived (fee 0), no fee yet, equal, higher fee`; `every returned amount is an integer` (200 cấu hình ngẫu nhiên có seed).
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/lib/exchange-fee.test.ts`).
- [ ] **Step 3:** `finance-invariant-reviewer` (file `src/lib/exchange-fee.ts`). PASS.
- [ ] **Step 4: Commit** `feat(exchange): compute exchange fees with the group engine`

### Task 5: Đếm slot và danh sách chờ `src/lib/exchange/slots.ts`

**Files:** Create `src/lib/exchange/slots.ts`, `src/lib/exchange/slots.test.ts`

**Interfaces:**
- `type SlotEvent = { slotsTotal; femaleReservedSlots; reserveReleaseAt: string | null }`; `type SlotReg = { id; status; maleCount; femaleCount; waitlistPos }`
- `slotState(ev, regs, now): { usedTotal; usedMale; maleCap; freeTotal; freeForMale; freeFemaleOnly; full }`: `maleCap = slotsTotal - femaleReservedSlots` trước `reserveReleaseAt` (null = không mở), sau đó `slotsTotal`; `freeForMale = max(0, min(freeTotal, maleCap - usedMale))`; `freeFemaleOnly = freeTotal - freeForMale`; `full = freeTotal === 0`.
- `fits(state, r): boolean` (`male + female <= freeTotal && male <= freeForMale`, không nhận một phần nhóm)
- `promoteFirstFit(ev, regs, now): number[]` (theo `waitlistPos`, cập nhật state sau mỗi người được lên)
- `nextWaitlistPos(regs): number`

- [ ] **Step 1: Test đỏ:** `pending and approved hold slots, waitlist does not`; `male cannot take a female-reserved slot before release`; `after reserveReleaseAt the reserved slots open to everyone`; `reserveReleaseAt null keeps the reserve forever`; `group of 3 does not fit 2 free slots`; `first-fit promotes the 1-person entry behind a 3-person head`; `promotion respects the female reserve`; `full only when no slot is free at all`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): count slots and promote the waitlist first-fit`

### Task 6: Thông báo giao lưu

**Files:**
- Modify: `src/lib/notifications/catalog.ts` (group `"exchange"` vào `MEMBER_GROUPS`, kind + payload mới), `src/lib/notifications/render.ts` (`MONEY_KEYS` thêm `deposit`, `remaining`, `refundDue`, `previousAmount`; `notificationHref`), `src/components/notifications/notification-prefs-section.tsx` (prop `exchangeEnabled?: boolean`, mặc định false, ẩn nhóm `exchange` khi false)
- Create: `src/lib/notifications/exchange-events.ts` (`import "server-only"`)
- Modify: i18n `notifications.kinds.*` (boolean bằng ICU `select`, ví dụ `{late, select, true {...} other {...}}`), `notifications.groups.exchange`, `notifications.reportReasons.*`, `notifications.reportTargets.*`
- Test: `src/lib/notifications/exchange-events.integration.test.ts`, case mới trong `catalog.test.ts`, `render.test.ts`, `email-render.test.ts`

**Interfaces:**
- Kind mới:

  | kind | audience/group | mandatory | email | level | payload |
  |---|---|---|---|---|---|
  | `exchange_registration_received` (host) | member/exchange | no | no | now | `{eventCode, eventTitle, heads, needsApproval}` |
  | `exchange_registration_cancelled` (host, buổi chưa chốt) | member/exchange | no | no | now | `{eventCode, eventTitle, heads, late}` |
  | `exchange_cancelled_after_lock` (host, buổi đã chốt, C2) | member/exchange | yes | no | now | `{eventCode, eventTitle, heads, late}` |
  | `exchange_registration_approved` | member/exchange | yes | yes | now | `{eventCode, eventTitle, startAt}` |
  | `exchange_registration_rejected` | member/exchange | yes | no | now | `{eventCode, eventTitle, startAt, refundDue}` |
  | `exchange_waitlist_promoted` | member/exchange | yes | yes | now | `{eventCode, eventTitle, startAt, status}` |
  | `exchange_fee_locked` | member/exchange | yes | yes | now | `{eventCode, eventTitle, startAt, amount, deposit, remaining, refundDue, aboveEstimate}` |
  | `exchange_fee_changed` | member/exchange | yes | yes | now | như trên + `previousAmount` (`amount: 0` khi không còn bị tính) |
  | `exchange_event_cancelled` | member/exchange | yes | yes | now, bypass | `{eventCode, eventTitle, startAt, refundDue}` |
  | `exchange_event_hidden` (host) | member/exchange | yes | no | now | `{eventCode, eventTitle}` |
  | `exchange_reported` | admin/admin_members | no | no | now | `{targetType, reason}` (dịch qua `reportTargets`/`reportReasons`) |

- `notificationHref`: group `exchange`: host kinds (`exchange_registration_received`, `exchange_registration_cancelled`, `exchange_cancelled_after_lock`, `exchange_event_hidden`) → `/giao-luu/{eventCode}/quan-ly`, kind khác → `/giao-luu/{eventCode}`, thiếu code → `/giao-luu`; `exchange_reported` → `/admin/giao-luu`.
- `exchange-events.ts` (nhận `tx`, `gate`, `now`; không tự đọc cờ): `notifyRegistrationReceived`, `notifyRegistrationDecision(… decision: "approved" | "rejected" | "promoted")`, `notifyRegistrationCancelled(… { late, afterLock })`, `notifyFeesLocked(… { event, changes: { reg, amount, previousAmount: number | null }[] })` (lần đầu → `fee_locked`; chốt lại → `fee_changed` chỉ cho người đổi số, dedup `xfee:e{id}:n{lockCount}`), `notifyEventCancelled(… { event, regs })` (mọi `pending/approved/waitlist`, kèm `refundDue` của từng người), `notifyEventHidden`, `notifyReported` (superadmin).

- [ ] **Step 1: Test đỏ:** `catalog: every exchange kind has vi/en/zh title and body`; `render: fee_locked formats amount, deposit, remaining and refundDue as VND`; `render: booleans pick the right sentence, never "true"/"false"`; `render: report reason is translated, not a raw code`; `email: exchange_fee_locked email has no group fund QR`; `href: exchange kinds link to the event or its manage page`; `prefs section hides exchange unless exchangeEnabled` (case Task 1 xanh nguyên văn); `notifyRegistrationReceived payload has heads and no name`; `notifyFeesLocked twice with the same lockCount inserts nothing new`; `gate false writes nothing` (từng hàm).
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/lib/notifications src/components/notifications src/i18n`).
- [ ] **Step 3: Commit** `feat(notifications): add exchange event notifications`

### Task 7: Cổng quyền, chống bot, giới hạn nick mới

**Files:**
- Create: `src/lib/exchange/guards.ts`, `src/lib/exchange/attendance.ts`, `src/lib/exchange/serial.ts` (đều `import "server-only"`)
- Modify: i18n `exchange.errors.*` (notFound, notAllowed, captcha, rateLimited, config, eventClosed, deadlinePassed, cannotRegister, newAccountLimit, ...)
- Test: `src/lib/exchange/guards.integration.test.ts`, `src/lib/exchange/attendance.integration.test.ts`

**Interfaces:**
- `exchangeGate(): Promise<{ ok: true } | { error: string }>` (cờ tắt → `exchange.errors.notFound`)
- `checkBotAndRate(opts: { token; action; rateKey; limit }): Promise<{ ok: true } | { error: string }>`: `verifyTurnstile` (IP từ `getTrustedClientIp()`, `expectedHostname` từ `NEXT_PUBLIC_APP_URL` như `src/actions/google-auth.ts`) rồi `checkRateLimit`. Thiếu cấu hình → lỗi `config`.
- `activeHostWhere` (điều kiện Drizzle: host `is_active` và `approved`); `loadHostedEvent(tx, eventId, memberId): Promise<ExchangeEventRow | null>` (chỉ khi `hostMemberId === memberId`)
- `isBlockedByHost(tx, hostMemberId, memberId): Promise<boolean>`
- `attendanceStats(tx, memberId): Promise<{ checkedIn: number; approved: number }>` (G2d dùng lại)
- `newAccountLimits(tx, member: { id; approvalStatus }): Promise<{ isNew: boolean; waitingCount: number }>`: member `approved` không phải nick mới; còn lại `isNew = checkedIn === 0`. `waitingCount` chỉ đếm đăng ký `pending/waitlist` của buổi `open/full`, chưa ẩn, chưa bắt đầu (M5).
- `runSerial<T>(fn): Promise<T>` (hàng đợi trong process, cùng lý do với `src/actions/venues.ts:51`; không import, không sửa file đó)

- [ ] **Step 1: Test đỏ:** `exchangeGate errors when the flag is off`; `failed Turnstile never touches rate_limit_buckets`; `Cloudflare unreachable is rejected`; `loadHostedEvent returns null for another member's event`; `newAccountLimits: approved member never new; pending outsider with 0 check-ins is new; one check-in lifts it`; `waitingCount ignores registrations of cancelled or hidden events`; `attendanceStats counts only checked-in registrations`.
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/lib/exchange src/i18n`).
- [ ] **Step 3: Commit** `feat(exchange): add exchange guards and new account limits`

### Task 8: Mở buổi và sửa buổi (server)

**Files:** Create `src/lib/exchange/event-schema.ts`, `src/lib/exchange/public-code.ts`, `src/actions/exchange-events.ts`; i18n lỗi; Test `src/lib/exchange/event-schema.test.ts`, `src/actions/exchange-events-create.integration.test.ts`

**Interfaces:**
- `newPublicCode(): string` (10 ký tự từ `abcdefghjkmnpqrstuvwxyz23456789`, `crypto.randomBytes`)
- `eventFormSchema` (zod, dùng chung form và server): `venueId`, `date`, `startTime`, `endTime`, `title` (5..80), `description` (≤ 2000), `skillMin`, `skillMax`, `slotsTotal` (1..`MAX_SLOTS`), `femaleReservedSlots` (0..slotsTotal), `reserveRelease: "deadline" | "h24" | "h6" | "never"`, `hostHeads` (0..`MAX_HOST_HEADS`), `shuttleType` (≤ 60), `feeMode` + tiền theo cách (discriminated union; tiền/người 0..`MAX_FEE_PER_HEAD`, tổng 1000..`MAX_TOTAL_COST`, `minHeads` 1..slotsTotal, phần trăm 0..100), `depositAmount` (≥ 0), `registerDeadlineHours` (0..72, mặc định 2), `cancelDeadlineHours` (0..72, mặc định 12), `autoApprove` (false), `allowPlusOnes` (false), payout 3 trường (đủ cả 3 hoặc không; BIN trong `VN_BANKS`, số TK `^\d{6,20}$`, tên ≤ 50 in hoa không dấu), `hostContact` (sđt VN hoặc `https://zalo.me/...`, ≤ 100), `zaloGroupLink` (rỗng hoặc `https://zalo.me/g/...`), `turnstileToken`, `idempotencyKey` (uuid). Chéo: `skillMin <= skillMax` theo `SKILL_LEVELS`; `endTime > startTime`.
- `resolveEventTimes(input, now)`: `startAt` từ 30 phút tới 60 ngày sau `now`; hạn = `startAt - N giờ`, không trước `now + 5 phút`; `reserveRelease` → instant hoặc null (chỉ khi `femaleReservedSlots > 0`).
- `createExchangeEvent(input): Promise<{ success: true; data: { code } } | { error }>`: gate → `requireApprovedMember` → zod → `checkBotAndRate(TS_OPEN, "exchange-open:{memberId}", RL_OPEN)` → sân `approved` → `depositAmount <= min(exchangeFeeEstimate(cfg).male, exchangeFeeEstimate(cfg).female)` → insert (trùng `idempotencyKey` → trả code cũ; trùng `publicCode` → sinh lại, tối đa 3 lần) → `updateTag("exchange")`.
- `updateExchangeEvent(input: { eventId; title?; description?; shuttleType?; hostContact?; zaloGroupLink?; payout? })`: host, `open/full`. Giờ, sân, cách phí, số tiền, slot nữ không sửa được (quyết định 9). Tăng slot ở Task 11.
- `getMyLastPayout(): Promise<{ bankBin; accountNo; accountName } | null>`.

- [ ] **Step 1: Test đỏ:** `schema: fixed_gender needs both amounts; split needs total cost and minHeads`; `schema: payout all three or none`; `schema: skillMin above skillMax rejected`; `resolveEventTimes: 20:30 on 2026-11-20 is 13:30Z under TZ=UTC`; `create: pending exchange account rejected, nothing written`; `create: pending venue rejected`; `create: deposit above the estimate rejected`; `create: same idempotencyKey twice → one row, same code`; `create: flag off errors before any DB read`; `update: another member cannot edit; extra fields like startAt are ignored`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3:** `finance-invariant-reviewer` (files `src/actions/exchange-events.ts`, `src/lib/exchange/event-schema.ts`). PASS.
- [ ] **Step 4: Commit** `feat(exchange): open and edit exchange events`

### Task 9: Đọc buổi và tìm quanh đây

**Files:** Create `src/lib/exchange/public-event.ts`, `src/actions/exchange-read.ts`; Test `src/lib/exchange/public-event.test.ts`, `src/actions/exchange-read.integration.test.ts`

**Interfaces:**
- `type FeeDisplay = { kind: "fixed"; male; female } | { kind: "split"; estimate: HeadRates; current: HeadRates; minHeads; currentHeads; estimateIsCap: boolean } | { kind: "locked"; rates: HeadRates; aboveEstimate: boolean }` (`estimateIsCap` true chỉ với `split_equal`)
- `type PublicExchangeEvent = { code; title; description; startAt; endAt; status; hidden; venue: { id; name; address; areaLabel; lat; lng; mapLink }; host: { name; avatarUrl; avatarKey }; skillMin; skillMax; slotsTotal; femaleReservedSlots; reserveReleaseAt; shuttleType; feeMode; fee: FeeDisplay; depositAmount; registerDeadline; cancelDeadline; autoApprove; allowPlusOnes; counts: { approvedHeads; pendingHeads; waitlistHeads; freeTotal; freeFemaleOnly }; attendeeAvatars: { avatarUrl; avatarKey }[]; createdAt }`; `PUBLIC_EXCHANGE_EVENT_KEYS`; `toPublicExchangeEvent(...)` dựng từng key.
- `type ExchangeCard = Pick<PublicExchangeEvent, "code" | "title" | "startAt" | "endAt" | "status" | "skillMin" | "skillMax" | "slotsTotal" | "fee" | "counts"> & { venue: { id; name; lat; lng; areaLabel }; host: { name; avatarUrl; avatarKey }; distanceM: number }`
- `type ViewerExtras = { role: "guest" | "member" | "host"; myRegistration: { id; status; maleCount; femaleCount; feeAmount; feeWaived; depositPaid; paid; waitlistPos; remaining; refundDue } | null; skillWarning; hostContact; zaloGroupLink; payout; attendees: { name; avatarUrl; avatarKey }[] | null; blocked; isNewAccount }`. `hostContact`, `zaloGroupLink`, `attendees` chỉ khi `approved` hoặc host (M9); `payout` khi có phí phải trả hoặc `pending` cần cọc.
- `getExchangeEvent(code)`: phần công khai qua `unstable_cache` (key code, tag `"exchange"`, 60s, trả JSON thuần); phần người xem theo request. Ẩn → `null` trừ host hoặc người có đăng ký. Host hết hiệu lực → `null` với người lạ.
- `listExchangesNear(q: { lat; lng; radiusKm: 3|5|10|20; date?; timeOfDay?: "morning"|"afternoon"|"evening"; skill?; hasSlot?; hasFemaleSlot?; maxFee? })` (I3): ứng viên qua `unstable_cache` theo `(snapToGrid, radiusKm, date ?? "")` đúng mẫu `getCandidatesNearCell`: bbox cộng `GRID_MARGIN_M`, điều kiện `venues.status = approved`, `exchange_events.status IN (open, full)`, `hidden_at IS NULL`, host còn hiệu lực, `start_at >= now`, có `date` thì lọc ngày VN trong SQL; `ORDER BY` khoảng cách xấp xỉ rồi `start_at`; `LIMIT CANDIDATE_LIMIT`; đếm đầu người bằng 1 truy vấn `GROUP BY event_id`. Ngoài cache: lọc lại `startAt >= now`, haversine, bộ lọc còn lại, sắp gần nhất, rồi mới `slice(0, LIST_LIMIT)`. Khung giờ VN: sáng < 12:00, chiều 12:00-16:59, tối ≥ 17:00. `maxFee` so với `fee.male` hoặc `fee.estimate.male`.
- `listUpcomingAtVenue(venueId): Promise<ExchangeCard[]>`; `countUpcomingByVenue(venueIds: number[]): Promise<[number, number][]>` (cache trả mảng cặp; gọi từ client dựng `Map`, I4). Cả hai qua cache tag `"exchange"`, gate cờ.

- [ ] **Step 1: Test đỏ:** `toPublicExchangeEvent has exactly PUBLIC_EXCHANGE_EVENT_KEYS, no phone/email/payout/contact`; `guest gets no contact, link, payout or names`; `approved registrant sees contact, payout and attendee names; pending without deposit does not`; `hidden event null for a stranger, visible to its host`; `events of a deactivated host are not listed and getExchangeEvent returns null for a stranger`; `listExchangesNear excludes cancelled, locked, hidden, past and out-of-radius events, sorts nearest, caps at 50`; `60 events in the box: the nearest and the only filter match are still returned`; `evening filter keeps a 19:00 VN event under TZ=UTC`; `hasFemaleSlot keeps an event with only female-reserved slots free`; `countUpcomingByVenue survives a JSON round trip of the cache` (mock `next/cache` serialize).
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): read exchange events and search nearby`

### Task 10: Đăng ký, huỷ đăng ký, `settleEvent`

**Files:** Create `src/lib/exchange/settle.ts` (`import "server-only"`), `src/actions/exchange-registrations.ts`; i18n lỗi; Test `src/actions/exchange-registrations.integration.test.ts`

**Interfaces:**
- `settleEvent(tx: Tx, eventId: number, now: Date, gate: boolean): Promise<{ promoted: number[]; status: "open" | "full" | null }>`: chỉ đẩy khi theo quy ước "Đẩy danh sách chờ" (I11, `now < startAt`); người được lên → `pending` (hoặc `approved` khi `autoApprove && depositAmount === 0`), `waitlistPos = null`, `decidedAt`, tin `promoted`; cập nhật `open/full`. Buổi không ở `open/full` → không làm gì, `status: null`.
- `registerForExchange(input: { code; maleCount; femaleCount; note?; turnstileToken })` → `{ success: true; data: { status: "pending" | "approved" | "waitlist"; waitlistPos } } | { error }`. Thứ tự: gate → `requireExchangeMember` → zod (đầu người 1..`1 + MAX_COMPANIONS`, note ≤ 300) → `checkBotAndRate(TS_REGISTER, "exchange-register:{memberId}", RL_REGISTER)` → `runSerial(() => db.transaction(...))`: buổi `open/full`, chưa ẩn, host còn hiệu lực, `now < registerDeadline`; không phải host; không bị chặn (lỗi chung `cannotRegister`); đi kèm cần `allowPlusOnes`; nick mới: không đi kèm, `waitingCount < NEW_ACCOUNT_MAX_WAITING`; dòng cũ: `pending/approved/waitlist` → trả trạng thái hiện có, `cancelled/late_cancelled` → dùng lại dòng, `rejected/no_show` → từ chối. **Gọi `settleEvent` TRƯỚC khi xét người mới** (I2), sau đó vừa slot → `approved`/`pending`, không vừa → `waitlist` cuối hàng. Tin `received` cho host. `updateTag("exchange")` sau commit.
- `cancelMyRegistration(input: { code })`: `requireExchangeMember`; `approved` và `now > cancelDeadline` → `late_cancelled`, còn lại → `cancelled` (`cancelledAt`, `waitlistPos = null`); buổi `done/cancelled` → từ chối; buổi `locked` → vẫn huỷ, tin host là `exchange_cancelled_after_lock` (bắt buộc) và không đẩy ai; buổi `open/full` → `settleEvent`, tin `exchange_registration_cancelled`.

- [ ] **Step 1: Test đỏ:** `auto-approve → approved; manual → pending; full → waitlist pos 1`; `two concurrent registrations for the last slot → one holds it, one waitlisted` (`Promise.all`); `same member twice → same status, one row`; `host cannot register; blocked member gets the generic error`; `new account: no companions, no third waiting registration`; `after registerDeadline rejected (TZ=UTC)`; `male waitlisted when only female-reserved slots remain, female gets in`; `register after reserveReleaseAt promotes the waiting male before seating a newcomer`; `deactivated host's event refuses registration`; `pending exchange account can register; rejected cannot`; `cancel: late after cancelDeadline, plain before`; `cancel frees slots and promotes first-fit in the same transaction`; `cancel while locked sends the mandatory host notice and promotes nobody`; `no path writes financial_transactions or session_debts` (đếm dòng).
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): register, waitlist and cancel`

### Task 11: Host duyệt, cọc, tăng slot, chặn (server)

**Files:** Create `src/actions/exchange-host.ts`; i18n lỗi; Test `src/actions/exchange-host.integration.test.ts`

**Interfaces:**
- Mọi hàm: gate → `requireApprovedMember` → zod → tx với `loadHostedEvent` → **`settleEvent` trước tiên** (M8, để slot nữ tới hạn được xét ở mọi thao tác host) → việc chính → notify → `updateTag("exchange")`. Input không có id người thực hiện.
  - `decideRegistration({ registrationId; decision: "approve" | "reject" })`: từ `pending` (approve khi có cọc thì cần `depositPaid`), hoặc reject một `approved` trước khi chốt. Reject người đã cọc → tin có `refundDue`.
  - `setDepositReceived({ registrationId; received })`: `depositAmount > 0`, đăng ký `pending`; `true` → `depositPaid`, `depositPaidAt`, duyệt luôn.
  - `increaseSlots({ eventId; slotsTotal })`: `open/full`, số mới > cũ và ≤ `MAX_SLOTS`.
  - `settleWaitlist({ eventId })`: nút "Xét danh sách chờ" (chỉ chạy `settleEvent`).
  - `blockRegistrant({ registrationId })` (`onConflictDoNothing`; không đổi đăng ký đang có); `unblockMember({ blockId })` xoá với `id = blockId AND host_member_id = member.id`, không khớp → lỗi chung (I12).
  - `getManageView(code)` → `{ event; regs: ManageReg[]; blocks: { id; name }[]; reserveOpened: boolean } | null` (chỉ host). `ManageReg = { id; status; name; avatarUrl; avatarKey; gender; skillLevel; skillOutOfRange; isNewAccount; accountLocked; maleCount; femaleCount; note; waitlistPos; depositPaid; feeAmount; feeWaived; paid; paidAmount; refundDue; remaining; checkedIn; createdAt }`. `accountLocked` = member `!isActive` hoặc `rejected` (M10). Không sđt/email.

- [ ] **Step 1: Test đỏ:** `another member or a pending outsider cannot decide, take deposit, increase slots, block or read the manage view`; `another host cannot unblock someone else's block`; `approve requires the deposit when the event has one`; `rejecting an approved registration before lock promotes the waitlist`; `rejecting a pending registration with a paid deposit reports refundDue`; `any host action after reserveReleaseAt promotes the waiting male`; `increaseSlots cannot shrink, promotes when it grows`; `setDepositReceived twice approves and notifies once`; `manage view flags skill out of range, new accounts and locked accounts, with no phone or email`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): let hosts approve, take deposits and block`

### Task 12: Chốt phí, đã trả, điểm danh, kết thúc, huỷ buổi (server)

**Files:** Create `src/lib/exchange/cancel.ts` (`import "server-only"`); Modify `src/actions/exchange-host.ts`; Test `src/actions/exchange-fees.integration.test.ts`, `src/actions/exchange-checkin.integration.test.ts`

**Interfaces:**
- `lockExchangeFees({ eventId; waivedRegistrationIds: number[]; confirmAboveEstimate: boolean })` → `{ success: true; data: { rates } } | { needsConfirm: { rates; estimate } } | { error }`: `settleEvent` trước; buổi `open/full`; còn `pending` → lỗi. `computeLockedFees` từ DB; `aboveEstimate && !confirmAboveEstimate` → `needsConfirm`, không ghi. Ghi `feeAmount`, `feeWaived` cho người bị tính/miễn; người có `feeAmount` cũ khác null mà không còn bị tính → `feeAmount = null`, vào `changes` với `amount: 0` (C2). `status = locked`, `lockedAt`, `lockCount + 1`. Lần đầu → `fee_locked`; chốt lại → `fee_changed` chỉ cho người đổi số; `paid`, `paidAmount` giữ nguyên.
- `unlockExchangeFees({ eventId })`: `locked` → `open/full` qua `settleEvent` (sau `startAt` không đẩy ai); giữ `feeAmount` cũ để so.
- `setRegistrationPaid({ registrationId; paid })`: buổi `locked/done`, `feeAmount != null`; `true` → `paid`, `paidAt`, `paidAmount = feeAmount`; `false` → cả ba về false/null.
- `setCheckedIn({ registrationId; checkedIn })`: `approved` (hoặc `no_show` → về `approved`); khung `startAt - CHECKIN_OPEN_BEFORE_MIN` tới `endAt + CHECKIN_CLOSE_AFTER_DAYS`; buổi không `cancelled`.
- `markNoShow({ registrationId })`: sau `startAt`, `approved` chưa điểm danh → `no_show`.
- `finishExchangeEvent({ eventId })`: `locked` và `now >= startAt` → `done`.
- `cancelExchangeEvent({ eventId })`: luôn là host qua `loadHostedEvent` (không có `actor`, C3), gọi `cancelEventCore`.
- `cancelEventCore(tx: Tx, event: ExchangeEventRow, now: Date, gate: boolean): Promise<void>` ở `src/lib/exchange/cancel.ts`: `open/full/locked` → `cancelled`, `cancelledAt`; giữ trạng thái đăng ký; `notifyEventCancelled` (có `refundDue` từng người). Admin dùng ở Task 20.

- [ ] **Step 1: Test đỏ:** `lock recomputes server-side and stores integers per registration`; `lock below minHeads → needsConfirm, nothing written; confirm locks`; `lock refused while a registration is pending`; `no_show and late_cancelled charged by default; waived get 0 and leave the divisor`; `relock: a paid participant who left gets fee null, a fee_changed notice, and refundDue from paidAmount`; `relock: paidAmount below the new fee shows the difference`; `relock notifies only changed amounts; paid stays true`; `unlock after start does not promote the waitlist`; `lock, pay, unlock, relock never write financial_transactions or session_debts`; `paid, check-in, cancel by a non-host rejected, also with an extra actor field`; `check-in outside the window rejected`; `cancel notifies pending, approved and waitlisted once with their refundDue`; `finish requires locked and a started event`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3:** `finance-invariant-reviewer` (files `src/actions/exchange-host.ts`, `src/lib/exchange/{settle,cancel}.ts`, `src/lib/exchange-fee.ts`). PASS.
- [ ] **Step 4: Commit** `feat(exchange): lock fees, mark paid and check in`

### Task 13: Báo cáo (server)

**Files:** Create `src/actions/exchange-reports.ts`; i18n lỗi; Test `src/actions/exchange-reports.integration.test.ts`

**Interfaces:**
- `reportAbuse(input: { target: { type: "event"; code } | { type: "host"; code } | { type: "registration"; registrationId }; reason: ReportReason; note?: string; turnstileToken })`: gate → `requireExchangeMember` → zod (note ≤ 500) → `checkBotAndRate(TS_REPORT, "exchange-report:{memberId}", RL_REPORT)` → server dịch target ra `(member|event, id)` (`registration` chỉ hợp lệ khi người báo là host của buổi đó) → insert `onConflictDoNothing` → `notifyReported`. Không nhận member id từ client.
- [ ] **Step 1: Test đỏ:** `registration target by a non-host rejected`; `second report of the same target writes nothing`; `no Turnstile, no row`; `admin gets one exchange_reported notice`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): report events and players`

### Task 14: Form mở buổi `/giao-luu/mo`

**Files:** Create `src/app/(exchange)/giao-luu/mo/{page,loading}.tsx`, `event-form.tsx`, `venue-picker.tsx`, `fee-preview.tsx`; i18n `exchange.form.*`; Test `event-form.test.tsx`

**Interfaces:**
- Consumes: `eventFormSchema`, `createExchangeEvent`, `getMyLastPayout`, `computeExchangeFees`/`exchangeFeeEstimate`, `listVenuesNear` + `useUserLocation`, `VN_BANKS`, `TurnstileWidget` (`TS_OPEN`, `resetKey`), `MoneyInput`.
- Page: khách → redirect `/giao-luu/dang-nhap?next=/giao-luu/mo`; chưa duyệt nhóm → màn giải thích có nút về `/giao-luu`.
- Form: react-hook-form + `zodResolver`. Mục chính trước (sân, ngày, giờ, tiêu đề, slot, cách phí, số tiền); "Tuỳ chọn thêm" gập (trình độ, slot nữ, đi kèm, cọc, tự duyệt, hạn, liên hệ, link Zalo, tài khoản nhận tiền điền sẵn). Xem trước phí dùng đúng hàm server: `split_equal` "tối đa X/người khi có N người", `split_female_discount` "khoảng X/người khi có N người nam". Gọi `createExchangeEvent` thẳng (không `fireAction`, không optimistic, quyết định 18), nút có spinner và chặn bấm lại; `idempotencyKey` sinh 1 lần mỗi lần mở form; sau mỗi lần gửi tăng `resetKey`.
- [ ] **Step 1: Test đỏ:** `split_equal preview shows the cap at minHeads; female discount preview says it is an estimate`; `fixed_gender asks for both amounts`; `payout prefilled from the last event`; `retry after an error sends the same idempotencyKey and a new Turnstile token`; `server error text is shown as-is, not replaced by a Turnstile error`; `success navigates to the new code`.
- [ ] **Step 2:** FAIL → viết → PASS + `pnpm test src/i18n`.
- [ ] **Step 3: Commit** `feat(exchange): add the open event form`

### Task 15: Trang tìm buổi `/giao-luu` (danh sách + ghim bản đồ)

Viết theo `MapView`, `VenueMapPanel`, `venue-directory.tsx` sau đợt sửa G3 (đọc bản ở `D:/Lwcifer/LW/FWBB-g3ui`, chỉ đọc; sau Task 0 cùng nội dung có trong worktree này): `cooperativeGestures` trên mobile, `keepPreviousData`, lớp phủ đang tải/lỗi/rỗng trên bản đồ, thông báo `styleFailed`, nhãn biển Đông, kiểm WebGL trước bằng `src/lib/map/webgl.ts` (nút Bản đồ bị tắt + dòng `role="status"`).

**Files:**
- Modify: `src/lib/map/map-points.ts` (`MapPoint` thành union, `pointKey`, `exchangesToPoints`), `src/components/map/map-view.tsx` (khoá marker VÀ trạng thái chọn theo `pointKey`, ghim có số khi `count > 1`)
- Modify: `src/app/(exchange)/giao-luu/page.tsx` (giữ thẻ tài khoản và nút đăng nhập G2a)
- Create: `src/app/(exchange)/giao-luu/{exchange-search,exchange-filters,exchange-map-panel}.tsx`, `src/components/exchange/exchange-card.tsx`
- Test: case mới trong `map-points.test.ts`, `map-view.test.tsx`; `src/app/(exchange)/giao-luu/exchange-search.test.tsx`

**Interfaces:**
- `type MapPoint = { kind: "venue"; id; lat; lng; label } | { kind: "exchange"; id /* venueId */; lat; lng; label; count }`; `pointKey(p: MapPoint): string` = `${kind}:${id}`. `MapViewProps` thêm `selectedKey?: string | null` (M12): có `selectedKey` thì ghim được chọn là ghim có `pointKey(p) === selectedKey`; không có thì giữ cách cũ nhưng chỉ cho ghim `kind: "venue"` (`p.kind === "venue" && p.id === selectedId`). Chỗ gọi của `/san` và test G3 không đổi.
- `exchangesToPoints(events: Pick<ExchangeCard, "venue">[]): MapPoint[]` (gom theo `venue.id`).
- `ExchangeCard` component: thẻ glass, giờ VN, tiêu đề, sân + "~2,3 km", chip trình độ, phí (`80K` / `tối đa 100K` / `khoảng 100K`), thanh slot ("12/24", "còn 2 slot nữ"), avatar host; cả thẻ là link, chạm ≥ 44px.
- Bộ lọc nuqs: `view`, `r` (mặc định 5), `d`, `t`, `skill`, `slot`, `nu`, `fee`. Tâm: GPS hoặc `LocationFallback`; "Tìm ở khu vực này" như `venue-directory.tsx`.
- `useQuery({ queryKey: ["exchange-near", center, filters], queryFn: listExchangesNear, staleTime: 60_000, placeholderData: keepPreviousData })`.
- `ExchangeMapPanel` theo mẫu `VenueMapPanel` (lớp phủ loading/notice, `cooperativeGestures={isMobile}`); bấm ghim mở bottom sheet / panel `sm:` liệt kê buổi tại sân. Rỗng: "Chưa có buổi quanh đây" + "Mở rộng bán kính" + (member đã duyệt) "Mở buổi". Member đã duyệt thấy nút nổi "Mở buổi".
- [ ] **Step 1: Test đỏ:** `exchangesToPoints groups by venue with a count`; `map-view: venue and exchange points with the same id both render`; `selecting an exchange pin does not highlight the venue pin with the same id`; `exchange pin with count 3 shows 3 and an aria-label with the count`; `list view does not render the map; list ↔ map calls listExchangesNear once`; `radius change refetches and keeps previous pins while loading`; `tapping a pin opens a sheet with that venue's events`; `empty result shows widen-radius on top of the map`; `no WebGL disables the map button`; `page keeps the G2a account card and the guest login CTA`. Test G3 trong ledger Task 1 xanh.
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/lib/map src/components/map src/components/venues "src/app/(exchange)" src/i18n`).
- [ ] **Step 3: Commit** `feat(exchange): search exchange events on a list and map`

### Task 16: Trang buổi `/giao-luu/[code]` dạng bài Reddit + đăng ký

**Files:** Create `src/app/(exchange)/giao-luu/[code]/{page,loading}.tsx`, `event-post.tsx`, `register-sheet.tsx`, `my-registration-bar.tsx`, `src/components/exchange/{exchange-pay-qr,report-sheet}.tsx`; Test `event-post.test.tsx`, `register-sheet.test.tsx`

**Interfaces:**
- Consumes: `getExchangeEvent`, `registerForExchange`, `cancelMyRegistration`, `reportAbuse`, `getVietQRUrl`, `TurnstileWidget` (`TS_REGISTER`, `TS_REPORT`, `resetKey`).
- `ExchangePayQR({ bankBin, accountNo, accountName, amount, memo })` (ảnh `getVietQRUrl`, nút chép); `memo = "GL " + code + " " + registrationId`. Không dùng `PaymentQR`.
- Bố cục: avatar + tên host + "· 2 giờ trước" + chip trạng thái; tiêu đề; chip ngày giờ, sân (`/san/{venueId}`), trình độ, loại cầu; mô tả chữ thuần `whitespace-pre-wrap`; khối phí (`locked` + `aboveEstimate` → "phí cao hơn số đã hiện lúc đăng ký", không nêu lý do, I7); khối slot (thanh, "còn N slot nữ", avatar + "+n"; người `approved` và host thấy tên); hàng hành động Chỉ đường (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`), Chia sẻ, Báo cáo; cuối bài để trống cho G2c.
- Thanh dính đáy: khách → "Đăng nhập để đăng ký"; còn hạn → "Đăng ký"; đã đăng ký → trạng thái + "Huỷ" (sau hạn huỷ: `ConfirmDialog` "vẫn bị tính phí"); host → "Quản lý buổi"; khoá/xong/huỷ → chữ trạng thái.
- `RegisterSheet`: "Bạn" Nam/Nữ (điền theo `members.gender`), stepper đi kèm (ẩn khi không cho hoặc nick mới), ghi chú, cảnh báo trình độ, phí dự kiến, Turnstile. Gửi bằng `fireAction(..., { retry: false })`: optimistic "Đang gửi…", xong đặt theo trạng thái server + `router.refresh()`; lỗi rollback + toast đúng thông báo server; luôn tăng `resetKey`. `ReportSheet` cùng cách gửi.
- Số tiền: `remaining`, `refundDue` lấy từ `ViewerExtras.myRegistration`; có tài khoản nhận tiền → QR với `remaining`; không có → "Thanh toán trực tiếp với host"; `refundDue > 0` → "Host sẽ hoàn lại X ngoài app"; `pending` cần cọc → QR với `depositAmount`; đã trả → dấu tích.
- [ ] **Step 1: Test đỏ:** `post shows title, venue link, fee, slot bar and directions; no phone or email`; `guest sees login CTA with next back to the event`; `approved registrant sees contact, zalo link, names and QR with remaining`; `refundDue shows the refund line`; `locked above estimate shows the higher-than-shown line`; `register sheet hides companions for a new account and warns on skill`; `register error rolls back, shows the server message and resets Turnstile`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): add the exchange event page and registration`

### Task 17: Trang quản lý `/giao-luu/[code]/quan-ly`

**Files:** Create `src/app/(exchange)/giao-luu/[code]/quan-ly/{page,loading}.tsx`, `manage-client.tsx`, `registration-row.tsx`, `lock-fee-sheet.tsx`; Test `manage-client.test.tsx`

**Interfaces:**
- Consumes: `getManageView` (không phải host → `notFound()`), action Task 11, 12, 13, `updateExchangeEvent`, `computeLockedFees`, `depositSettlement`.
- Tab `TabSegment` "Chờ duyệt / Tham gia / Danh sách chờ / Đã huỷ"; thẻ người (avatar, tên, nam/nữ, nhãn "Mới", "Lệch trình độ", "Tài khoản đã bị khoá", ghi chú). Hành động theo trạng thái: Duyệt, Từ chối, Đã nhận cọc, Điểm danh, Không đến, Đã trả, Chặn (menu "…" + `ConfirmDialog`), Báo cáo. Công tắc và nút optimistic qua `fireAction`.
- Tiền: mỗi người hiện phí, cọc, "đã trả X" (`paidAmount`), chênh lệch, "cần hoàn Y" (`refundDue`, gồm người `pending` đã cọc bị từ chối/huỷ); đầu trang tổng đã thu / chưa thu / cần hoàn.
- Biểu ngữ: `reserveOpened` + có người chờ → "N slot nữ đã mở" + nút "Xét danh sách chờ" (`settleWaitlist`); có người huỷ sau khi chốt → "Cần mở khoá và chốt lại".
- `LockFeeSheet`: danh sách bị tính (có ô "Miễn"), xem trước bằng `computeLockedFees`; `needsConfirm` → so với mức đã hiện + "Vẫn chốt"; "Mở khoá để sửa" khi đã chốt.
- "Sửa buổi": tăng slot, mô tả/liên hệ/link Zalo/tài khoản nhận tiền. "Kết thúc buổi", "Huỷ buổi" (`ConfirmDialog` nhắc hoàn cọc ngoài app). Không tự làm mới; nút "Tải lại".
- [ ] **Step 1: Test đỏ:** `toggling paid is optimistic and rolls back on error`; `lock sheet previews fees and shows the confirm step on needsConfirm`; `refund due and paid-difference lines render from paidAmount and refundDue`; `cancelled-after-lock banner asks to unlock and relock`; `reserve-opened banner runs settleWaitlist`; `locked account label shows on its registration`; `check-in toggle disabled outside the window`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): add the host manage page`

### Task 18: "Giao lưu của tôi", menu, `/me`, thông báo cho người ngoài

**Files:**
- Create: `src/app/(exchange)/giao-luu/cua-toi/{page,loading}.tsx`, `my-exchanges.tsx`; `src/actions/exchange-mine.ts`
- Modify: `src/components/layout/nav-drawer.tsx` (+ chỗ dựng nó trong `header.tsx`/`member-shell.tsx`: prop `exchangeEnabled` từ server), `src/app/(public)/me/me-exchange-link.tsx` + `page.tsx` (truyền `enabled`), `src/app/api/notifications/verify-email/route.ts`
- Test: `src/actions/exchange-mine.integration.test.ts`, case mới trong `header-nav.test.tsx`, `me-exchange-link.test.tsx`, `verify-email-redirect...test.ts`

**Interfaces:**
- `getMyExchanges()` → `{ registrations: (ExchangeCard & { myStatus; feeAmount; paid; waitlistPos; remaining; refundDue })[]; hosting: ExchangeCard[]; blocks: { id; name }[] } | { error }` (`requireExchangeMember`; sắp diễn ra trước, tối đa 50 mỗi loại).
- Trang: thẻ tài khoản G2a cho tài khoản giao lưu; danh sách đăng ký và buổi đang host; danh sách đã chặn với "Bỏ chặn" (optimistic, `unblockMember`); khi `notificationsEnabled` thì render `NotificationPrefsSection scope="member" exchangeEnabled` (I9: người ngoài tắt được nhóm tin và xác minh email nếu có email).
- Menu: `exchangeNavItems` thêm "Cá nhân" → `/giao-luu/cua-toi` (ngoại lệ có chủ đích, ghi lý do spec 4.6b); `groupNavItems` thêm "Giao lưu" → `/giao-luu` chỉ khi `exchangeEnabled` (I10); cờ tắt thì danh sách y như Task 1.
- `MeExchangeLink` khi `enabled`: thẻ link "Giao lưu của tôi".
- Route xác minh email: khi cờ bật và member là tài khoản giao lưu (`isExchangeAccount`) thì về `/giao-luu/cua-toi?email=...`; mọi trường hợp khác giữ `/me?email=...`.
- [ ] **Step 1: Test đỏ:** `my exchanges lists my registrations and hosted events; a rejected account gets an error`; `exchange account sees notification prefs with the exchange group on /giao-luu/cua-toi`; `group nav shows Giao lưu only when the flag is on`; `exchange nav shows Cá nhân`; `me page link only when enabled`; `verify-email sends an exchange account back to /giao-luu/cua-toi when the flag is on`. Case Task 1 xanh nguyên văn.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): add my exchanges and exchange menu entries`

### Task 19: Danh bạ sân: số buổi, bộ lọc, giao lưu sắp tới

**Files:**
- Modify: `src/app/(exchange)/san/page.tsx` (đọc cờ 1 lần, truyền `exchangeEnabled`), `src/app/(exchange)/san/venue-directory.tsx` (bản sau đợt sửa G3), `src/components/venues/venue-card.tsx` (prop `upcomingExchangeCount?: number`), `src/app/(exchange)/san/[id]/page.tsx`
- Test: case mới trong `venue-card.test.tsx`, `venue-directory-map.test.tsx` (chỉ thêm), `src/app/(exchange)/san/venue-exchange-count.test.tsx`

**Interfaces:**
- KHÔNG sửa `listVenuesNear` (I5). `VenueDirectory` nhận `exchangeEnabled`; chỉ khi true mới chạy `useQuery(["venue-exchange-counts", ids], () => countUpcomingByVenue(ids), { staleTime: 60_000 })` và hiện bộ lọc "Đang có giao lưu" (lọc phía client trên kết quả đã có). Trang chi tiết sân: khi cờ bật, mục "Giao lưu sắp tới" bằng `listUpcomingAtVenue`.
- [ ] **Step 1: Test đỏ:** `flag off: venue search issues no settings or exchange query and cards show no count`; `flag on: cards show the upcoming count and the has-exchange filter narrows the list`; `venue page lists upcoming exchanges only when the flag is on`. Test `/san` cũ xanh nguyên văn.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): show upcoming exchanges in the venue directory`

### Task 20: Admin `/admin/giao-luu`

**Files:**
- Create: `src/app/(admin)/admin/giao-luu/layout.tsx` (cờ tắt → `notFound()`, như layout `/giao-luu`, M6), `page.tsx`, `loading.tsx`, `admin-exchange-client.tsx`; `src/actions/exchange-admin.ts`
- Modify: `src/components/layout/admin-sidebar.tsx`, `admin-mobile-nav.tsx` (mục "Giao lưu" khi cờ bật, prop từ layout admin)
- Test: `src/actions/exchange-admin.integration.test.ts`, case mới trong `nav.characterization.test.tsx`

**Interfaces:**
- Mọi action: `requireAdmin` → gate → zod. `adminListExchanges(filter: "upcoming" | "hidden" | "all")`; `adminSetExchangeHidden({ eventId, hidden })` (ẩn → `notifyEventHidden`); `adminCancelExchange({ eventId })` gọi `cancelEventCore` từ `src/lib/exchange/cancel.ts`; `adminListReports(status)`; `adminResolveReport({ reportId, status: "resolved" | "dismissed" })`.
- Trang 2 tab "Buổi" / "Báo cáo", thẻ trên mobile, thao tác optimistic.
- [ ] **Step 1: Test đỏ:** `admin actions refuse a member cookie`; `hiding notifies the host; cancelling notifies registrants`; `resolving sets resolvedAt`; `admin nav shows Giao lưu only when the flag is on`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): add admin moderation for exchange events`

### Task 21: Rà toàn nhánh trước e2e

**Files:** chỉ sửa lỗi review tìm ra, mỗi lỗi kèm test hồi quy.

- [ ] **Step 1:** `finance-invariant-reviewer` trên cả nhánh: `git -C D:/Lwcifer/LW/FWBB-g2b diff <merge-commit-Task-0>..HEAD`. PASS.
- [ ] **Step 2:** `mobile-ui-reviewer` trên mọi `.tsx` mới/sửa. Sửa vi phạm.
- [ ] **Step 3:** Grep: `grep -rn "console.log\|parseFloat\|refetchInterval\|usePolling" src/actions/exchange-* src/lib/exchange* "src/app/(exchange)/giao-luu" src/components/exchange` → rỗng. `grep -rn "financialTransactions\|sessionDebts" src/actions/exchange-* src/lib/exchange*` → rỗng. `grep -rln "tx:" src/actions/exchange-*` → không có hàm export nhận `tx`. `grep -rn "—" src/i18n/messages` chỉ còn dòng có trước nhánh.
- [ ] **Step 4: Commit** (nếu có sửa) `fix(exchange): address branch review findings`

### Task 22: e2e và 4 cổng

**Files:** Create `e2e/exchange-events.spec.ts`

**Interfaces:**
- Seed như `e2e/exchange-accounts.spec.ts` và `e2e/venue-directory.spec.ts`: libsql `file:e2e/local.db`, `PRAGMA busy_timeout = 5000`, bật `exchangeEnabled` (và `notificationsEnabled` cho 1 test), khôi phục giá trị cũ ở `afterAll`; 1 sân approved gần `HERE`, 1 host approved, 1 tài khoản giao lưu pending, 1 member approved khác. Turnstile khoá test trong `test-env.sh`. Chặn style openfreemap bằng style rỗng như `e2e/venue-map.spec.ts`. `afterAll` dọn `exchange_*`, `host_blocks`, `abuse_reports`, `notifications` có `kind LIKE 'exchange_%'` của các member test và `notification_deliveries` theo `notification_id` (M11).
- [ ] **Step 1: e2e (390px):** `host opens a split-fee event and sees the estimate preview`; `guest sees the event on the list and as a pin, and is sent to login on Đăng ký`; `pending exchange account registers; host approves; registrant sees approved`; `last slot: second registrant waitlisted, promoted when the first cancels`; `host locks below minHeads after confirming; participant sees amount and QR; host marks paid`; `host checks in a participant`; `exchange account cannot open /giao-luu/mo or any group page`; `flag off: /giao-luu, /giao-luu/<code>, /admin/giao-luu return 404 and /san shows no exchange count`.
- [ ] **Step 2:** 4 cổng + full e2e, exit từng lệnh (`cmd > .superpowers/g2b/final-<x>.log 2>&1; echo "x_exit=$?"`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/g2b/test-env.sh && pnpm build` (đọc cuối log tìm "Failed to compile"/"Type error"), `source .superpowers/g2b/test-env.sh && pnpm test:e2e`. Expected: exit 0 hết; số test cũ ở Task 0 xanh đủ.
- [ ] **Step 3:** So `sqlite_master` của `e2e/local.db` với mốc Task 0: chỉ thêm bảng/index của 0029.
- [ ] **Step 4: Commit** `test(e2e): cover exchange events`
- [ ] **Step 5:** Cập nhật memory `project_exchange_events_nearby.md`: G2b xong ở `feat/g2b-events` (commit cuối, ngày), chưa deploy, bước kế G2c.

---

## Phạm vi để lại cho G2c, G2d

- **G2c (bình luận 2 khu):** `exchange_comments`, `exchange_comment_votes`, `exchange_comment_reads`, cột `exchange_events.comments_locked`. Gắn vào cuối `event-post.tsx`. Dùng lại `host_blocks` và `abuse_reports` (thêm `"comment"` vào `REPORT_TARGET_TYPES`, chỉ ở TS).
- **G2d (uy tín, đánh giá):** đọc `checked_in`, `checked_in_at`, `status` (`no_show`, `late_cancelled`), `paid_at` so với `start_at` qua `attendanceStats` và index `(member_id, checked_in)`. Thêm `members.public_code` + trang hồ sơ, `peer_feedback`, `host_feedback`, `venue_reviews`, báo cáo sân và đánh giá, người giới thiệu, cờ "host điểm danh lặp cùng nhóm người", cảnh báo nick trùng, nhãn "Mới".

## Quyết định của người viết plan (cần user soát)

1. Chặn và báo cáo làm luôn ở G2b. Lý do: chặn phải kiểm ngay lúc đăng ký, còn báo cáo buổi là thứ admin cần để ẩn buổi xấu khi mở cho người ngoài. G2b chỉ báo cáo được buổi và người (host hoặc người đăng ký). Báo cáo sân để sang G2d cùng đánh giá sân, báo cáo bình luận để sang G2c.
2. Cách phí cố định (một giá, hoặc giá nam và giá nữ) không đi qua bộ chia tiền của nhóm, chỉ dùng thẳng số host nhập. Bộ chia của nhóm tính ra giá trung bình khi ai cũng trả giá cố định, nên nam 100K, nữ 80K sẽ thành 90K cho cả hai. Hai cách chia vẫn đi qua bộ chia của nhóm đúng như spec.
3. Host không phải là một người đăng ký. Thêm ô "Số người phía bạn (gồm bạn)", mặc định 1: không chiếm slot đăng ký, nhưng được tính vào số người khi chia phí, để người tham gia không gánh phần của host.
4. Đăng ký đang chờ duyệt vẫn giữ slot, để ai đến trước được trước. Danh sách chờ không giữ slot.
5. Buổi chỉ "đầy" khi không còn slot nào. Còn slot giữ cho nữ thì buổi vẫn mở, hiện "chỉ còn slot nữ".
6. Slot giữ cho nữ tới hạn thì không có tác vụ hẹn giờ riêng: lần đăng ký, huỷ hay bất kỳ thao tác nào của host kế tiếp (kể cả chốt phí) sẽ xét lại danh sách chờ trước. Trang quản lý báo "slot nữ đã mở" và có nút "Xét danh sách chờ".
7. Mốc mở slot nữ chọn trong 4 mức: lúc hết hạn đăng ký (mặc định), 24 tiếng trước giờ chơi, 6 tiếng trước, hoặc không bao giờ.
8. Mặc định khi mở buổi: duyệt tay, không cho dắt thêm người, hạn đăng ký 2 tiếng trước giờ chơi, hạn huỷ không mất phí 12 tiếng trước giờ chơi.
9. Sau khi mở buổi chỉ sửa được: tăng slot, tiêu đề, mô tả, loại cầu, liên hệ, link nhóm Zalo, tài khoản nhận tiền. Đổi giờ, sân, cách phí hay số tiền thì phải huỷ buổi và mở buổi mới, để người đã đăng ký không bị đổi điều kiện mà không biết.
10. Chốt phí chỉ được khi không còn ai chờ duyệt. Trong lúc đã chốt thì không nhận đăng ký mới và không đẩy danh sách chờ; host mở khoá thì mới đẩy tiếp.
11. Chốt lại phí sau khi đã có người trả: giữ nguyên cờ "đã trả" và số tiền lúc trả, chỉ báo cho người có số tiền thay đổi. Người đã trả mà không còn bị tính thì được báo phí về 0, và host thấy dòng "cần hoàn".
12. Có đặt cọc (user đã đồng ý 3/11): buổi có cọc thì không tự duyệt, host bấm "Đã nhận cọc" là duyệt luôn. Cọc trừ vào phí lúc chốt. Cọc lớn hơn phí (phí thấp hơn, được miễn, bị từ chối, tự huỷ, buổi bị huỷ) thì app hiện số host cần hoàn, việc hoàn làm ngoài app.
13. Người giới thiệu để sang G2d, vì nó cần số buổi đã đến và tỉ lệ đến, là phần G2d xây.
14. Thành viên đã duyệt của nhóm không bị coi là nick mới. Giới hạn nick mới (không dắt thêm người, tối đa 2 đăng ký đang chờ) chỉ áp cho tài khoản giao lưu chưa được điểm danh buổi nào.
15. Người bị host chặn chỉ thấy lỗi chung "không đăng ký được buổi này", không nói là bị chặn. Chặn chỉ có tác dụng với đăng ký sau đó; đăng ký đang có thì host tự từ chối.
16. Đăng ký tự khai giới tính của mình và người đi kèm (điền sẵn theo hồ sơ; chưa khai hoặc LGBT thì tính như nam). G2b không thêm chỗ sửa hồ sơ cho tài khoản giao lưu.
17. "Giao lưu của tôi" nằm ở `/giao-luu/cua-toi` (không sửa `/me` cho tài khoản giao lưu như spec 4.6b viết). Menu "Cá nhân" của tài khoản giao lưu trỏ tới đây, trang này có luôn phần cài đặt thông báo. Thành viên nhóm có link từ `/me` và mục "Giao lưu" trên menu.
18. Mở buổi không phải thao tác lạc quan (optimistic) vì cần mã buổi do server sinh để chuyển trang. Nút có trạng thái đang gửi và không bấm lại được.
19. Tin báo cho host chỉ có số người, không có tên người đăng ký. Host xem tên trong trang quản lý.
20. Tin giao lưu là một nhóm mới "Giao lưu" trong cài đặt thông báo, chỉ hiện khi cờ giao lưu bật. Tin bắt buộc: được duyệt, bị từ chối, được đẩy từ danh sách chờ, chốt phí, phí đổi, buổi bị huỷ, buổi bị admin ẩn, có người huỷ sau khi đã chốt phí (gửi host). Tin tắt được: có đăng ký mới, có người huỷ trước khi chốt (gửi host). Tin báo cáo cho admin nằm trong nhóm "Thành viên" của admin.
21. G2b không có tin nhắc hẹn giờ trước buổi giao lưu (chỉ tin gửi ngay), để không tốn lượt hẹn giờ QStash.
22. Điểm danh mở từ 60 phút trước giờ chơi tới 7 ngày sau khi buổi kết thúc. Host bấm "Kết thúc buổi" sau khi đã chốt phí và đã tới giờ chơi.
23. Buổi bị admin ẩn: người lạ không mở được (404), host và người đã đăng ký vẫn xem được kèm thông báo đã ẩn.
24. Mã công khai trên hồ sơ member (`members.public_code`) để sang G2d, cùng lúc có trang hồ sơ. G2b chỉ có mã công khai cho buổi.
25. Index theo sân của bảng buổi là `(venue_id, start_at)`; spec viết `(court_id, start_at)` nhưng bảng buổi không có cột `court_id`, nên coi đó là lỗi gõ.
26. Lọc phí tối đa so với giá nam (cố định) hoặc giá nam ước tính (chia), vì giá nam luôn là giá cao nhất.
27. Nội dung chuyển khoản là "GL <mã buổi> <số đăng ký>". Không dùng component QR của quỹ nhóm vì nó gắn với tài khoản quỹ và tự hỏi lại trạng thái chuyển khoản.
28. Danh bạ sân có thêm số buổi giao lưu sắp tới trên thẻ sân, bộ lọc "Đang có giao lưu" và mục "Giao lưu sắp tới" ở trang sân, tất cả chỉ khi cờ bật. Chưa làm sắp xếp "nhiều giao lưu nhất".
29. Cảnh báo admin về nick trùng (dùng lại `dupIgnoredPairs`) để sang G2d cùng phần uy tín.
30. Lệch spec 4.6e: mỗi thao tác ghi kiểm cờ và đăng nhập TRƯỚC Turnstile (spec ghi Turnstile trước mọi truy cập DB). Lý do: đọc cờ dùng chung bộ nhớ đệm trong request với layout, đăng nhập hỏng bị loại từ cookie trước khi đọc DB, và chỉ người đã đăng nhập mới tới được bước Turnstile. Bot chưa đăng nhập vẫn bị chặn trước khi ghi gì.
31. Lệch spec 4.6b: trang tìm buổi công khai KHÔNG giới hạn số lần theo IP bằng `rateLimitBuckets` (spec 4.6b có ghi, nhưng 4.6e lại nói chỉ dùng nó cho người đã đăng nhập vì nó ghi DB). Thay vào đó, kết quả đọc qua bộ nhớ đệm 60 giây theo ô lưới, nên nhiều request giống nhau không xuống DB. Bị dội thật thì bật chặn ở Vercel Firewall.
32. Với cách chia ưu đãi nữ, số hiện lúc đăng ký chỉ là "ước tính khi toàn nam", không phải mức trần: khi có nữ trả ít hơn, phần thiếu dồn sang nam, nên nam có thể trả cao hơn số đã hiện dù đủ người. Lúc đó app hiện "phí cao hơn số đã hiện lúc đăng ký" và host phải xác nhận khi chốt. Với chia đều thì số hiện là mức trần thật.
33. Danh sách chờ chỉ được đẩy lên trước giờ chơi. Sau giờ chơi, host mở khoá để sửa phí (ví dụ miễn cho người không đến) không làm ai được đẩy lên.
34. Khi admin gộp hai tài khoản: đăng ký, buổi đang host, danh sách chặn và báo cáo của tài khoản cũ chuyển sang tài khoản giữ lại. Hai người cùng đăng ký một buổi thì giữ đăng ký của tài khoản giữ lại. Tài khoản cũ đăng ký vào buổi mà tài khoản giữ lại đang host thì đăng ký đó bị huỷ. Xoá hẳn một member có dữ liệu giao lưu thì bị chặn như khi có nợ hay vote (dùng "Vô hiệu hoá" thay thế).
35. Tài khoản giao lưu chỉ nhận email khi đã có email (thường từ Google) và đã xác minh ở "Giao lưu của tôi"; link xác minh trả họ về đúng trang đó.

## Plan review response

| Finding | Kết quả | Ghi chú |
|---|---|---|
| C1 | accepted | Đã kiểm `PRAGMA foreign_keys=ON`, `mergeMember`, duyệt-gộp và `deleteMember`; thêm Task 3 + quyết định 34 |
| C2 | accepted | Thêm `paidAmount`, người rời đi có `feeAmount = null` + tin phí đổi, kind bắt buộc `exchange_cancelled_after_lock` |
| C3 | accepted | `cancelEventCore` sang `src/lib/exchange/cancel.ts`, bỏ `actor`, thêm luật ranh giới server action ở Global Constraints |
| I1 | accepted | `fireAction` gửi lại cùng closure (đã đọc `optimistic-action.ts`); dùng `retry: false` + `resetKey` |
| I2 | accepted | `registerForExchange` chạy `settleEvent` trước khi xét người mới, có test |
| I3 | accepted | Chép mẫu `getCandidatesNearCell` (biên lưới, sắp trước khi cắt, 200 ứng viên, ngày vào khoá cache) |
| I4 | accepted | `unstable_cache` dùng `JSON.stringify`; hàm cache trả mảng cặp, thêm luật JSON thuần |
| I5 | accepted | `listVenuesNear` được gọi từ client; không sửa nó, cờ đi qua prop, đếm bằng action riêng (Task 19) |
| I6 | accepted | Theo phán quyết coordinator: merge `feat/g3-map` ở HEAD lúc thực thi, Task 15/19 viết theo bản sau đợt sửa G3 |
| I7 | accepted | Đã tính lại 600K/5/50% ra nam 120K; đổi thành "ước tính", câu cảnh báo mới, quyết định 32 |
| I8 | accepted | Thêm `depositSettlement` với `refundDue`, đưa vào tin, `ViewerExtras`, `ManageReg`, trang quản lý |
| I9 | accepted | Phần cài đặt thông báo chỉ có ở `/me`; render ở `/giao-luu/cua-toi`, route xác minh trả về đó, quyết định 35 |
| I10 | accepted | `groupNavItems` không có `/giao-luu`; thêm khi cờ bật (Task 18) |
| I11 | accepted | `settleEvent` không đẩy ai khi `now >= startAt`, quyết định 33 |
| I12 | accepted | `unblockMember` xoá kèm điều kiện `host_member_id`, có test |
| I13 | accepted | Tách `reportAbuse` thành Task 13; Task 16 cũ tách thành Task 18, 19, 20 |
| I14 | accepted | Thêm điều kiện host còn hiệu lực ở danh sách, trang buổi và đăng ký |
| M1 | accepted | Thêm key vào `MONEY_KEYS`, ICU `select` cho boolean, dịch lý do báo cáo, test email không có QR quỹ |
| M2 | accepted | Ghi thành quyết định 30, 31 theo phán quyết coordinator |
| M3 | accepted | Task 7 tạo `exchange.errors.*`, task server sau tự thêm key |
| M4 | accepted | Test `skill-level-section` chỉ render component con; tách `MeExchangeLink` để test |
| M5 | accepted | `waitingCount` chỉ đếm buổi `open/full` chưa ẩn |
| M6 | accepted | Thêm `src/app/(admin)/admin/giao-luu/layout.tsx` kiểm cờ |
| M7 | accepted | Báo cáo sân để sang G2d, ghi vào quyết định 1 và mục phạm vi |
| M8 | accepted | Mọi thao tác host và chốt phí chạy `settleEvent` trước; nút "Xét danh sách chờ" |
| M9 | accepted | Thêm `ViewerExtras.attendees` cho host và người `approved` |
| M10 | accepted | `ManageReg.accountLocked` + nhãn trên trang quản lý |
| M11 | accepted | e2e dọn thêm `notifications` và `notification_deliveries` |
| M12 | accepted | Đã kiểm `p.id === selectedId` trong `map-view.tsx`; thêm prop `selectedKey` theo `pointKey`, chỗ gọi và test G3 không đổi |
