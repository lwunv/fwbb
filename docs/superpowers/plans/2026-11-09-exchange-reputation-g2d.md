# G2d Uy tín người chơi, uy tín host, người giới thiệu và đánh giá sân Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sau mỗi buổi giao lưu, người được điểm danh chấm nhau ("Muốn chơi lại cùng", tag khen, trình độ) và trả lời 2 câu có/không về host; app nhắc họ chấm 1 giờ sau giờ kết thúc. Hồ sơ công khai `/players/{mã}` hiện uy tín tính từ dữ liệu (đã đến, tỉ lệ đến, huỷ muộn, vắng, trả đúng hạn, nhãn "Mới", trình độ do người chơi cùng chấm, uy tín host), chỉ cộng lượt chấm của buổi đã đóng chấm và có đủ người chấm. Người đáng tin giới thiệu được nick mới để bỏ giới hạn nick mới. Người đã chơi ở một sân đánh giá sân theo 6 tiêu chí; điểm có trọng số, kéo về trung bình chung; nhận xét có sđt/link/từ cấm hoặc sân bị dồn đánh giá thì chờ admin duyệt; đủ 3 báo cáo thì ẩn. Admin duyệt đánh giá, xem cờ host điểm danh lặp cùng nhóm người, và xem tín hiệu nick trùng của tài khoản giao lưu. Toàn bộ sau cờ `exchangeEnabled`.

**Architecture:** Migration 0032 chỉ thêm: 6 bảng (`peer_feedback`, `host_feedback`, `venue_reviews`, `host_flag_reviews`, `referrals`, `member_ip_signals`), cột `members.public_code` + unique index, index `session_attendees(member_id)`. Mỗi lượt chấm lưu trọng số của người chấm tại lúc chấm (`rater_weight`, đơn vị 1/5 lượt). Toán (trọng số, trung vị có trọng số, phần trăm, Bayes, bất thường, cờ host, luật giới thiệu, gom tín hiệu nick trùng) và kiểm chữ là hàm thuần ở `src/lib/reputation/`. Quyền chấm, trọng số, đọc tổng hợp, giới thiệu, tín hiệu mạng và job nhắc ở `src/lib/reputation/*.ts` có `import "server-only"`. Trang công khai đọc qua `unstable_cache` có tag theo member/sân, không có bảng đếm dẫn xuất. Vỏ action ở `src/actions/{reputation,venue-reviews,reputation-admin,referrals,exchange-dup-signals}.ts`; báo cáo mở rộng `reportAbuse` (giữ thứ tự kiểm của G2b); nhắc chấm là job một lần trong `scheduled_jobs` của N1.

**Tech Stack:** Next.js 16.2.1 App Router (server actions, `unstable_cache`, `updateTag`, `after`, `notFound`, metadata `robots`), Drizzle + Turso (libsql), zod, react-hook-form, next-intl (vi/en/zh), @tanstack/react-query 5, nuqs, framer-motion, Cloudflare Turnstile (`checkBotAndRate`, `TurnstileWidget`), N1 (`notify`, `scheduleOneOffJob`, `runJob`, QStash), vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-exchange-events-nearby-design.md`: 4.6c (người giới thiệu, nick trùng, "Uy tín người chơi", "Uy tín người mở buổi", "Trình độ", "Chống clone khen nhau", "Nick có 0 buổi ... không đánh giá", "Ai cũng báo cáo được"), 4.6d toàn bộ, 4.6e, 4.7 (`peer_feedback`, `host_feedback`, `venue_reviews`, `members.public_code`), mục 6 quyết định 13, 15. Phạm vi G2d theo G2b quyết định 13, 24, 29 và mục "Phạm vi để lại cho G2c, G2d" (`docs/superpowers/plans/2026-11-05-exchange-events-g2b.md:447`); quy ước kế thừa G2b, G2c (`docs/superpowers/plans/2026-11-06-exchange-comments-g2c.md`); ledger `D:/Lwcifer/LW/FWBB-g2b/.superpowers/sdd/2026-11-05-exchange-events-g2b/progress.md`, `D:/Lwcifer/LW/FWBB-g2c/.superpowers/sdd/2026-11-06-exchange-comments-g2c/progress.md`. Chỗ trống trang sân: Task 10 của `D:/Lwcifer/LW/FWBB-venuesux/docs/superpowers/plans/2026-11-09-venues-map-first.md` (đã làm ở `FWBB-venues10` 28c8e0f: khối `data-section="venue-reviews"`, thanh nút dính đáy `z-30`). Bản rà: `.superpowers/g2d/plan-review.md` (xử lý ở cuối plan). Phán quyết controller: nhắc chấm có làm (thay quyết định cũ), thứ tự kiểm giữ như G2b.

## Đã có sẵn trên nhánh (G2a, G2b, G2c, N1, đổi route tiếng Anh)

- `exchange_registrations.checked_in`, `checked_in_at`, index `(member_id, checked_in)`; `setCheckedIn` (khung `startAt - 60 phút` tới `endAt + 7 ngày`, đặt `status = 'approved'`); host không đăng ký được buổi của mình (`exchange-registrations.ts:129`); `late_cancelled` chỉ sinh từ `approved` sau hạn huỷ; `no_show`; `paid`, `paid_at`. `cancelEventCore` chỉ đổi trạng thái buổi, giữ nguyên trạng thái đăng ký. Sau khi mở buổi không sửa được giờ (G2b quyết định 9, `updateExchangeEvent` chỉ nhận chữ và tài khoản nhận tiền).
- Giới hạn nick mới ở 3 chỗ: `newAccountLimits` (`src/lib/exchange/attendance.ts`, dùng ở `registerForExchange` ~163 và `getExchangeEvent` ~260 cho `viewer.isNewAccount`); đoạn tự tính trong `addComment` (`exchange-comments.ts` ~222, `RL_COMMENT_DAY_NEW`); nhãn `isNewAccount` của `getManageView` (~800).
- `abuse_reports`, `reportAbuse` (thứ tự: cờ → tài khoản → zod → Turnstile → rate limit, G2b quyết định 30 user đã duyệt), `notifyReported`, `host_blocks`, `REPORT_TARGET_TYPES`.
- `exchange_events.public_code`, `newPublicCode()`. `members.public_code` CHƯA có.
- `checkBotAndRate`, `exchangeGate`, `runSerial`, `requireExchangeMember`, `getExchangeViewer`, `requireAdmin`, `getUserFromCookie` (không đọc DB), `hashedIpKey` (HMAC IP, `client-ip.ts`), `ipRateLimitKey` (IPv6 gom /64).
- `findDuplicateMembers` bỏ tài khoản giao lưu (`notExchangeAccountWhere`, commit 96d851d) vì tên Zalo hay trùng, và `mergeMember` chặn gộp tài khoản giao lưu (`members.ts:949`). Đường gộp hay gặp của tài khoản giao lưu là duyệt-gộp ở `member-approval.ts:497-519`.
- Đăng nhập giao lưu: form `/api/auth/zalo/start` → `/api/auth/zalo/callback` (state ký HMAC, giành 1 lần, `next` qua `safeNextPath`) và `googleLogin(idToken, { intent: "exchange" })`.
- N1: `scheduleOneOffJob` (có QStash thì đăng trong khung 7 ngày, KHÔNG có QStash thì chạy ngay), `runJob`, `runAfterResponse`, route `/api/notifications/jobs`, cron 06:00 VN `runDailyNotifications` (bước 2 chạy job quá giờ mọi kind, bước 3 hẹn lại job của buổi nhóm, bước dọn), catalog, `notify` (tắt theo nhóm, email theo N1).
- `detectContact`, `normalizeCommentBody`; `ReportSheet`, `ResponsiveSheet`, `TurnstileWidget`, `TabSegment`, `ConfirmSheet`, `MemberAvatar`, `nameSeed`; banner `DuplicateMembersBanner`.

## Global Constraints

- **Nơi làm:** chỉ worktree `D:/Lwcifer/LW/FWBB-g2d`, nhánh `feat/g2d-reputation` (từ `ac24260`). Không push, không merge vào `main`, không deploy (memory `feedback_g2_local_until_complete`). Chỉ đọc ở worktree khác.
- **Env và DB:** KHÔNG đọc, tạo hay sửa file `.env*`. Env test: `.superpowers/g2d/test-env.sh` (Task 0 thêm `export CRON_SECRET=<chuỗi ngẫu nhiên>`, file test gitignored), `.superpowers/g2d/local-db.env` (`TURSO_DATABASE_URL=file:e2e/local.db`). Mọi lệnh script DB kèm `--env=.superpowers/g2d/local-db.env`. Không `db:push`, không `db:seed`.
- **Kế thừa nguyên văn từ G2b và G2c:** cache trả JSON thuần; ranh giới server action C3 (file `"use server"` chỉ export action tự kiểm quyền, người thực hiện lấy từ cookie, không có `memberId`/`hostId` trong input; hàm nhận `db`/`tx` ở `src/lib/` có `import "server-only"`); Turnstile phía client (I1: `fireAction(..., { retry: false })`, sau mỗi lần gửi tăng `resetKey`); giờ lưu ISO UTC có `Z`, hiển thị theo `Asia/Ho_Chi_Minh`; log `console.error("[Reputation] <mã>", { id })`, không `console.log`, không tên, không nội dung, không IP.
- **Thứ tự kiểm ở MỌI thao tác ghi (giữ G2b quyết định 30, một thứ tự cho cả codebase):** `exchangeGate()` → `requireExchangeMember()` (hoặc `requireApprovedMember`/`requireAdmin`) → zod → `checkBotAndRate` (Turnstile rồi mới ghi rate limit; không có Turnstile thì `checkRateLimit`) → `runSerial(() => db.transaction(...))` → `updateTag` sau commit. Không dòng `rate_limit_buckets` nào được ghi trước khi cờ và tài khoản qua. `reportAbuse` giữ nguyên thứ tự và harness test. Gọi `checkRateLimit` ngoài transaction.
- **Tiền:** G2d không có tiền. KHÔNG ghi `financial_transactions`, KHÔNG đụng `session_debts`, `cost-calculator.ts`, `exchange-fee.ts`, `settle.ts`, `payment-matcher`, `finance.ts`. Task 15 sửa `member-rows.ts`, `members.ts`, `member-approval.ts` nên qua `finance-invariant-reviewer`.
- **Migration:** số **0032**. Chỉ `CREATE TABLE`, `CREATE [UNIQUE] INDEX` và đúng một `ALTER TABLE members ADD public_code text`. Thấy `__new_`, `INSERT`, `UPDATE`, `DROP`: dừng, báo controller, không sửa tay SQL. Enum ở TS, CHECK chỉ trong `CREATE TABLE` bảng mới. Sau khi áp lên `e2e/local.db`, so `sqlite_master` với mốc Task 0: chỉ thêm, đủ 18 index mới.
- **Quota Turso:** không `usePolling`, `refetchInterval`, `setInterval`. react-query `staleTime: 60_000`. Đọc công khai qua `unstable_cache`; cache còn thì không truy vấn DB (có test). Tổng hợp chỉ đọc theo index của đối tượng được chấm. Trung bình chung mọi sân chỉ làm mới theo giờ (`revalidate: 3600`), KHÔNG `updateTag` sau mỗi đánh giá. Phần riêng theo người chỉ tải khi mở sheet. Danh sách tối đa 50 dòng mỗi lần; trang đánh giá 10 dòng. G2d KHÔNG gọi `updateTag("exchange")` trừ khi gộp member (Task 15).
- **Riêng tư:** danh tính người chấm không ra ngoài: hồ sơ, dòng host, trang đánh giá sân không có tên, mã, id người chấm, không có danh sách buổi, đánh giá sân chỉ có tháng (`YYYY-MM`). Lượt chấm chỉ được cộng khi cửa sổ chấm của buổi đã đóng và buổi đó có ít nhất 3 người chấm hợp lệ cho đúng đối tượng; số người chấm công khai là `null` khi dưới 3. Không sđt/email/IP/hash. Payload công khai qua whitelist có test khoá key. Góp ý xấu chỉ qua báo cáo riêng. Hồ sơ dùng mã ngẫu nhiên 10 ký tự; id đánh giá sân lộ ra để báo cáo (như id bình luận G2c).
- **Điểm danh hợp lệ (mọi truy vấn uy tín, giới thiệu, nhắc):** `checked_in = 1 AND status = 'approved'` ở buổi `hidden_at IS NULL AND status <> 'cancelled'` (loại đăng ký bị huỷ do gộp mà vẫn giữ cờ điểm danh). `attendanceStats`/`newAccountLimits` của G2b giữ định nghĩa cũ.
- **Không đổi hành vi cũ:** không sửa expected của test có sẵn. Ngoại lệ chỉ thêm trường: `src/app/(exchange)/exchanges/[code]/fixtures.ts`, fixture `ManageReg` trong `manage-client.test.tsx`, helper `row()` trong `src/lib/exchange/comment-tree.test.ts`, fixture `author` trong `src/components/exchange/comments/fixtures.ts`, và test "coming soon" của trang sân (Task 21, chỉ ghim cờ tắt). Trường mới ở input dùng chung để tuỳ chọn (`code?: string | null`) để fixture cũ còn đúng kiểu.
- **Next 16:** đọc trước khi code `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/{unstable_cache,updateTag,not-found,generate-metadata,cookies}.md` và `03-file-conventions/{layout,page,loading,dynamic-routes}.md`.
- **Giao diện:** mobile-first 390px, vùng chạm ≥ 44px (`min-h-11`), chữ nội dung ≥ 16px, nhãn ≥ 14px, không cuộn ngang. Bottom sheet (`ResponsiveSheet`) trên mobile, nằm trên thanh nút dính đáy `z-30` của trang sân. Nút chính dính đáy. Skeleton đúng cỡ. framer-motion cho vào/ra và sheet. Chỉ token màu theme. Optimistic qua `fireAction` + rollback + `toast.error`. react-hook-form + zod cho phiếu chấm và form đánh giá sân. Tên dài xuống dòng (`break-words`). Chữ người dùng là text node trong `whitespace-pre-wrap break-words`, không `dangerouslySetInnerHTML`, không linkify.
- **i18n:** namespace `exchange.reputation.*`, `venueReviews.*`, `exchange.admin.*`, `adminMembers.dupSignals.*`, `notifications.kinds.*`, lỗi ở `exchange.errors.*`; đủ vi/en/zh, en dùng ICU plural; `src/i18n/locale-parity.test.ts` xanh; không em dash hay en dash. Chữ spec chốt dùng nguyên văn: "Mới", "Muốn chơi lại cùng", "Đúng giờ", "Vui vẻ", "Fair play", "Đánh đẹp", "Buổi đúng như mô tả?", "Phí đúng như đã báo?", "Tự khai: {self} · Người chơi cùng đánh giá: {peer} ({count} lượt)", "Đã chơi ở đây", "Chưa đủ đánh giá", "Mặt sân", "Ánh sáng", "Thoáng mát", "Giá", "Gửi xe", "Chủ sân".
- **Cổng mỗi task:** `pnpm test <file của task>`, `pnpm exec tsc --noEmit`, `pnpm exec eslint <file đã sửa>`; mỗi lệnh đọc exit riêng (`cmd > .superpowers/g2d/t<N>-<x>.log 2>&1; echo "x_exit=$?"`).
- **Commit:** Conventional Commits 1 dòng, không body, không trailer. Implementer tự commit đúng message của plan.

### Quy ước dùng chung

| Việc | Quy ước |
|---|---|
| Hằng số, tag | `src/lib/reputation/constants.ts` (Task 1) |
| Trọng số | `w5 = weight5(số buổi đã đến)` ∈ 0..5 (5 = nặng 1). "Số buổi đã đến" = điểm danh hợp lệ ở buổi giao lưu + buổi nhóm đã chốt có chơi. Chụp vào `rater_weight` mỗi lần ghi |
| Lượt chấm được cộng | buổi `endAt + 7 ngày <= now` (đã đóng chấm); người chấm (và người được chấm, với chấm người chơi) có điểm danh hợp lệ; tài khoản người chấm `is_active = 1`, không `rejected`; buổi có ít nhất 3 người chấm hợp lệ khác nhau cho đúng đối tượng; mỗi người chấm chỉ lấy dòng mới nhất (`updated_at`, rồi `id`) |
| Cửa sổ chấm | `feedbackWindow(endAt, now)`: `now < endAt` → `notYet`; `endAt ≤ now ≤ endAt + 7 ngày` → `open`; sau đó `closed` |
| Ngưỡng hiện | 3 người chấm khác nhau sau khi lọc; điểm sân cần 3 đánh giá hiện |
| Người "đã quen" (đếm báo cáo) | `establishedMemberSql`: `approved` hoặc có đăng ký `checked_in = 1` (như G2c) |
| Rate limit | chấm `exchange-feedback:{id}` 20/giờ; đánh giá sân `venue-review:{id}` 10/ngày; giới thiệu `exchange-referral:{id}` 10/ngày; báo cáo giữ `exchange-report:{id}` |
| Turnstile action | `TS_FEEDBACK = "exchange_feedback"`, `TS_REVIEW = "venue_review"`, `TS_REFERRAL = "exchange_referral"`, báo cáo giữ `TS_REPORT` |
| Tag cache | mã hồ sơ → id: `["exchange"]`; hồ sơ + uy tín: `[repTag(id)]` (`rep:m{id}`); tổng và trang đánh giá một sân: `venueReviewTag(id)` (`vrev:v{id}`); trung bình chung: `VENUE_REVIEWS_TAG` (`vrev:all`, chỉ revalidate theo giờ và khi ẩn/hiện sân) |
| Kết quả action | `{ success: true; data? } \| { error: string }` |
| dedupBase | `vrh:v{venueId}:{hourUTC}` (đánh giá bị giữ), `xrate:e{eventId}:{fp}` (nhắc chấm) |
| Job nhắc | kind `exchange_rate_reminder`, `jobKey = xrate:{eventId}:{fp}`, `fp` = 8 ký tự đầu sha256 của `endAt`, `runAt = endAt + 1 giờ` |
| URL | `/players/{code}`; `/exchanges/{code}?feedback=1` mở phiếu chấm; `/admin/exchanges?tab=reputation` |

## Review Focus

1. **Lộ người chấm hoặc lời chê:** buổi chỉ 1 hay 2 người được điểm danh, host so hồ sơ của mình trước và sau một buổi, khách xem trang sân: không số nào đổi theo một lượt gửi, không suy ra được ai chấm gì, "không bấm khen" không thành chê, không có tên/mã/id người chấm, danh sách buổi hay mốc giây trong HTML và JSON. Test ở Task 2, 6, 7, 9, 17.
2. **Vòng nick ảo khen nhau:** 5 nick 1 buổi, một người chấm cùng một người qua 10 buổi, host bỏ điểm danh, nick bị khoá, buổi bị ẩn, đăng ký bị huỷ do gộp: nick 1 buổi chỉ nặng 1/5, một người chấm tính 1 lần, lượt mất hiệu lực tự rơi khỏi điểm, khoá nick làm hồ sơ và điểm sân đổi ngay, host dựng buổi cho cùng nhóm người bị gắn cờ. Test ở Task 2, 5, 7, 11, 15.
3. **Bot, cờ tắt, mất mạng, bấm hai lần:** cờ tắt, chưa đăng nhập, token Turnstile hỏng hoặc đã dùng, gửi lại sau khi mất phản hồi, hai tab cùng gửi: cờ tắt báo không tìm thấy trước khi hỏi đăng nhập; Turnstile hỏng không ghi dòng nào (kể cả `rate_limit_buckets`); gửi lại cùng `idempotencyKey` (kể cả sau khi cửa sổ vừa đóng) trả kết quả cũ, không thành lần sửa, không tạo dòng thứ hai. Test ở Task 6, 8, 10, 12.
4. **Nhận xét tiếng Việt bị giữ nhầm hoặc lọt:** "sân lớn", "các sân", "buổi tối", "đeo kính", "Nguyễn", "Cầu Giấy", "đi muộn", "gửi xe 5.000đ", "mở cửa 5:00-22:00", "Sân có con chó của chủ chạy quanh", "inbox DM" không bị giữ; "đm", "ĐM", "d m", "đ.m", "v.c.l", "óc chó", "0912 345 678", "zalo.me/x" bị giữ; quá 500 ký tự bị từ chối; hiển thị chữ thuần. Test ở Task 3, 8, 21.
5. **Người giới thiệu và tin nhắc bị lạm dụng hoặc gửi sai:** tự giới thiệu, hai người giành cùng một nick, 6 lượt gửi song song khi còn 5 lượt, nick ảo tự gắn vào quota của host khác; job nhắc chạy hai lần, buổi bị huỷ hay ẩn sau khi hẹn, máy không có QStash: luôn đúng 1 dòng giới thiệu, không vượt 5/tháng giờ VN, mỗi người nhận tối đa 1 tin nhắc, không ai nhận tin trước giờ hay cho buổi đã huỷ. Test ở Task 12, 14.

---

### Task 0: Merge nhánh venues, chuẩn bị env, đo baseline

**Files:** không sửa code ngoài phần giải xung đột merge.

- [ ] **Step 1:** `git -C D:/Lwcifer/LW/FWBB-g2d status` sạch (trừ plan nếu chưa commit). Đọc `D:/Lwcifer/LW/FWBB-venuesux/.superpowers/sdd/2026-11-09-venues-map-first/progress.md`: phải ghi nhánh xong (gồm Task 10 trang chi tiết, final review xong); chưa xong thì dừng, báo controller. Ghi `git rev-parse feat/venues-map-first` vào `.superpowers/g2d/ledger.md`, rồi `git merge --no-ff feat/venues-map-first -m "chore: merge feat/venues-map-first into feat/g2d-reputation"`. Xung đột i18n thì giữ cả hai. Kiểm có mặt: `src/app/(exchange)/venues/[id]/page.tsx` có `data-section="venue-reviews"` và `reviewsSoon`, khoá `venues.reviewsTitle`, `venues.reviewsSoon` ở 3 file dịch. Thiếu thì dừng, báo. Ghi hash commit merge vào ledger (gọi là `<merge Task 0>`).
- [ ] **Step 2:** `pnpm install`. Kiểm không có server nào mở `D:/Lwcifer/LW/FWBB-g2c/e2e/local.db`, copy nó (kèm `-wal`, `-shm`) sang `e2e/local.db`; `pragma integrity_check` = `ok`. Copy `D:/Lwcifer/LW/FWBB-g2c/.superpowers/g2c/playwright.3111.config.ts` sang `.superpowers/g2d/`. Thêm `export CRON_SECRET=<chuỗi ngẫu nhiên 32 ký tự>` vào `.superpowers/g2d/test-env.sh`. `git check-ignore .superpowers/g2d/test-env.sh e2e/local.db` in cả hai.
- [ ] **Step 3:** `node scripts/apply-migration.mjs --env=.superpowers/g2d/local-db.env --dry-run`: "Loaded env from", tới 0031 "applied", không "WOULD APPLY". Lưu `select type, name, tbl_name, sql from sqlite_master order by name` vào `.superpowers/g2d/sqlite-master-before.txt`.
- [ ] **Step 4:** Baseline, mỗi lệnh ghi exit riêng vào `.superpowers/g2d/base-<x>.log`: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/g2d/test-env.sh && pnpm build`, `source .superpowers/g2d/test-env.sh && pnpm test:e2e` (cổng 3101 bận thì `--config .superpowers/g2d/playwright.3111.config.ts`; `e2e/product-tour.spec.ts` đỏ sau 20:30 giờ máy là lỗi có sẵn). Expected: exit 0 hết. Ghi số test vào ledger. Đỏ sẵn thì chạy lại trên `ac24260` và `feat/venues-map-first` để tách lỗi do merge hay có sẵn; do merge thì dừng, hỏi.

### Task 1: Bảng dữ liệu, migration 0032, hằng số

**Files:**
- Create: `src/lib/reputation/constants.ts`
- Modify: `src/lib/exchange/constants.ts` (`REPORT_TARGET_TYPES`), `src/db/schema.ts`
- Create: `src/db/migrations/0032_*.sql` + meta (`pnpm db:generate`)
- Test: `src/db/reputation-schema.integration.test.ts`

**Interfaces:**
- `REPORT_TARGET_TYPES = ["member", "event", "comment", "review", "venue"]` (chỉ TS).
- `src/lib/reputation/constants.ts`: `PEER_TAGS = ["on_time", "friendly", "fair_play", "nice_play"]`; `VENUE_CRITERIA = ["surface", "lighting", "ventilation", "price", "parking", "owner"]`; `VENUE_REVIEW_STATUSES = ["visible", "held", "hidden"]`; `REVIEW_HOLD_REASONS = ["contact", "banned", "anomaly"]`; `IP_SIGNAL_KINDS = ["signup", "login", "register"]`; `WEIGHT_FULL_AT = 5`; `MIN_RATERS_SHOWN = 3`; `MIN_RATERS_PER_EVENT = 3`; `FEEDBACK_WINDOW_DAYS = 7`; `FEEDBACK_MAX_PEERS = 50`; `MAX_PEER_TAGS = 4`; `VENUE_MIN_REVIEWS = 3`; `BAYES_VIRTUAL_VOTES = 5`; `REVIEW_COMMENT_MAX = 500`; `REVIEW_EDIT_COOLDOWN_DAYS = 30`; `REVIEW_DOUBLE_SUBMIT_MS = 60_000`; `REVIEW_BURST_LIMIT = 5`; `REVIEW_LOW_REP_BELOW = 3`; `REVIEW_ANOMALY_MIN_TOTAL = 3`; `REVIEW_ANOMALY_WINDOW_DAYS = 90`; `REVIEW_REPORT_HIDE_THRESHOLD = 3`; `REVIEW_PAGE_SIZE = 10`; `REVIEW_MAX_OFFSET = 490`; `HOST_FLAG_WINDOW_DAYS = 90`; `HOST_FLAG_MIN_EVENTS = 3`; `HOST_FLAG_SHARE_PCT = 80`; `HOST_FLAG_MIN_CAPTIVES = 3`; `HOST_FLAG_ROW_CAP = 5000`; `REFERRAL_MIN_ATTENDED = 3`; `REFERRAL_MIN_RATE_PCT = 80`; `REFERRAL_MONTHLY_LIMIT = 5`; `REFERRAL_WATCH_DAYS = 30`; `REFERRAL_STRIKES = 2`; `REFERRAL_BLOCK_DAYS = 30`; `IP_SIGNAL_RETENTION_DAYS = 30`; `IP_SIGNAL_PRUNE_BATCH = 200`; `DUP_BURST_MIN = 3`; `DUP_BURST_WINDOW_MS = 86_400_000`; `DUP_SIGNAL_ROW_CAP = 5000`; `RATING_REMINDER_DELAY_MS = 3_600_000`; `RATING_JOB_KIND = "exchange_rate_reminder"`; `PROFILE_REVALIDATE_S = 600`; `PRIOR_REVALIDATE_S = 3600`; `RL_FEEDBACK = { limit: 20, windowMs: 3_600_000 }`; `RL_REVIEW = { limit: 10, windowMs: 86_400_000 }`; `RL_REFERRAL = { limit: 10, windowMs: 86_400_000 }`; `TS_FEEDBACK`, `TS_REVIEW`, `TS_REFERRAL` (Quy ước); `repTag(memberId)`, `venueReviewTag(venueId)`, `VENUE_REVIEWS_TAG`; type `PeerTag`, `VenueCriterion`, `VenueReviewStatus`, `ReviewHoldReason`, `IpSignalKind`.
- Schema:
  - `members.publicCode` text nullable + `uniqueIndex("members_public_code_unique")` (cạnh `members_username_unique`).
  - `sessionAttendees`: `index("session_attendees_member_idx").on(table.memberId)`.
  - `peerFeedback`: `id`; `eventId` FK notNull; `fromMemberId`, `toMemberId` FK notNull; `playAgain` boolean notNull default false; `tags` text notNull default `"[]"`; `skillLevel` enum `SKILL_LEVELS` nullable; `raterWeight` integer notNull; `createdAt`, `updatedAt` notNull. Unique `(event_id, from_member_id, to_member_id)`; index `(to_member_id, updated_at)`, `(from_member_id)`. CHECK `rater_weight BETWEEN 0 AND 5`, `from_member_id <> to_member_id`.
  - `hostFeedback`: `id`; `eventId` FK notNull; `fromMemberId` FK notNull; `asDescribed`, `feeAsPromised` boolean notNull; `raterWeight` integer notNull; `idempotencyKey` text nullable; `createdAt`, `updatedAt` notNull. Unique `(event_id, from_member_id)`; index `(from_member_id)`. CHECK `rater_weight BETWEEN 0 AND 5`.
  - `venueReviews`: `id`; `venueId` FK notNull; `memberId` FK notNull; 6 cột `score*` integer notNull; `comment` nullable; `status` default `"visible"`; `holdReason` nullable; `reportCount` integer notNull default 0; `raterWeight` integer notNull; `idempotencyKey` nullable; `createdAt`, `updatedAt` notNull; `editedAt` nullable. Unique `(venue_id, member_id)`; index `(venue_id, status, created_at)`, `(status, updated_at)`, `(member_id)`. CHECK mỗi điểm `BETWEEN 1 AND 5`, `report_count >= 0`, `rater_weight BETWEEN 0 AND 5`.
  - `hostFlagReviews`: `id`; `hostMemberId` FK notNull; `captives` integer notNull; `reviewedAt` notNull. Unique `(host_member_id)`. CHECK `captives >= 0`.
  - `referrals`: `id`; `referrerMemberId`, `refereeMemberId` FK notNull; `createdAt` notNull. Unique `(referee_member_id)`; index `(referrer_member_id, created_at)`. CHECK `referrer_member_id <> referee_member_id`.
  - `memberIpSignals`: `id`; `memberId` FK `onDelete: "cascade"` notNull; `ipHash` text notNull; `kind` enum `IP_SIGNAL_KINDS` notNull; `firstSeenAt`, `lastSeenAt` notNull. Unique `(member_id, ip_hash, kind)`; index `(ip_hash, last_seen_at)`, `(last_seen_at)` (cho lệnh dọn theo lô).
  - `exchangeEvents`: thêm `index("exchange_events_end_at_idx").on(table.endAt)` cho bước cron quét buổi theo `end_at` (các index sẵn có đều bắt đầu bằng `status`, `venue_id` hoặc `host_member_id`, không phủ được điều kiện khoảng `end_at`).

- [ ] **Step 1: Test đỏ** (mẫu `src/db/exchange-comments-schema.integration.test.ts`): `creates the six new tables with every declared index (18 new indexes, including member_ip_signals(last_seen_at) and exchange_events(end_at))`; `members.public_code is unique but allows many NULLs`; `members.public_code defaults to NULL`; `session_attendees gets the member index`; `peer feedback (event, from, to) is unique and a self pair is rejected`; `host feedback (event, from) is unique`; `venue review score 0 or 6 and rater_weight 6 are rejected; (venue, member) is unique`; `referrals referee is unique and a self referral is rejected`; `member_ip_signals (member, hash, kind) is unique and rows go away with the member`. (Test DB áp mọi migration một lần, nên việc `CREATE UNIQUE INDEX` trên bảng `members` có dữ liệu chỉ được kiểm ở Step 4.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Viết, `pnpm db:generate`, mở file 0032 kiểm đúng loại câu lệnh.
- [ ] **Step 4:** PASS. `node scripts/apply-migration.mjs --env=.superpowers/g2d/local-db.env`, so `sqlite_master` với mốc: chỉ thêm, đủ 18 index mới (3 `peer_feedback`, 2 `host_feedback`, 4 `venue_reviews`, 1 `host_flag_reviews`, 2 `referrals`, 3 `member_ip_signals`, `members_public_code_unique`, `session_attendees_member_idx`, `exchange_events_end_at_idx`).
- [ ] **Step 5: Commit** `feat(reputation): add rating, referral and signal tables and member public codes`

### Task 2: Toán uy tín (thuần)

**Files:** Create `src/lib/reputation/score.ts`; Test `src/lib/reputation/score.test.ts`

**Interfaces** (số nguyên, trừ `formatTenths`):
- `weight5(attended: number): number` (kẹp `floor` vào 0..5; NaN, âm → 0); `roundHalfUp(num, den): number` = `Math.floor((2 * num + den) / (2 * den))`; `percent(part, whole): number | null` (`whole <= 0` → null).
- `feedbackWindow(endAt: string, now: Date): "notYet" | "open" | "closed"`; `windowClosed(endAt: string, now: Date): boolean` = `now >= endAt + 7 ngày`.
- `canRate(event: Pick<PublicExchangeEvent, "endAt" | "status" | "hidden">, my: { checkedIn: boolean } | null, now: Date): boolean` = `my?.checkedIn && !hidden && status !== "cancelled" && feedbackWindow(endAt, now) === "open"`.
- `keepEventsWithRaters<T extends { eventId: number; fromId: number }>(rows: T[], min: number): T[]`: bỏ hết dòng của buổi có ít hơn `min` người chấm khác nhau.
- `latestPerRater<T extends { id: number; fromId: number; updatedAt: string }>(rows: T[]): T[]`.
- `weightedMedianSkill(entries: { level: SkillLevel; w5: number }[]): SkillLevel | null` (bỏ `w5 <= 0`; mức nhỏ nhất có `2 * cộng dồn >= Σ w5`; rỗng → null).
- `type PeerRow = { id; eventId; fromId; updatedAt; w5; playAgain: boolean; tags: string[]; skill: SkillLevel | null }`.
- `type PeerSummary = { raters: number | null; playAgain: number | null; tags: { tag: PeerTag; count: number }[]; skill: { level: SkillLevel; raters: number } | null }`.
- `summarizePeer(rows: PeerRow[]): PeerSummary`: `keepEventsWithRaters(rows, MIN_RATERS_PER_EVENT)` → `latestPerRater`; dưới `MIN_RATERS_SHOWN` người → `{ raters: null, playAgain: null, tags: [], skill: null }`. Còn lại `playAgain = floor(Σ w5 có bấm / 5)` (0 → null); tag `count = floor(Σ w5 / 5)`, bỏ tag 0, xếp `count` giảm rồi thứ tự `PEER_TAGS`; `skill` khi ít nhất 3 người có chọn trình độ.
- `type HostRow = { id; eventId; fromId; updatedAt; w5; asDescribed: boolean; feeAsPromised: boolean }`; `summarizeHost(rows): { raters: number | null; asDescribedPct: number | null; feeAsPromisedPct: number | null }` (cùng lọc theo buổi rồi người; dưới 3 → mọi trường null).
- `type VenueSums = { count: number; w: number } & Record<VenueCriterion, number>`; `type VenueScore = { count: number; overall: number | null; criteria: Record<VenueCriterion, number | null> }` (1/10 điểm).
- `venueScore(venue: VenueSums, prior: VenueSums): VenueScore`: `count < 3` → null; `B = 25`; `prior.w = 0` dùng trung bình 3; tiêu chí `roundHalfUp(10 * (venue[c] * prior.w + B * prior[c]), (venue.w + B) * prior.w)`; điểm chung với `S = Σ venue[c]`, `P = Σ prior[c]`, mẫu `6 * (venue.w + B) * prior.w`.
- `isReviewAnomalous(x: { recent24h: number; total: number; lowRep: number }): boolean` = `recent24h >= 5 || (total >= 3 && 2 * lowRep > total)`.
- `formatTenths(tenths: number, locale: string): string`; `vnMonth(iso: string): string` (`YYYY-MM` theo giờ VN).

- [ ] **Step 1: Test đỏ:**
  - `weight5: 0, 1, 4, 5, 12, -1, NaN → 0, 1, 4, 5, 5, 0, 0`; `roundHalfUp: 5/2 → 3, 7/3 → 2, 1/2 → 1, 0/9 → 0`; `percent: 2 of 3 → 67, 1 of 3 → 33, 0 of 0 → null`.
  - `feedbackWindow: endAt minus 1 ms notYet; endAt open; endAt plus 7 days open; plus 7 days and 1 ms closed`; `windowClosed is true exactly at endAt plus 7 days`; `canRate: checked in inside the window yes; not checked in, hidden, cancelled or outside the window no`.
  - `keepEventsWithRaters drops every row of an event with 2 raters and keeps an event with 3`.
  - `latestPerRater keeps the newest row per rater and breaks a same-time tie by the larger id`.
  - `weighted median: [tb 1, tb 1, tbk 5] → tbk; [yeu 5, tb 5] → yeu; [tby 1, tb 1, tbk 1] → tb; empty or all 0 → null`.
  - `two raters show nothing and raters is null`; `ratings from three events with one rater each show nothing`.
  - `five one-event raters at one event add up to one play-again; three one-event raters show no play-again line`.
  - `one rater who rated the same player in three events counts once with the latest answer`.
  - `tags under one full weight are dropped; the rest sort by count then fixed order`; `peer skill needs three raters who picked a level`.
  - `host percent is weighted: two full-weight yes and one 1/5 no at one event → 91`.
  - `venue score: under 3 reviews all null; three perfect full-weight reviews with an empty prior → 38; three perfect one-event reviews against a prior of 3 → 32; 3,25 rounds to 33; overall uses the same pull`.
  - `anomaly: 5 new in 24h true; 2 of 3 under 3 events true; 1 of 2 false; 2 of 4 false`.
  - `formatTenths 43 → "4,3" in vi, "4.3" in en`; `vnMonth("2026-10-31T18:00:00.000Z") → "2026-11"`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): add weighted reputation and venue score math`

### Task 3: Kiểm chữ nhận xét sân (thuần)

**Files:** Create `src/lib/reputation/review-text.ts`; Test `src/lib/reputation/review-text.test.ts`

**Interfaces:**
- `normalizeReviewComment(raw: string): string` = `normalizeCommentBody(raw)`.
- `BANNED_EXACT` (so trên chữ thường NFC còn dấu, nguyên từ theo ranh giới chữ/số Unicode): `đm`, `đmm`, `đcm`, `địt`, `đéo`, `đĩ`, `đụ`, `đù má`, `lồn`, `cặc`, `buồi`, `óc chó`, `súc vật`, `mất dạy`, `ngu như bò`, `vãi lồn`.
- `BANNED_ASCII` (so trên token sau `foldAscii`): `dmm`, `dcm`, `dkm`, `vcl`, `vkl`, `clm`, `cmm`, `loz`. `BANNED_SQUEEZED` (chỉ so trên chuỗi ghép từ các token 1 chữ cái liền nhau, như "d m", "đ.m", "v.c.l"): `dm`, `vcl`, `dcm`, `dmm`.
- `foldAscii(s: string): string`: NFD, bỏ dấu, `đ` → `d`, chữ thường, ký tự không phải `[a-z0-9]` thành dấu cách, gộp cách.
- `findBannedTerm(comment: string): string | null`; `checkReviewText(comment): { hold: false } | { hold: true; reason: "contact" | "banned" }` (`detectContact` trước).

- [ ] **Step 1: Test đỏ:** `holds phones and links: "gọi 0912 345 678", "zalo.me/0912345678", "shopee.vn/abc"`; `holds profanity with marks, caps and spacing: "đm", "ĐM sân", "d m", "đ.m", "vcl", "v.c.l", "óc chó", "đéo", "địt"`; `does not hold everyday words: "sân lớn", "các sân", "buổi tối", "đeo kính", "Nguyễn", "ngủ", "Cầu Giấy", "đi muộn", "dịch vụ", "gửi xe 5.000đ", "mở cửa 5:00-22:00", "giá 120.000/giờ", "Sân có con chó của chủ chạy quanh", "inbox DM chủ sân"`; `contact wins over banned`; `normalize strips control chars like comments`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): hold venue review comments with contacts or banned words`

### Task 4: Mã hồ sơ công khai cho member

**Files:**
- Create: `src/lib/reputation/member-code.ts` (`server-only`)
- Modify: `src/actions/exchange-events.ts`, `src/actions/exchange-registrations.ts`, `src/lib/exchange/public-event.ts`, `src/actions/exchange-read.ts`, `src/actions/exchange-host.ts` (`getManageView`), `src/app/(exchange)/exchanges/[code]/fixtures.ts`
- Test: `src/lib/reputation/member-code.integration.test.ts`; case mới trong `exchange-events-create.integration.test.ts`, `exchange-registrations.integration.test.ts`, `exchange-read.integration.test.ts`, `src/lib/exchange/public-event.test.ts`

**Interfaces:**
- `ensureMemberPublicCode(db: DbOrTx, memberId: number): Promise<string>`: có mã thì trả; không thì tối đa 5 lần `UPDATE members SET public_code = :code WHERE id = :id AND public_code IS NULL`, trùng UNIQUE thì thử mã mới, đọc lại và trả mã đang lưu; hết 5 lần thì throw.
- Gọi bằng `db`, sau Turnstile và rate limit, trước transaction: `createExchangeEvent` trước vòng thử mã buổi, bọc `try` (lỗi → `console.error("[Reputation] code_failed", { memberId })`, trả `saveFailed`); `registerForExchange` trước `runSerial` (trong `try` sẵn có).
- `PublicExchangeEvent.host.code: string | null`; input `host` của `toPublicExchangeEvent` có `code?: string | null` (thiếu → null). `ViewerExtras.attendees[].code: string | null`. `PUBLIC_EXCHANGE_EVENT_KEYS` không đổi.

- [ ] **Step 1: Test đỏ:** `ensure assigns a 10-character code once and returns the same code next time`; `two concurrent ensures end with one stored code`; `a taken code is retried with a new one`; `a code failure on create returns saveFailed instead of throwing`; `creating an event gives the host a code; registering gives the registrant one`; `a failed Turnstile on register assigns no code`; `public event carries host.code and the same top-level keys`; `guest JSON has no attendee code; an approved registrant gets attendee codes`.
- [ ] **Step 2:** FAIL → viết → PASS + `pnpm test src/actions/exchange-events src/actions/exchange-registrations src/actions/exchange-read src/lib/exchange "src/app/(exchange)/exchanges"`.
- [ ] **Step 3: Commit** `feat(reputation): give hosts and registrants a public profile code`

### Task 5: Ai được chấm, trọng số, quyền đánh giá sân (server)

**Files:** Create `src/lib/reputation/eligibility.ts` (`server-only`); Test `src/lib/reputation/eligibility.integration.test.ts`

**Interfaces:**
- `validCheckInSql(reg, ev): SQL` = điểm danh hợp lệ (Global Constraints), dùng ở mọi truy vấn uy tín.
- `raterWeight5(db, memberId): Promise<number>` = `weight5(a + b)`; `a` = điểm danh hợp lệ (`LIMIT 5`); `b` = `session_attendees` của member, `is_guest = 0`, `attends_play = 1`, buổi `completed` (`LIMIT 5`).
- `establishedMemberSql(memberId: SQLWrapper, approvalStatus: SQLWrapper): SQL`.
- `type FeedbackPeer = { registrationId; memberId; name; avatarUrl; avatarKey; code: string | null }`; `type FeedbackContext = { event: { id; publicCode; title; hostMemberId; endAt }; host: { name; avatarUrl; avatarKey; code: string | null }; state: "notYet" | "open" | "closed"; closesAt: string; myRegistrationId: number | null; peers: FeedbackPeer[] }`.
- `loadFeedbackContext(db, code, viewerId, now): Promise<FeedbackContext | null>`: null khi không có buổi, buổi ẩn hoặc huỷ; `myRegistrationId` = đăng ký có điểm danh hợp lệ của người xem (không có thì `peers = []`); `peers` = các đăng ký có điểm danh hợp lệ khác, theo `id`, tối đa `FEEDBACK_MAX_PEERS`.
- `venueReviewEligible(db, venueId, memberId): Promise<boolean>`: điểm danh hợp lệ ở buổi giao lưu của sân đó, HOẶC `session_attendees` (`is_guest = 0`, `attends_play = 1`) ở buổi nhóm `completed` có `courts.venue_id = venueId`.

- [ ] **Step 1: Test đỏ:** `weight adds valid exchange check-ins and completed group sessions and caps at 5`; `check-ins at hidden or cancelled events, a merge-cancelled registration that kept checked_in, guest rows and dine-only rows do not count`; `EXPLAIN QUERY PLAN of the weight uses session_attendees_member_idx and exchange_registrations_member_checked_in_idx, no SCAN`; `context window: notYet before endAt, open at endAt and at endAt plus 7 days, closed 1 ms later`; `context is null for a hidden or cancelled event and an unknown code`; `a viewer not checked in gets no peers`; `peers never include the viewer or the host`; `venue eligibility: check-in there yes, at another venue no, registered not checked in no, group session at a linked court yes, unlinked court no, session not completed no`; `established: approved yes, pending with a check-in yes, pending without no`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): decide who may rate and how much each rating weighs`

### Task 6: Chấm sau buổi (server)

**Files:** Create `src/actions/reputation.ts`; i18n `exchange.errors.{feedbackNotFound, feedbackNotYet, feedbackClosed, feedbackNotAllowed}`; Test `src/actions/reputation-feedback.integration.test.ts`, `src/actions/reputation-exports.test.ts`

**Interfaces:**
- `type FeedbackForm = { state: "notYet" | "open" | "closed" | "notEligible"; closesAt: string; host: FeedbackContext["host"]; hostAnswer: { asDescribed: boolean; feeAsPromised: boolean } | null; peers: (Omit<FeedbackPeer, "memberId"> & { mine: { playAgain: boolean; tags: PeerTag[]; skill: SkillLevel | null } | null })[] }`.
- `getEventFeedbackForm(code: string)` → `{ success: true; data: FeedbackForm } | { error }`: cờ → tài khoản → `loadFeedbackContext`; không được điểm danh → `notEligible`, `peers: []`. Chỉ có câu trả lời của chính người xem, không `memberId`.
- `submitEventFeedback(input: unknown)` → `{ success: true; data: { saved: number } } | { error }`. Thứ tự theo Global Constraints (khoá `exchange-feedback`, `TS_FEEDBACK`). Zod: `{ code: string 1..64; host: { asDescribed: boolean; feeAsPromised: boolean }; peers: { registrationId: int > 0; playAgain: boolean; tags: PeerTag[] (≤ 4, không trùng); skill: SkillLevel | null }[] (≤ 50, không trùng id); idempotencyKey: uuid; turnstileToken: string 1..4096 }`. Trong tx: (0) `gate`-free (không thông báo); (1) `host_feedback` (buổi theo mã, tôi) có cùng `idempotencyKey` → `{ saved: 0 }` (đứng TRƯỚC kiểm cửa sổ); (2) `loadFeedbackContext`: null → `feedbackNotFound`, `notYet`/`closed` → lỗi tương ứng, không được điểm danh → `feedbackNotAllowed`; (3) mọi `registrationId` phải trong `ctx.peers`, không thì từ chối cả lần gửi; (4) `w5 = raterWeight5`; (5) mỗi người: rỗng → xoá dòng nếu có, còn lại upsert (giữ `created_at`, `tags` JSON sắp theo `PEER_TAGS`); (6) upsert `host_feedback` với `idempotencyKey`. KHÔNG `updateTag` (điểm chỉ đổi khi cửa sổ đóng, cache hồ sơ tự hết hạn). Lỗi DB: `console.error("[Reputation] feedback_failed", { eventId })`, trả `saveFailed`.

- [ ] **Step 1: Test đỏ** (mock `@/lib/member-auth`, `checkBotAndRate`, `@/lib/exchange-flag`, `next/cache`; `vi.setSystemTime`):
  - `flag off returns notFound before auth and before Turnstile`; `anonymous submit is rejected before Turnstile`.
  - `failed Turnstile writes nothing: no rate_limit_buckets row and no feedback row` (`checkBotAndRate` thật, `verifyTurnstile` mock trả lỗi).
  - `checked-in player rates two co-players and the host in one submit; rows carry the rater's weight (1-event rater 1, 7-event rater 5)`.
  - `same idempotencyKey again writes nothing, also right after the window closed`; `a new key updates answers in place, still one row per pair`; `two concurrent submits from two tabs end with one row per pair and one host_feedback row`.
  - `clearing every answer for a co-player deletes that row`.
  - `a registration of another event, the viewer's own, one not checked in, or a made-up id rejects the whole submit and writes no row`.
  - `the host cannot submit and is never a peer`; `before endAt feedbackNotYet; 1 ms after endAt plus 7 days feedbackClosed; hidden or cancelled event feedbackNotFound`.
  - `the form returns only the viewer's own answers and no member id`; `a viewer not checked in gets notEligible with no names`.
  - `submit never calls updateTag`.
  - `reputation exports exactly getEventFeedbackForm and submitEventFeedback`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): let checked-in players rate each other and the host`

### Task 7: Đọc uy tín: hồ sơ, host, số liệu đến (server, cache)

**Files:**
- Create: `src/lib/reputation/public-profile.ts` (thuần), `src/lib/reputation/profile-read.ts` (`server-only`), `src/test-utils/next-cache-store.ts`
- Test: `src/lib/reputation/profile-read.integration.test.ts`, `src/lib/reputation/public-profile.test.ts`

**Interfaces:**
- `type AttendanceSummary = { attended; approvedPast; lateCancels; noShows; charged; paidOnTime: number; isNew: boolean }`.
- `attendanceSummaries(db, members: { id; approvalStatus }[], now): Promise<Map<number, AttendanceSummary>>`: 1 truy vấn `GROUP BY member_id`, buổi không ẩn, không huỷ: `attended` = điểm danh hợp lệ và `end_at < now`; `approvedPast` = `status IN ('approved','no_show','late_cancelled')`, `end_at < now`, buổi có ít nhất 1 điểm danh hợp lệ; `lateCancels`, `noShows` theo trạng thái; `charged` = `fee_amount > 0`, `fee_waived = 0`, trạng thái tính phí, buổi `locked|done`, `now > start_at + 24h`; `paidOnTime` = trong `charged`, `paid = 1 AND paid_at <= strftime('%Y-%m-%dT%H:%M:%fZ', start_at, '+1 day')`; `isNew` theo định nghĩa G2b (không `approved`, không có đăng ký `checked_in = 1` nào).
- `type HostSummary = { organized: number; cancelled: number; cancelPct: number | null; raters: number | null; asDescribedPct: number | null; feeAsPromisedPct: number | null }`: `organized` = buổi không huỷ, không ẩn, `end_at < now`, có điểm danh hợp lệ; `cancelled` = buổi không ẩn, huỷ, có ít nhất 1 đăng ký `approved` (cancelEventCore giữ nguyên trạng thái đăng ký); `cancelPct = percent(cancelled, organized + cancelled)`.
- `type Reputation = { member: { name; avatarUrl; avatarKey; skillLevel; approvalStatus; isActive }; attendance: AttendanceSummary; peer: PeerSummary; host: HostSummary | null; referred: boolean }` (`referred` do Task 12 điền; trước đó là `false`).
- `loadReputation(db, memberId, now): Promise<Reputation | null>`: đọc member; dòng chấm người chơi (`to_member_id = id`, lọc "Lượt chấm được cộng" trừ bước 3 người/buổi, `ORDER BY updated_at DESC, id DESC LIMIT 500`) → `summarizePeer` (lọc 3 người/buổi ở đây); host: đếm + dòng `host_feedback` (join theo `host_member_id`, cùng lọc, `LIMIT 500`) → `summarizeHost`.
- `type PublicPlayerProfile = { code; name; avatarUrl; avatarKey; selfSkill: SkillLevel | null; isNew: boolean; referred: boolean; attendance: Omit<AttendanceSummary, "isNew">; peer: PeerSummary; host: HostSummary | null }`; `PUBLIC_PLAYER_PROFILE_KEYS`; `toPublicPlayerProfile(code, rep)` (whitelist, không spread).
- `getPublicProfile(code: string): Promise<PublicPlayerProfile | null>`: cờ tắt → null trước khi đọc DB; mã không khớp `^[a-hjkmnp-z2-9]{10}$` → null. Cache 1: `unstable_cache(() => memberIdByCode(code), ["pcode", code], { tags: ["exchange"], revalidate: PROFILE_REVALIDATE_S })()` → `{ id } | null` (chỉ id). Cache 2: `unstable_cache(() => loadReputation(db, id, new Date()), ["rep", String(id)], { tags: [repTag(id)], revalidate: PROFILE_REVALIDATE_S })()`; khoá hoặc `rejected` → null.
- `createCacheStore()` (`test-utils`): như mock của `exchange-comments-read.integration.test.ts` nhưng khoá là `JSON.stringify([keyParts, args])`; `updateTag(tag)` xoá mục có tag đó.

- [ ] **Step 1: Test đỏ:**
  - `attendance counts only past, visible, uncancelled events with a valid check-in; approvedPast only where the host checked someone in`; `a merge-cancelled registration with checked_in 1 is not attended`.
  - `paid exactly at start plus 24h is on time, 1 ms later is late; unpaid or waived rows are not charged; events less than 24h past start are not counted`.
  - `isNew: approved never; pending without a check-in yes; one check-in anywhere no`; `attendance for three members runs one query`.
  - `ratings of an event still inside its 7-day window are not counted`; `an event with 2 raters of a player adds nothing even when the total reaches 3`.
  - `host views their profile before and after a one-player event: no number changes`.
  - `peer feedback from a rater later un-checked-in, a locked rater, a hidden event, or to a target later un-checked-in is left out`.
  - `organized counts past, uncancelled, visible events with a check-in; a cancelled event with no approved registration does not count as cancelled`.
  - `host percentages need three raters per event and use each rater's latest answer; raters is null below 3`.
  - `profile has exactly PUBLIC_PLAYER_PROFILE_KEYS; JSON has no member id, email, phone, event code or rater name`.
  - `the code cache stores only the id; a second read runs no DB query; updateTag(repTag(id)) refreshes name, skill and numbers`.
  - `locked, rejected, unknown or malformed code returns null; flag off returns null before any DB read`.
  - `EXPLAIN QUERY PLAN of peer rows, host rows and attendance has no SCAN of peer_feedback, host_feedback or exchange_registrations`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): read player and host reputation through the cache`

### Task 8: Viết và sửa đánh giá sân (server)

**Files:**
- Create: `src/actions/venue-reviews.ts`, `src/lib/notifications/venue-reviews.ts` (`server-only`)
- Modify: `src/lib/notifications/catalog.ts` (`venue_review_held`), `render.ts`, i18n `notifications.kinds.venue_review_held`, `exchange.errors.{reviewVenueNotFound, reviewNotEligible, reviewEditTooSoon, reviewHidden}`
- Test: `src/actions/venue-reviews-write.integration.test.ts`; case mới trong `catalog.test.ts`, `render.test.ts`

**Interfaces:**
- `submitVenueReview(input: unknown)` → `{ success: true; data: { id: number; status: VenueReviewStatus } } | { error }`. Thứ tự theo Global Constraints (khoá `venue-review`, `TS_REVIEW`). Zod: `{ venueId; scores: Record<VenueCriterion, int 1..5>; comment: string ≤ 2000 thô, ≤ 500 sau chuẩn hoá (rỗng → null); idempotencyKey: uuid; turnstileToken }`. Trong tx:
  0. `gate = await isNotificationsEnabled(tx)`.
  1. Sân `approved`, không thì `reviewVenueNotFound`.
  2. Dòng (sân, tôi) có cùng `idempotencyKey` → trả `{ id, status }` đang lưu.
  3. `venueReviewEligible` false → `reviewNotEligible`.
  4. Dòng cũ `hidden` → `reviewHidden`. Có `editedAt` và `now - editedAt < 30 ngày` → `reviewEditTooSoon` (`{ date }` giờ VN). Dòng cũ tạo dưới `REVIEW_DOUBLE_SUBMIT_MS` và chưa có `editedAt` (hai tab gửi lần đầu): cập nhật nhưng KHÔNG đặt `editedAt`.
  5. `checkReviewText` → `held` + `contact`/`banned`.
  6. Đánh giá MỚI chưa bị giữ: `recent24h` = dòng của sân tạo trong 24 giờ (mọi trạng thái trừ `hidden`); `total`, `lowRep` chỉ trên dòng `visible` có `created_at` trong 90 ngày; cộng đánh giá đang gửi; `isReviewAnomalous` → `held` + `anomaly`.
  7. Sửa: chữ sạch mà lý do cũ là `anomaly` thì vẫn `held`; lý do cũ `contact`/`banned` thì `visible`.
  8. `w5 = raterWeight5`; insert hoặc update (`editedAt` theo bước 4, `updatedAt`, `idempotencyKey`, giữ `reportCount`).
  9. `held` → `notifyVenueReviewHeld(tx, { venueId, venueName }, gate, now)`.
  Sau commit: `updateTag(venueReviewTag(venueId))` (không đụng `VENUE_REVIEWS_TAG`).
- `type MyVenueReview = { eligible: boolean; review: { id: number; scores; comment; status; holdReason; month: string; editedAt: string | null } | null; nextEditAt: string | null }`; `getMyVenueReview(venueId)` (cờ → tài khoản → zod, chỉ đọc).
- `notifyVenueReviewHeld`: kind `def("admin", "admin_members", false, false, "now")`, payload `{ venueName }`, `superadminRecipients`, dedupBase theo Quy ước; href admin → `/admin/exchanges?tab=reputation`.

- [ ] **Step 1: Test đỏ:** `flag off returns notFound before auth and Turnstile`; `failed Turnstile writes no rate_limit_buckets row and no review`; `an eligible member posts a visible review with the snapshot weight`; `an ineligible member gets reviewNotEligible`; `a phone, a link or a banned word holds the review with its reason and notifies admins once per venue per hour`; `the fifth new review in 24 hours is held for anomaly, an edit is not`; `the third review, two of them from accounts under 3 events, is held for anomaly`; `after the admin approves the low-rep reviews, a new review from an established account is visible`; `low-rep reviews older than 90 days do not hold new ones`; `first edit right away is allowed; the next edit at 30 days minus 1 s is refused with the date; at exactly 30 days it is allowed`; `a resend with the same idempotencyKey returns the stored id and status and is not an edit`; `two first submits from two tabs within a minute end with one row and no editedAt`; `a hidden review cannot be edited; held-for-contact edited clean turns visible; held-for-anomaly stays held`; `comment over 500 characters rejected; empty stored as null`; `score 0 or 6 rejected`; `pending or hidden venue gives reviewVenueNotFound`; `updateTag gets vrev:v{id} only`; `getMyVenueReview returns eligibility, id, month and nextEditAt`; `catalog: venue_review_held has vi/en/zh title and body`; `href opens /admin/exchanges?tab=reputation`; `payload has no reviewer name and no comment`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(venues): let players who played at a venue review it`

### Task 9: Đọc đánh giá sân (server, cache)

**Files:** Create `src/lib/reputation/venue-review-read.ts` (`server-only`); Modify `src/actions/venue-reviews.ts`, `src/actions/venues.ts` (`setVenueStatus`); Test `src/actions/venue-reviews-read.integration.test.ts`, `src/actions/venue-reviews-exports.test.ts`, case mới trong `src/actions/venues-admin.integration.test.ts`

**Interfaces:**
- `getVenueReviewSummary(venueId): Promise<VenueScore | null>`: cờ tắt → null. Tổng của sân: cache `["vrev-sum", String(venueId)]`, tag `venueReviewTag(venueId)`, revalidate 600; trung bình chung: cache `["vrev-prior"]`, tag `VENUE_REVIEWS_TAG`, revalidate 3600 (một lần quét mỗi giờ). Cả hai chỉ cộng dòng `visible` của tài khoản còn hiệu lực, join `venues` lọc `approved`. Ghép bằng `venueScore` ngoài cache.
- `type VenueReviewView = { id: number; scores: Record<VenueCriterion, number>; comment: string | null; month: string; edited: boolean }` (`month` = `vnMonth(created_at)` tính ở server; không có mốc giờ, người viết, trọng số, lý do giữ, số báo cáo).
- `getVenueReviewPage(venueId, offset): Promise<{ reviews: VenueReviewView[]; hasMore: boolean; nextOffset: number | null }>`: cache `["vrev-page", String(venueId), String(offset)]`, tag `venueReviewTag(venueId)`; join `venues` `approved`; `ORDER BY created_at DESC, id DESC LIMIT 11 OFFSET offset`.
- Action `listVenueReviews({ venueId, offset })` → `{ success: true; data } | { error }`: cờ → zod (bội số 10, `0..490`) → trang. Khách gọi được.
- `setVenueStatus`: sau commit gọi thêm `updateTag(venueReviewTag(id))`, `updateTag(VENUE_REVIEWS_TAG)`.

- [ ] **Step 1: Test đỏ:** `summary uses only visible reviews of active accounts at approved venues`; `under 3 reviews the summary has the count and null scores`; `guest reading summary and page twice runs DB queries only the first time`; `a new review clears that venue's sums and page, not the prior and not another venue`; `page JSON has month only, no createdAt, member id, name, weight, hold reason or report count`; `held and hidden reviews never appear`; `a hidden venue's reviews are not listed and its sums are null`; `hiding a venue refreshes its review caches and the prior`; `pages of 10 newest first with hasMore and nextOffset; offset 15 or 1000 rejected`; `EXPLAIN QUERY PLAN of the venue sums uses venue_reviews_venue_status_created_idx`; `flag off: listVenueReviews returns notFound before any DB read`; `venue-reviews exports exactly getMyVenueReview, listVenueReviews, submitVenueReview`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(venues): show cached venue scores and reviews`

### Task 10: Báo cáo người, sân, đánh giá

**Files:**
- Modify: `src/actions/exchange-reports.ts`, `src/actions/exchange-admin.ts` (`AdminReportRow`, `adminResolveReport`), i18n `notifications.reportTargets.{review, venue}`, `exchange.errors.reviewNotFound`
- Test: describe mới trong `exchange-reports.integration.test.ts` (dùng harness có sẵn, không đổi gì của nó), case mới trong `exchange-admin.integration.test.ts` (dọn `venue_reviews` trong `beforeEach` nếu case mới ghi)

**Interfaces:**
- Thứ tự của `reportAbuse` giữ nguyên. `reportSchema.target` thêm `{ type: "player"; code: string 10 }`, `{ type: "venue"; venueId }`, `{ type: "review"; reviewId }`.
- `player`: member theo `public_code`, đang hoạt động, không `rejected`, không phải mình → `targetType: "member"`. `venue`: sân `approved`. `review`: `visible`, không phải của mình; sau insert có dòng mới: `syncReviewReportCount(tx, reviewId)` = đếm báo cáo `open` của người `establishedMemberSql`, ghi `report_count`; đủ 3 thì `UPDATE ... SET status = 'hidden' WHERE id = ? AND status = 'visible' RETURNING id`; có dòng thì sau commit `console.error("[Reputation] review_hidden", { reviewId })` và `updateTag(venueReviewTag(venueId))`.
- Nhánh bình luận chuyển sang `establishedMemberSql` (cùng SQL, test G2c xanh nguyên văn).
- `AdminReportRow` thêm `venueId`, `reviewExcerpt`; target `review` → tên sân + 120 ký tự đầu; `venue` → tên sân; mỗi loại 1 truy vấn `inArray`. `adminResolveReport` với target `review` gọi `syncReviewReportCount` trong cùng tx (trạng thái `hidden` chỉ đổi ở tab Uy tín).

- [ ] **Step 1: Test đỏ:** `player report by profile code maps to the member server-side; self, locked or unknown code rejected`; `venue report needs an approved venue`; `third report by established members hides the review and sets report_count to 3`; `three concurrent reports hide it once (one log, one updateTag)`; `reports by new accounts are kept but do not hide it`; `own, held or hidden review cannot be reported`; `admin report list shows venue name and excerpt for a review, venue name for a venue`; `resolving a review report in the reports tab lowers report_count`. Mọi test báo cáo có sẵn xanh nguyên văn.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): report players, venues and reviews`

### Task 11: Kiểm duyệt đánh giá và cờ host (server)

**Files:** Create `src/lib/reputation/host-flags.ts` (thuần), `src/actions/reputation-admin.ts`; Test `src/lib/reputation/host-flags.test.ts`, `src/actions/reputation-admin.integration.test.ts`

**Interfaces:**
- `findCaptiveHosts(rows: { hostId; eventId; memberId; memberApproved: boolean }[]): { hostId; captives; events }[]`: khử trùng; bỏ member `approved` khỏi ứng viên; m là khách quen khép kín của h khi `nHost >= 3` và `100 * nHost >= 80 * nAll`; host có `captives >= 3`; xếp `captives` giảm rồi `hostId`.
- Guard: cờ → `requireAdmin` → zod.
- `AdminVenueReviewRow = { id; venueId; venueName; authorName; scores; comment; status; holdReason; reportCount; openReports; createdAt; updatedAt }`; `adminListVenueReviews(filter: "held" | "hidden" | "reported")` → tối đa 50, `reported` sắp trong SQL theo số báo cáo mở.
- `adminModerateVenueReview({ reviewId; action: "approve" | "unhide" | "hide" | "dismiss" })`: như cũ (approve `held` → `visible`; unhide `hidden` → `visible`, `reportCount` 0, báo cáo `open` → `dismissed`; hide `visible|held` → `hidden`, báo cáo `open` → `resolved`; dismiss báo cáo `open` → `dismissed`, `reportCount` 0). Sau commit `updateTag(venueReviewTag(venueId))`.
- `AdminHostFlagRow = { hostMemberId; hostName; hostCode; captives; events; reviewedCaptives: number | null }`; `adminListHostFlags()` → `{ rows: AdminHostFlagRow[]; truncated: boolean }`: điểm danh hợp lệ ở buổi `start_at >= now - 90 ngày`, `ORDER BY start_at DESC LIMIT 5000` (`truncated` khi chạm trần), bỏ host đã xem với `captives` không tăng.
- `adminReviewHostFlag({ hostMemberId })`: server tự tính lại `captives`, upsert `host_flag_reviews`.

- [ ] **Step 1: Test đỏ:** `a pending member checked in at 3 of one host's events and nowhere else is captive`; `an approved group member is never captive`; `4 of 5 check-ins with the host is captive, 3 of 5 is not`; `three captives flag the host, two do not`; `duplicate rows count once`; `admin lists held, hidden and reported reviews with counts, at most 50, reported sorted in SQL`; `approve shows a held review and refreshes the venue cache; unhide resets report_count; hide resolves open reports`; `host flags use the last 90 days, skip hidden or cancelled events, and report truncated at the cap`; `reviewing a flag hides it until the captive count grows; a client-sent count is ignored`; `every admin action refuses a member cookie and a flag that is off`; `reputation-admin exports exactly adminListHostFlags, adminListVenueReviews, adminModerateVenueReview, adminReviewHostFlag`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): moderate venue reviews and flag hosts with captive attendees`

### Task 12: Người giới thiệu (server)

Cách làm đã chọn: người giới thiệu bấm "Giới thiệu người này" trên hồ sơ `/players/{mã}` của nick mới (nick mới gửi link hồ sơ qua Zalo). Không mang mã nào qua luồng đăng nhập Zalo/Google, nên không có tham số chuyển hướng hay state mới cần ký; mã công khai không phải bí mật nên không được dùng làm mã mời.

**Files:**
- Create: `src/lib/reputation/referral-rules.ts` (thuần), `src/lib/reputation/referral.ts` (`server-only`), `src/actions/referrals.ts`
- Modify: `src/lib/exchange/attendance.ts` (`isLimitedNewAccount`; `newAccountLimits.isNew` dùng nó), `src/actions/exchange-comments.ts` (thay đoạn tự tính nick mới), `src/lib/reputation/profile-read.ts` (`referred`), `src/actions/exchange-host.ts` (`ManageReg.referred`, 1 truy vấn `inArray`), i18n `exchange.errors.{referralNotEligible, referralQuota, referralBlocked, referralTargetInvalid, referralTaken}`
- Test: `src/lib/reputation/referral-rules.test.ts`, `src/actions/referrals.integration.test.ts`, `src/actions/referrals-exports.test.ts`; case mới trong `exchange-registrations`, `exchange-comments-write`, `exchange-read`, `exchange-host` integration tests

**Interfaces:**
- Thuần: `canRefer({ attendedTotal, attended, approvedPast }): boolean` = `attendedTotal >= 3 && (approvedPast === 0 || 100 * attended >= 80 * approvedPast)`; `referralBrokenAt(createdAt: string, incidents: string[]): string | null` (mốc thứ 2 trong `[createdAt, createdAt + 30 ngày]`); `referrerBlockedUntil(brokenAts: string[], now): string | null` (lớn nhất `brokenAt + 30 ngày` còn ở tương lai); `vnMonthBounds(now): { from; to }` (00:00 ngày 1 tháng này và tháng sau giờ VN, ISO UTC).
- Server: `referralIncidents(db, refereeIds): Promise<Map<number, string[]>>` (`no_show` → `start_at`, `late_cancelled` → `cancelled_at`, buổi không huỷ); `hasActiveReferral(db, refereeId, now): Promise<boolean>`; `referrerState(db, member, now): Promise<{ eligible: boolean; usedThisMonth: number; blockedUntil: string | null }>` (`attendedTotal = raterWeight5`, `attended`/`approvedPast` từ `attendanceSummaries`, khoá từ giới thiệu 60 ngày gần đây).
- `isLimitedNewAccount(db, member, now): Promise<boolean>` = không `approved`, chưa có đăng ký `checked_in = 1`, và `!hasActiveReferral`. Nhãn "Mới" không đổi.
- `src/actions/referrals.ts` (chỉ export 3 hàm):
  - `referMember(input: unknown)` → `{ success: true } | { error }`. Thứ tự theo Global Constraints (khoá `exchange-referral`, `TS_REFERRAL`). Zod `{ code: string 10; turnstileToken }`. Trong tx: người được giới thiệu theo mã: hoạt động, không `rejected`, không `approved`, chưa điểm danh lần nào, không phải mình (sai → `referralTargetInvalid`); đã có dòng: cùng người → `success`, khác → `referralTaken`; `referrerState`: không đủ → `referralNotEligible`, đang khoá → `referralBlocked` (`{ date }`). Ghi 1 câu `INSERT ... SELECT ... WHERE (count tháng VN) < 5 ON CONFLICT (referee_member_id) DO NOTHING RETURNING id` (như `submitVenue`); không có dòng thì đọc lại để trả `referralQuota` hoặc `referralTaken`. Sau commit `updateTag(repTag(referee))`.
  - `getMyReferralState()` → `{ eligible; usedThisMonth; limit; blockedUntil; limited }`.
  - `ensureMyPublicCode()` → `{ code }` (cờ → tài khoản → `ensureMemberPublicCode`; không Turnstile).

- [ ] **Step 1: Test đỏ:**
  - Thuần: `canRefer: 3 attended at 3/3 yes; 4 of 5 yes; 3 of 4 no; group sessions count toward 3; no exchange history passes the rate rule`; `referralBrokenAt: the second incident inside 30 days breaks it at that time; incidents before or after day 30 do not count`; `referrerBlockedUntil: 30 days after the latest break, null once passed`; `vnMonthBounds: 2026-10-31T18:00Z is in November`.
  - Action: `flag off returns notFound before auth and Turnstile`; `failed Turnstile writes no rate_limit_buckets row and no referral`; `an eligible member refers a new account by code`; `self, approved, checked-in, locked, rejected or unknown target is refused`; `another referrer gets referralTaken; the same referrer resending gets success, one row`; `two referrers racing end with one row`; `six referrals sent at once store exactly five; the first of next VN month is allowed`; `a no-show plus a late cancel in 30 days blocks the referrer until 30 days after the second`; `a referrer with 2 sessions or a 75% rate gets referralNotEligible`.
  - Miễn giới hạn: `a referred new account may register with a companion and hold a third pending registration`; `a referred account gets the 30-a-day comment limit`; `after the referral breaks the account is limited again`; `viewer.isNewAccount is false for a referred account`; `the profile shows referred true and never the referrer`; `manage rows carry referred with one extra query`.
  - `referrals exports exactly ensureMyPublicCode, getMyReferralState, referMember`. Test G2b, G2c có sẵn xanh nguyên văn.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): let trusted players vouch for new accounts`

### Task 13: Tín hiệu nick trùng cho tài khoản giao lưu (server)

**Files:**
- Create: `src/lib/reputation/ip-signals.ts` (`server-only`), `src/lib/reputation/dup-signals.ts` (thuần), `src/actions/exchange-dup-signals.ts`
- Modify: `src/app/api/auth/zalo/callback/route.ts`, `src/actions/google-auth.ts` (nhánh `isExchange`), `src/actions/exchange-registrations.ts`, `src/lib/notifications/daily.ts` (bước dọn)
- Test: `src/lib/reputation/dup-signals.test.ts`, `src/lib/reputation/ip-signals.integration.test.ts`, `src/actions/exchange-dup-signals.integration.test.ts`; case mới trong `zalo-routes.integration.test.ts`, `login-flows.characterization.integration.test.ts`, `exchange-registrations.integration.test.ts`, `daily.integration.test.ts`

**Interfaces:**
- `ipSignalHash(ip): string` = HMAC-SHA256(`USER_COOKIE_SECRET`, `"dup-ip:v1:" + ipRateLimitKey(ip)`), 32 hex đầu.
- `pruneIpSignals(db, now): Promise<number>`: `DELETE FROM member_ip_signals WHERE id IN (SELECT id FROM member_ip_signals WHERE last_seen_at < :cutoff ORDER BY last_seen_at LIMIT 200)` (dùng index `(last_seen_at)`), trả số dòng đã xoá.
- `recordIpSignal(db, { memberId, ip, kind }, now): Promise<void>`: `ip === "unknown"` thì thôi; upsert theo unique (giữ `first_seen_at`); rồi `pruneIpSignals` một lô. Nơi gọi bọc `try/catch`, chỉ `console.error("[DupSignal] record_failed", { memberId })`, có chú thích lý do bỏ qua.
- Điểm ghi: Zalo callback sau khi có member (`created ? "signup" : "login"`), `googleLogin` khi `isExchange` (cùng quy tắc), `registerForExchange` sau Turnstile và rate limit, ngoài tx (`"register"`).
- `findDupSignalGroups(rows: { memberId; ipHash; kind; firstSeenAt; lastSeenAt; name; isExchange }[], ignored: Set<string>): { key; reason: "same_name_network" | "network_burst"; memberIds: number[] }[]`: `same_name_network` = `foldAscii(name)` bằng nhau, chung 1 `ipHash`, ít nhất một bên là tài khoản giao lưu; `network_burst` = từ 3 tài khoản giao lưu có `signup` cùng `ipHash` trong một khung 24 giờ (hai con trỏ, khung chồng nhau gộp); bỏ cặp đã bỏ qua như `findDuplicateMembers`; `key` = lý do + id đã sắp.
- `findExchangeDuplicateSignals()` (chỉ export hàm này): cờ → `requireAdmin` → tín hiệu 30 ngày join member đang hoạt động (`LIMIT 5000`) + `dup_ignored_pairs` → nhóm `{ key; reason; members: { id; name; avatarUrl; avatarKey; isExchange; createdAt; code }[] }`, tối đa 50. Không hash, IP, email.
- `runDailyNotifications`: bước `ip_signals` chạy TRƯỚC dòng `if (!(await isNotificationsEnabled(db))) return report;` (`daily.ts:301`), gọi `pruneIpSignals` lặp tới khi một lô xoá dưới 200 dòng hoặc đủ 10 lô; lỗi ghi vào `report.errors` như các bước khác. Route cron `/api/cron/notifications-daily` hiện trả `skipped` khi tắt thông báo trước khi gọi `runDailyNotifications`: chuyển bước dọn này lên route (gọi trước cổng) hoặc bỏ cổng ở route và để `runDailyNotifications` tự quyết; chọn cách thứ nhất để không đổi phản hồi `skipped` có sẵn.

- [ ] **Step 1: Test đỏ:** `ipSignalHash differs from hashedIpKey for the same IP and two IPv6 addresses in one /64 share it`; `recording upserts one row per member, hash and kind and moves last_seen_at`; `unknown IP records nothing`; `a recording failure does not fail the Zalo callback or the Google exchange login; the log has only the member id`; `a failed Turnstile on register records nothing`; `same name plus a shared network pairs an exchange account with a group member`; `same name on different networks, or a shared network with different names, is not a pair`; `three exchange signups on one network within 24h form a burst; spread over three days they do not`; `two group members never form a group alone`; `ignored pairs drop out; a burst with every pair ignored disappears`; `rows older than 30 days are ignored, pruned on write and by the daily step`; `with the notifications flag off the daily cron still deletes rows older than 30 days and keeps newer ones`; `the prune deletes at most 200 rows per batch and uses the last_seen_at index (EXPLAIN, no SCAN)`; `admin payload has no hash, IP or email`; `a member cookie or flag off gets nothing`.
- [ ] **Step 2:** FAIL → viết → PASS + test có sẵn của các file sửa xanh nguyên văn.
- [ ] **Step 3: Commit** `feat(admin): flag likely duplicate exchange accounts from hashed network signals`

### Task 14: Nhắc chấm sau buổi (server, job)

**Files:**
- Create: `src/lib/reputation/rating-jobs.ts` (`server-only`)
- Modify: `src/lib/notifications/catalog.ts` (`exchange_rate_reminder`), `render.ts`, `jobs.ts` (`runJob`), `daily.ts` (bước mới), `src/actions/exchange-events.ts` (`.returning({ id })`, hẹn sau commit), `src/actions/exchange-host.ts` (`cancelExchangeEvent` hẹn lại khi `hostAction` trả success), `src/actions/exchange-admin.ts` (`adminCancelExchange`, `adminSetExchangeHidden`), i18n `notifications.kinds.exchange_rate_reminder`
- Test: `src/lib/reputation/rating-jobs.integration.test.ts`; case mới trong `catalog.test.ts`, `render.test.ts`, `daily.integration.test.ts`, `exchange-events-create`, `exchange-host`, `exchange-admin` integration tests

**Interfaces:**
- Kind `exchange_rate_reminder` = `def("member", "exchange", false, true, "scheduled")`; payload `{ eventCode, eventTitle }`; entity `exchange_event`; href member `/exchanges/{code}?feedback=1`. Chữ vi: "Chấm buổi giao lưu vừa chơi" / "Buổi \"{eventTitle}\" đã xong. Bạn chấm người chơi cùng và host trong 7 ngày nhé."
- `ratingJobKey(eventId, endAt): string`.
- `scheduleRatingReminder(db, ev: { id; endAt; status; hiddenAt }, now, gate?): Promise<void>`: thông báo tắt, buổi huỷ/ẩn hoặc `runAt <= now` → mọi dòng `scheduled` của buổi (`job_key >= 'xrate:{id}:' AND job_key < 'xrate:{id};'`) thành `cancelled` + `cancelJobMessage`. Còn lại: dòng đúng khoá đang `scheduled` thì thôi; `cancelled` thì hồi sinh (`scheduled`, `messageId = null`) và đăng lại với `revision`; chưa có: có QStash → `scheduleOneOffJob(db, { jobKey, kind, runAt, payload: { eventId, endAt } }, now)`; không có QStash → chỉ chèn dòng `scheduled` (không để `scheduleOneOffJob` chạy ngay job của tương lai).
- `scheduleRatingReminderAfterCommit(eventId, gate?)` qua `runAfterResponse`. Gọi ở: tạo buổi, host huỷ, admin huỷ, admin ẩn/bỏ ẩn.
- `runRatingReminder(db, job, now, gate): Promise<"done" | "skipped">` (`runJob` gọi sau khi kiểm `isNotificationsEnabled`): `skipped` khi cờ giao lưu tắt, không có buổi, buổi huỷ/ẩn, `jobKey` không khớp `endAt` hiện tại, hoặc `feedbackWindow !== "open"`. Người nhận: điểm danh hợp lệ, tài khoản hoạt động không `rejected`, chưa có `host_feedback` của (buổi, người đó). `notify` với dedupBase `xrate:e{id}:{fp}`.
- Cron hằng ngày thêm bước `exchange_rating` (sau bước 3, khi cờ giao lưu bật): buổi không huỷ, không ẩn, `end_at` trong 8 ngày tới (dùng `exchange_events_end_at_idx`) → `scheduleRatingReminder(..., true)`. Theo đúng mẫu `rescheduleSessionJobs`: dòng đúng khoá đang `scheduled` mà `messageId` null (buổi tạo sớm hơn 7 ngày nên lúc tạo chưa đăng được) và nay đã vào khung 7 ngày thì đăng lên QStash rồi lưu `messageId` (`publishRow`, không đè lượt đăng song song).

- [ ] **Step 1: Test đỏ:** `creating an event schedules one reminder at endAt plus 1 hour with the fingerprint`; `without QStash the row is only stored, never run early`; `host cancel, admin cancel and admin hide cancel the job; unhiding before the reminder revives it`; `notifications off at creation schedules nothing; the daily step schedules it later`; `the runner notifies valid checked-in registrants who have not rated, never the host, a not-checked-in, locked or already-rated member`; `the runner skips a cancelled or hidden event, a stale fingerprint, a closed window, and the exchange flag off`; `running the job twice sends one notification per recipient`; `a member who muted the Giao lưu group gets nothing; a verified email gets one mail via the outbox`; `an event created 10 days ahead stores the reminder with no messageId; the daily step 7 days before runAt publishes it and saves the messageId, and a second daily run does not publish again`; `the daily step runs a missed one`; `catalog: exchange_rate_reminder has vi/en/zh title and body`; `href opens /exchanges/{code}?feedback=1`; `payload has only eventCode and eventTitle`.
- [ ] **Step 2:** FAIL → viết → PASS + `pnpm test src/lib/notifications src/app/api/notifications src/actions/exchange-events src/actions/exchange-host src/actions/exchange-admin src/i18n`.
- [ ] **Step 3: Commit** `feat(notifications): remind checked-in players to rate after an exchange`

### Task 15: Gộp member và làm mới cache khi sửa member

**Files:**
- Create: `src/lib/reputation/invalidate.ts` (`server-only`)
- Modify: `src/lib/exchange/member-rows.ts`, `src/actions/members.ts` (`toggleMemberActive`, `updateMember`, `updateMyProfile`, `updateMyAvatar`, `updateMySkillLevel`, `mergeMember`), `src/actions/member-approval.ts` (duyệt, từ chối, duyệt-gộp)
- Test: case mới trong `merge-member-exchange.integration.test.ts`, `member-approval.integration.test.ts`, `members.integration.test.ts`

**Interfaces:**
- `invalidateMemberReputation(db, memberIds: number[]): Promise<void>`: `updateTag(repTag(id))` cho từng id, và `updateTag(venueReviewTag(v))` cho mọi sân họ đã đánh giá (1 truy vấn). Gọi sau commit ở mọi action trên; gộp gọi cho cả nguồn và đích, cộng `updateTag("exchange")` (xoá cache mã → id của nguồn).
- `repointReputationRows(tx, sourceId, targetId)` (gọi cuối `repointExchangeRows`):
  - `peer_feedback`: xoá dòng nguồn sẽ trùng unique, xoá dòng thành tự chấm; đổi `from`/`to`; xoá dòng có `from` hoặc `to` là host của buổi đó.
  - `host_feedback`: xoá dòng nguồn trùng buổi với đích; đổi `from`; sau đó xoá MỌI dòng có `from` = host của buổi (cả dòng vốn của đích).
  - `venue_reviews`: đích có cùng sân thì xoá của nguồn và đặt báo cáo `open` nhắm vào nó thành `resolved`; không thì đổi.
  - `host_flag_reviews`: giữ `captives` lớn hơn và `reviewedAt` muộn hơn trên đích.
  - `referrals`: dời hai cột; đích đã là người được giới thiệu thì xoá dòng của nguồn; thành tự giới thiệu thì xoá.
  - `members.public_code`: đích chưa có, nguồn có → nguồn NULL rồi gán cho đích.
- `mergeRegMoney` (cùng chỗ hai đăng ký một buổi): `checkedIn = a OR b`, `checkedInAt` sớm hơn.
- `member_ip_signals` không dời (cascade). `countExchangeRefs` cộng `peer_feedback`, `host_feedback`, `venue_reviews`, `host_flag_reviews`, `referrals` (12 bảng).

- [ ] **Step 1: Test đỏ:** `merge moves peer feedback both ways, host feedback, venue reviews, flag reviews and referrals to the target`; `a duplicate peer row keeps the target's; a self pair after merge is deleted`; `after merge no host_feedback row rates the rater's own event, including the target's own row`; `two registrations of one event keep the check-in and the earliest time`; `two reviews of one venue keep the target's and resolve reports on the dropped one`; `a target without a code takes the source's`; `approve-as-merge of a pending account with venue reviews, two-way peer feedback and a code succeeds and the target gets the code`; `deleteMember with only a venue review is blocked`; `locking, rejecting, renaming or changing the self skill calls updateTag(repTag(id)) and the venue tags of their reviews`; `merge also calls updateTag("exchange")`. Test gộp có sẵn xanh nguyên văn.
- [ ] **Step 2:** FAIL → viết → PASS + `pnpm test src/actions/merge src/actions/member-approval src/actions/members`.
- [ ] **Step 3:** Controller chạy `finance-invariant-reviewer`: "Review `git -C D:/Lwcifer/LW/FWBB-g2d diff <HEAD trước Task 15>..HEAD -- src/lib/exchange/member-rows.ts src/actions/members.ts src/actions/member-approval.ts`, đọc file dưới `D:/Lwcifer/LW/FWBB-g2d`. Khẳng định mergeMember và duyệt-gộp vẫn chuyển đủ nợ và sổ quỹ, mergeRegMoney giữ đúng tiền, không ghi financial_transactions/session_debts." PASS mới đóng.
- [ ] **Step 4: Commit** `fix(members): carry ratings through merge and refresh reputation caches on member changes`

### Task 16: Dòng uy tín host và báo cáo theo đối tượng

**Files:**
- Create: `src/components/reputation/{new-badge,host-reputation}.tsx`
- Modify: `src/components/exchange/report-sheet.tsx` (prop `target?: { type: "player"; code } | { type: "venue"; venueId } | { type: "review"; reviewId }`; `code` tuỳ chọn khi có `target`; có `target` thì ẩn chọn buổi/host), `src/app/(exchange)/exchanges/[code]/page.tsx`, `event-post.tsx`, i18n
- Test: `src/components/reputation/host-reputation.test.tsx`, test `report-sheet`, case mới trong `event-post.test.tsx`

**Interfaces:**
- `type HostLine = { code: string; organized: number; asDescribedPct: number | null; feeAsPromisedPct: number | null }`. Trang buổi đọc `getPublicProfile(event.host.code)` khi có mã, truyền `hostLine` vào `EventPost`. `HostReputation`: "Đã tổ chức N buổi", "Đúng mô tả X%", "Đúng phí X%" (chỉ khi có số); `organized = 0` → chip "Host mới"; cả khối là link 44px tới `/players/{code}`. Không có mã thì không có dòng.
- `NewBadge()`: chip "Mới".

- [ ] **Step 1: Test đỏ:** `the host line links to /players/{code}, shows Host mới when nothing was organized, and is absent without a code`; `percentages show only when not null`; `report sheet with a target sends it and hides the event or host choice`; `existing report sheet uses keep working`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): show the host reputation line and report by target`

### Task 17: Trang hồ sơ công khai

**Files:**
- Create: `src/app/(exchange)/players/layout.tsx` (cờ tắt → `notFound()`; `metadata.robots = { index: false, follow: false }`), `src/app/(exchange)/players/[code]/page.tsx`, `loading.tsx`, `src/components/reputation/{reputation-stats,peer-kudos}.tsx`, i18n `exchange.reputation.*`
- Test: `src/app/(exchange)/players/[code]/profile.test.tsx`, `src/components/reputation/reputation.test.tsx`

**Interfaces:**
- `page.tsx`: `params: Promise<{ code }>`; `getPublicProfile` null → `notFound()`. Có cookie thì `getExchangeViewer()` để biết có phải chính mình; khách không đọc DB thêm.
- Bố cục: avatar 64px, tên `break-words`, `NewBadge` khi `isNew`, chip "Được giới thiệu" khi `referred`; dòng trình độ (bỏ vế người chơi cùng khi `peer.skill` null; chưa khai thì "Tự khai: chưa khai"); `ReputationStats` (đã đến; tỉ lệ đến khi `approvedPast > 0`; huỷ muộn; vắng; trả đúng hạn khi `charged > 0`); `PeerKudos` (dòng nào bằng 0 hoặc null thì ẩn; không còn dòng nào thì "Chưa đủ lượt chấm để hiện"); khối host khi có; nút "Báo cáo" cho người đăng nhập khác chính mình, `ReportSheet target player`. Rỗng: "Chưa có buổi nào được điểm danh." + nút "Tìm buổi giao lưu". Skeleton đúng khối.

- [ ] **Step 1: Test đỏ:** `profile shows the name, Mới for a new account, the self skill, and the peer part only with peer.skill`; `stats hide the rate when approvedPast is 0`; `kudos hide zero lines and show the not-enough line when nothing is left`; `host block only for someone who hosted`; `report button only for a signed-in viewer who is not that person`; `rendered HTML has no rater name, event title or code, phone or email`; `empty profile shows the find-exchanges button`; `layout returns 404 when the flag is off and sets robots noindex`; `values text-base, buttons min-h-11`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): add public player profiles`

### Task 18: Phiếu chấm sau buổi

**Files:**
- Create: `src/components/reputation/feedback-sheet.tsx` + test
- Modify: `src/actions/exchange-read.ts` (`ViewerExtras.myRegistration.checkedIn`, từ dòng đã đọc), `my-registration-bar.tsx` (prop `onRate?`), `event-post.tsx` (nuqs `feedback`), `src/actions/exchange-mine.ts` (`MyRegistration.feedback: "todo" | "done" | null`, `MyExchanges.myCode`, thêm `hiddenAt` vào select của `regRows`), `my-exchanges.tsx`, `fixtures.ts`, i18n
- Test: case mới trong `my-registration-bar.test.tsx`, `event-post.test.tsx`, `mine.test.tsx`, `exchange-mine.integration.test.ts`

**Interfaces:**
- Khi `canRate`, nút chính dính đáy của `MyRegistrationBar` là "Đánh giá buổi này".
- `FeedbackSheet({ open, onOpenChange, code })`: `useQuery(["exchange-feedback", code], getEventFeedbackForm, { enabled: open, staleTime: 60_000 })`; skeleton; `notYet`/`closed`/`notEligible` thì câu giải thích. Form (react-hook-form + zod): 2 câu về host bắt buộc; mỗi người chơi cùng: công tắc "Muốn chơi lại cùng", 4 chip tag, 5 chip trình độ (bấm lại để bỏ), link "Báo cáo" (`ReportSheet target player`, ẩn khi không có mã); dòng chú thích "Điểm chỉ hiện trên hồ sơ sau khi buổi đóng chấm"; `TurnstileWidget` (`TS_FEEDBACK`) ở footer. `idempotencyKey` sinh khi mở form, giữ khi gửi lại sau lỗi, sinh mới sau thành công. `fireAction(..., { retry: false })`: đánh dấu "Đã gửi" ngay, lỗi thì bỏ và hiện chữ server, luôn tăng `resetKey`; xong `invalidateQueries`, toast, đóng.
- `?feedback=1` mở sheet (`history: "replace"`), đóng thì bỏ tham số.
- `getMyExchanges`: `feedback` null khi không điểm danh hợp lệ, ngoài cửa sổ, buổi ẩn/huỷ; còn lại `done`/`todo` theo `host_feedback` (1 truy vấn). Thẻ `todo` có "Chưa đánh giá" → `/exchanges/{code}?feedback=1`; có `myCode` thì link "Hồ sơ công khai của bạn".

- [ ] **Step 1: Test đỏ:** `the bar shows Đánh giá buổi này only from endAt to endAt plus 7 days for a checked-in registrant, never on a hidden or cancelled event`; `?feedback=1 opens the sheet`; `submit sends both host answers and only touched co-players`; `after an error the resend keeps the idempotencyKey, uses a new token and never retries`; `an error rolls back the sent state with the server message`; `reopening prefills the viewer's own answers`; `submit waits for both host answers`; `notEligible shows the explanation and no names`; `my exchanges shows Chưa đánh giá only for todo and the profile link when myCode is set`; `getMyExchanges marks todo and done with one extra query and null for a hidden event`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): add the after-event rating sheet`

### Task 19: Người giới thiệu (giao diện)

**Files:**
- Create: `src/components/reputation/refer-sheet.tsx` + test
- Modify: `src/app/(exchange)/players/[code]/page.tsx`, `src/app/(exchange)/exchanges/mine/my-exchanges.tsx` + `page.tsx`, `registration-row.tsx`, i18n `exchange.reputation.referral.*`
- Test: case mới trong `profile.test.tsx`, `mine.test.tsx`, `manage-client.test.tsx`

**Interfaces:**
- Hồ sơ `isNew && !referred`, người xem đăng nhập, không phải mình: server gọi `getMyReferralState()`; đủ điều kiện, không khoá, còn lượt thì nút "Giới thiệu người này" (44px).
- `ReferSheet({ open, onOpenChange, code, name })`: câu luật ("Bạn bảo đảm đây là người thật bạn quen. Họ được bỏ giới hạn tài khoản mới. Nếu họ vắng hoặc huỷ muộn từ 2 lần trong 30 ngày đầu, bạn tạm không giới thiệu được 30 ngày."), "Bạn còn {n} lượt tháng này", Turnstile (`TS_REFERRAL`), nút xác nhận dính đáy; `fireAction(..., { retry: false })`: hiện ngay chip "Được giới thiệu", lỗi thì hoàn lại; luôn tăng `resetKey`; xong `router.refresh()`.
- "Giao lưu của tôi": `limited` → thẻ "Tài khoản mới bị giới hạn: tối đa 2 đăng ký đang chờ, không dắt thêm người, 5 bình luận mỗi ngày. Nhờ người quen đã chơi từ 3 buổi giới thiệu để bỏ giới hạn." + nút "Chia sẻ hồ sơ của tôi" (`ensureMyPublicCode` rồi `navigator.share`, không có thì chép link + toast). Người đủ điều kiện: "Bạn đã giới thiệu {used}/{limit} người trong tháng này"; đang khoá: "Bạn tạm không giới thiệu được tới {date}". Dòng đăng ký ở trang quản lý: chip "Được giới thiệu".

- [ ] **Step 1: Test đỏ:** `refer button only for an eligible signed-in viewer on a new unreferred profile, never your own`; `refer sheet sends the code with a token, shows Được giới thiệu at once and rolls back with the server message`; `the profile chip never names the referrer`; `a limited account sees the newcomer card; sharing calls ensureMyPublicCode then shares /players/{code}`; `a referrer sees used/limit and the blocked date`; `the manage row shows Được giới thiệu`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): add the refer button and the newcomer card`

### Task 20: Uy tín trong danh sách người

**Files:**
- Modify: `src/actions/exchange-host.ts` (`ManageReg.memberCode`, `ManageReg.attendance` qua `attendanceSummaries`), `registration-row.tsx`, `event-post.tsx` (tên người tham gia thành link), `src/lib/exchange/comment-reads.ts` (`authorIsNew`), `src/lib/exchange/comment-tree.ts` (`CommentRow.authorIsNew: boolean | null`, `CommentView.author.isNew`), `src/components/exchange/comments/comment-item.tsx`, fixture `manage-client.test.tsx`, `comment-tree.test.ts`, `src/components/exchange/comments/fixtures.ts`
- Test: case mới trong `exchange-host.integration.test.ts`, `manage-client.test.tsx`, `event-post.test.tsx`, `comment-tree.test.ts`, `exchange-comments-read.integration.test.ts`

**Interfaces:**
- `getManageView`: đúng 1 lần `attendanceSummaries` cho mọi người đăng ký; `memberCode` lấy trong truy vấn sẵn có.
- `RegistrationRow`: "Đến {attended}/{approvedPast} buổi · {lateCancels} huỷ muộn · {noShows} vắng" (bỏ vế 0; nick mới chỉ chip "Mới"), link "Hồ sơ" 44px khi có mã.
- Tên người tham gia có mã là link `/players/{code}` 44px.
- SQL bình luận: `authorIsNew` = `NULL` khi dòng bị ẩn nội dung, còn lại 0/1 theo định nghĩa G2b; `buildThreads` đặt `author.isNew`.

- [ ] **Step 1: Test đỏ:** `manage view gives each registrant attendance numbers and a code with one extra query`; `the manage row shows the attendance line and a 44px profile link; a new account shows only Mới`; `approved attendee names link to profiles; no code means plain text`; `a pending commenter with no check-in shows Mới, an approved member does not, placeholders carry no flag`; `the cached qa payload still has no member id`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): show reputation in registrant, attendee and comment lists`

### Task 21: Khu đánh giá trên trang sân (chỉ đọc)

**Files:**
- Create: `src/components/venues/reviews/{venue-reviews-section,venue-score-summary,venue-review-list,venue-review-item,review-skeleton}.tsx`
- Modify: `src/app/(exchange)/venues/[id]/page.tsx` (khối `data-section="venue-reviews"`), i18n `venueReviews.*`
- Test: `src/components/venues/reviews/venue-reviews.test.tsx`, case mới trong `src/app/(exchange)/venues/[id]/venue-detail.test.tsx`

**Interfaces:**
- `page.tsx`: cờ bật thì thay ruột khối `data-section="venue-reviews"` (thay `reviewsSoon`) bằng `<VenueReviewsSection venueId venueName signedIn summary initialPage />`; cờ tắt giữ nguyên. `signedIn = (await getUserFromCookie()) !== null`. Cờ bật và đăng nhập: nút chữ "Báo cáo thông tin sân sai" (44px, `ReportSheet target venue`). Nếu test `shows the reviews coming soon block` dựng trang với cờ bật thì đổi tên thành `... when the exchange flag is off` và đặt cờ tắt, khẳng định giữ nguyên.
- `VenueScoreSummary`: số lớn `formatTenths`, sao, "{count} đánh giá", 6 hàng tiêu chí; null → "Chưa đủ đánh giá" + "{count} đánh giá".
- `VenueReviewList({ venueId, initialPage })`: `useInfiniteQuery({ queryKey: ["venue-reviews", venueId], queryFn: async ({ pageParam }) => { const r = await listVenueReviews({ venueId, offset: pageParam }); if ("error" in r) throw new Error(r.error); return r.data; }, initialPageParam: 0, initialData: { pages: [initialPage], pageParams: [0] }, getNextPageParam: (p) => p.nextOffset, staleTime: 60_000 })`; lỗi tải thêm → `toast.error`, giữ trang đã có; khử trùng theo `id`; "Xem thêm". `VenueReviewItem`: chip "Đã chơi ở đây", tháng từ `month`, 6 điểm nhỏ, nhận xét chữ thuần, "đã sửa", nút "Báo cáo" (đăng nhập, `ReportSheet target review`). Rỗng: "Chưa có đánh giá nào." + nút viết đánh giá (Task 22).

- [ ] **Step 1: Test đỏ:** `flag on shows summary and reviews, flag off keeps the coming soon block`; `fewer than 3 reviews shows Chưa đủ đánh giá and still lists them`; `43 renders as 4,3 in vi`; `a review shows its month from the server, never a full date`; `a comment with <script> and a link renders as plain text`; `Xem thêm appends without duplicates and sets no refetch interval`; `a page-2 error shows a toast and keeps page 1`; `signed-in viewer sees the venue report button and it sends a venue target`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(venues): show venue scores and reviews on the venue page`

### Task 22: Viết đánh giá sân (giao diện)

**Files:**
- Create: `src/components/venues/reviews/{venue-review-sheet,star-input}.tsx` + test
- Modify: `venue-reviews-section.tsx`, i18n

**Interfaces:**
- Nút "Viết đánh giá" (đăng nhập) mở sheet; khách: link "Đăng nhập để đánh giá" → `/exchanges/login?next=/venues/{id}`.
- `VenueReviewSheet({ open, onOpenChange, venueId })`: `useQuery(["my-venue-review", venueId], getMyVenueReview, { enabled: open })`; không đủ điều kiện: "Bạn cần được điểm danh ở một buổi tại sân này để đánh giá."; đang ẩn: giải thích; `nextEditAt` tương lai: chỉ xem + "Sửa lại được từ {date}". Form: 6 `StarInput`, textarea "x/500", Turnstile (`TS_REVIEW`), nút gửi dính đáy sheet (sheet nằm trên thanh `z-30`). Gửi: `fireAction(..., { retry: false })`; dòng của mình hiện ngay đầu danh sách nhãn "Đang gửi…" (sửa thì thay dòng cùng `id`); lỗi thì hoàn lại, hiện chữ server; luôn tăng `resetKey`; `held` → toast "Đánh giá của bạn đang chờ duyệt" và dòng của mình hiện trong sheet với nhãn chờ duyệt (không vào danh sách công khai); xong `invalidateQueries` 2 khoá + `router.refresh()`.
- `StarInput({ label, value, onChange })`: `role="radiogroup"`, 5 `role="radio"` `aria-checked`, mỗi nút ≥ 44px, phím mũi tên.

- [ ] **Step 1: Test đỏ:** `a guest sees the login link with next back to the venue`; `ineligible explanation; prefilled edit; read-only until the next edit date`; `submit is optimistic, rolls back with the server message, never retries, resets Turnstile`; `editing replaces the row with the same id`; `a held result shows the waiting toast and the own review only in the sheet`; `star input: each star at least 44px, arrow keys move, aria-checked follows`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(venues): add the venue review form`

### Task 23: Trang admin: tab Uy tín, báo cáo kiểu mới

**Files:**
- Create: `src/app/(admin)/admin/exchanges/admin-reputation-panel.tsx` + test
- Modify: `admin-exchange-client.tsx` (`Tab` thêm `"reputation"`; `initialTab?`; `ReportCard` cho target `review`/`venue`, báo cáo đánh giá có link sang tab Uy tín), `page.tsx` (`searchParams` → `initialTab`), i18n `exchange.admin.*`

**Interfaces:**
- `AdminReputationPanel()`: `TabSegment` "Đánh giá sân" / "Cờ host". Đánh giá: lọc "Chờ duyệt" / "Đang ẩn" / "Bị báo cáo", `useQuery(["admin-venue-reviews", filter])`; thẻ có tên sân, người viết, điểm, nhận xét chữ thuần, lý do giữ, số báo cáo; Duyệt / Bỏ ẩn / Ẩn (`ConfirmSheet`) / Bỏ qua báo cáo, optimistic theo `(filter, id)`. Cờ host: `useQuery(["admin-host-flags"])`; dòng "Danh sách có thể thiếu vì quá nhiều dữ liệu" khi `truncated`; "Đã xem" optimistic.

- [ ] **Step 1: Test đỏ:** `?tab=reputation opens the tab`; `review moderation approves optimistically and rolls back on error`; `hide asks for confirmation`; `a patch in one filter does not leak into another`; `host flags show captive counts, the truncated line, and Đã xem removes the row`; `a review report card shows venue name, excerpt and links`. Test admin có sẵn xanh nguyên văn.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(reputation): add the admin reputation tab`

### Task 24: Cảnh báo nick trùng trên trang admin thành viên

**Files:** Modify `src/app/(admin)/admin/members/duplicate-members-banner.tsx` (prop `signalGroups?`), `src/app/(admin)/admin/members/page.tsx` (gọi `findExchangeDuplicateSignals()` khi cờ bật), i18n `adminMembers.dupSignals.*`; Test: Create `duplicate-members-banner.test.tsx`

**Interfaces:**
- Mục riêng "Tài khoản giao lưu có dấu hiệu trùng": mỗi nhóm có lý do ("Cùng tên và từng dùng chung mạng" / "{count} tài khoản tạo trong 24 giờ từ cùng một mạng"), chip từng người (ảnh, tên, chip "Tài khoản giao lưu", ngày tạo, link hồ sơ khi có mã); chỉ nút "Bỏ qua" (`ignoreDuplicateGroup`, optimistic theo `key`, hoàn lại khi lỗi), không có nút gộp. Phần trùng tên giữ nguyên.

- [ ] **Step 1: Test đỏ:** `signal groups render under their own heading with the reason and no merge button`; `Bỏ qua hides the group at once and brings it back with a toast on error`; `name groups keep their merge flow`; `the members page passes signal groups only when the exchange flag is on`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(admin): show duplicate exchange account signals in the duplicate banner`

### Task 25: Rà toàn nhánh trước e2e

**Files:** chỉ sửa lỗi review tìm ra, mỗi lỗi kèm test hồi quy.

- [ ] **Step 1:** `mobile-ui-reviewer` trên mọi `.tsx` mới/sửa (`git -C D:/Lwcifer/LW/FWBB-g2d diff --name-only <merge Task 0>..HEAD -- "*.tsx"`), đọc file dưới `D:/Lwcifer/LW/FWBB-g2d`. Sửa vi phạm.
- [ ] **Step 2:** Mỗi lệnh phải rỗng: `grep -rnE "console\.log|refetchInterval|usePolling|setInterval|dangerouslySetInnerHTML" src/lib/reputation src/actions/reputation*.ts src/actions/venue-reviews.ts src/actions/referrals.ts src/actions/exchange-dup-signals.ts src/components/reputation src/components/venues/reviews "src/app/(exchange)/players"`; `grep -rn 'updateTag("exchange")' src/actions/reputation*.ts src/actions/venue-reviews.ts src/actions/referrals.ts src/lib/reputation` (chỉ được có trong `invalidate.ts`); `grep -rn "updateTag(VENUE_REVIEWS_TAG)" src` (chỉ trong `setVenueStatus`); `grep -rnE "financialTransactions|sessionDebts|parseFloat" src/lib/reputation src/actions/reputation*.ts src/actions/venue-reviews.ts src/actions/referrals.ts`; `grep -n "Math.round" src/lib/reputation/score.ts`; `grep -rnE "ipHash|ip_hash" src --include=*.tsx`; `grep -nE "^export (async )?function \w+\((db|tx)\b|DbOrTx" src/actions/reputation*.ts src/actions/venue-reviews.ts src/actions/referrals.ts src/actions/exchange-dup-signals.ts`; `git diff <merge Task 0>..HEAD -- src/i18n/messages | grep "^+" | grep -cP "\x{2014}|\x{2013}"` = 0; `git diff --stat <merge Task 0>..HEAD -- src/lib/cost-calculator.ts src/actions/finance.ts src/lib/exchange-fee.ts src/lib/exchange/settle.ts src/actions/reconcile-fund.ts` rỗng. Năm test khoá export xanh.
- [ ] **Step 3: Commit** (nếu có sửa) `fix(reputation): address reputation branch review findings`

### Task 26: e2e và 4 cổng

**Files:** Create `e2e/exchange-reputation.spec.ts`

**Interfaces:**
- Seed theo mẫu `e2e/exchange-comments.spec.ts` (`withDb`, `writeSetting`, `insertMember` bcrypt, `loginAs` qua `/login`): `PRAGMA busy_timeout = 5000`; `beforeAll` bật `exchangeEnabled`, `notificationsEnabled`; `afterAll` trong `finally` xoá hàng 2 cờ. Member riêng của spec có `public_code` (bảng chữ của `newPublicCode`): host approved, 4 tài khoản giao lưu pending, 3 member approved để báo cáo, 1 member không được điểm danh ở sân, 1 nick mới chưa điểm danh. 1 sân approved; 1 buổi đã qua (`endAt` = 2 giờ trước) với 4 đăng ký `approved` + `checked_in = 1`; mỗi người viết đánh giá có ít nhất 3 lần điểm danh trước buổi seed; 1 buổi đã đóng chấm (`endAt` 8 ngày trước) có sẵn 3 dòng `peer_feedback` hợp lệ cho một người. Turnstile dùng khoá test. `afterAll` xoá theo thứ tự FK: `peer_feedback`, `host_feedback`, `referrals`, `abuse_reports` của member spec hoặc nhắm `review`/`venue` của sân spec, `venue_reviews`, `host_flag_reviews`, `member_ip_signals`, `scheduled_jobs` `job_key LIKE 'xrate:%'` và mọi `notification_deliveries` + `notifications` tạo từ mốc đầu spec (Playwright chạy 1 worker), `rate_limit_buckets` khoá `exchange-feedback:%`, `venue-review:%`, `exchange-report:%`, `exchange-referral:%` của member spec, rồi đăng ký, buổi, sân, member.

- [ ] **Step 1: e2e (390px):** `checked-in player rates co-players and the host after the event and sees their answers when reopening`; `profile shows Mới for a new account, and kudos plus peer skill only from the closed event with three raters`; `event page host line opens the host profile, which has no rater names`; `eligible player reviews the venue; under 3 reviews the venue shows Chưa đủ đánh giá, with 3 it shows a score`; `a review with a phone is held, a guest does not see it, the admin approves it in the reputation tab`; `three established members report a review and it disappears; the admin unhides it`; `a member without a check-in at the venue sees why they cannot review`; `the host sees attendance numbers and a profile link for each registrant on the manage page`; `an eligible member refers a new account from its profile; the new account can then register with a companion`; `a referral broken by two no-shows blocks the referrer, who no longer sees the refer button and sees the reopen date`; `the daily cron sends the rating reminder once; the bell item opens the rating sheet` (seed 1 dòng `scheduled_jobs` kind `exchange_rate_reminder` có `run_at` quá 10 phút, gọi `GET /api/cron/notifications-daily` với `Authorization: Bearer $CRON_SECRET` 2 lần; người chưa chấm có đúng 1 tin, người đã chấm không có); `with the flag off the profile is 404 and the venue page shows the coming soon block` (bật lại cờ trong `finally`).
- [ ] **Step 2:** 4 cổng + full e2e, exit từng lệnh (`cmd > .superpowers/g2d/final-<x>.log 2>&1; echo "x_exit=$?"`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/g2d/test-env.sh && pnpm build` (đọc cuối log tìm "Failed to compile"/"Type error"), `source .superpowers/g2d/test-env.sh && pnpm test:e2e`. Expected: exit 0 hết; số test Task 0 vẫn xanh đủ (trừ product-tour sau 20:30 đã biết).
- [ ] **Step 3:** So `sqlite_master` của `e2e/local.db` với mốc Task 0: chỉ thêm đúng bảng, cột, index của 0032.
- [ ] **Step 4: Commit** `test(e2e): cover ratings, referrals, reminders and venue reviews`
- [ ] **Step 5:** Controller cập nhật memory `project_exchange_events_nearby.md` (G2d xong, commit cuối, ngày tuyệt đối, chưa deploy, quyết định đã chốt) và dòng trỏ trong `MEMORY.md`.

---

## Gaps outside G2d

Không còn mục nào của 4.6c nằm ngoài G2d: người giới thiệu (Task 12, 19), cảnh báo nick trùng (Task 13, 24), đặt cọc (đã có từ G2b) đều đã có chỗ. Ngoài spec: link mời bí mật đi qua đăng nhập (không làm, xem quyết định 39).

## Phạm vi để lại sau G2d

Điểm sân trên thẻ sân và thẻ xem nhanh; link hồ sơ và uy tín đầy đủ cạnh tên người bình luận; áp danh sách từ cấm cho bình luận giao lưu; admin sửa danh sách từ cấm trong app; tách buổi admin huỷ khỏi tỉ lệ huỷ của host (cần cột mới); thông báo khi bị khoá quyền giới thiệu; ghi tín hiệu mạng ở đăng nhập của nhóm.

## Quyết định của người viết plan (cần user soát)

**Chấm và uy tín**

1. Mỗi lượt chấm lưu trọng số của người chấm tại lúc chấm, không tính lại về sau. Lý do: đọc điểm không phải quét lịch sử người chấm, và nick ảo cày thêm buổi không làm lượt cũ nặng lên.
2. "Số buổi đã đến" để tính trọng số gồm số lần được điểm danh hợp lệ ở buổi giao lưu (không ẩn, không huỷ) cộng số buổi chơi của nhóm đã chốt sổ. Lý do: buổi nhóm là gặp mặt thật do admin chốt.
3. Mỗi người chấm chỉ được tính lượt mới nhất cho mỗi người (và mỗi host), dù chơi cùng nhiều buổi.
4. Host không chấm người chơi trong buổi mình mở, và người chơi không chấm host như một người chơi; người chơi chỉ trả lời 2 câu có/không về host. Lý do: spec chỉ cho người được điểm danh chấm nhau.
5. Chấm mở từ giờ kết thúc tới đúng 7 ngày sau, theo giờ đã lưu, không cần host bấm "Kết thúc buổi". Buổi huỷ hoặc bị ẩn thì không chấm được.
6. Trong 7 ngày đó sửa lại được phần chấm của mình; bỏ trống hết cho một người thì lượt chấm người đó bị xoá.
7. Một lần gửi gồm 2 câu về host (bắt buộc) và phần chấm mọi người chơi cùng, qua một lần Turnstile.
8. "Muốn chơi lại cùng" và tag khen chỉ là lời khen: không bấm không phải là chê. Hồ sơ hiện số lượt khen đã nhân trọng số, làm tròn xuống, dòng nào bằng 0 thì ẩn; không hiện phần trăm.
9. Lượt chấm chỉ được cộng vào hồ sơ khi buổi đã hết 7 ngày chấm, và chỉ khi buổi đó có ít nhất 3 người chấm khác nhau cho đúng người (hoặc đúng host). Hồ sơ còn cần tổng ít nhất 3 người chấm; dưới 3 thì không hiện cả số người chấm. Đánh đổi: điểm hiện chậm tới 7 ngày, và người chơi buổi nhỏ có thể không bao giờ có điểm khen. Lý do: không ai so hồ sơ trước và sau một buổi mà đoán ra người chấm.
10. Trình độ do người chơi cùng chấm là trung vị có trọng số; rơi đúng giữa thì lấy mức thấp hơn.
11. Lượt chấm chỉ tính khi người chấm (và người được chấm) còn điểm danh hợp lệ, buổi không ẩn, tài khoản người chấm không bị khoá. Đăng ký bị huỷ vì gộp tài khoản không tính là đã đến.
12. Tỉ lệ đến = số lần đến / số đăng ký đã duyệt ở buổi đã qua, không huỷ, không ẩn, có ít nhất 1 người được điểm danh; huỷ muộn và vắng nằm trong mẫu số.
13. "Trả tiền đúng hạn" chỉ xét đăng ký bị tính phí của buổi đã chốt phí và đã qua giờ bắt đầu cộng 24 giờ; đúng hạn là đánh dấu đã trả trước hoặc đúng mốc đó.
14. Số buổi đã tổ chức là buổi không huỷ, không ẩn, đã qua giờ kết thúc, có người được điểm danh. Tỉ lệ huỷ chỉ đếm buổi huỷ còn ít nhất 1 người đã được duyệt (buổi mở nhầm rồi huỷ ngay không bị tính). Buổi admin huỷ vẫn bị tính vì app chưa phân biệt ai huỷ.
15. Nhãn "Mới" dùng đúng định nghĩa nick mới của G2b: thành viên nhóm đã duyệt không bao giờ "Mới".
16. Hồ sơ là trang công khai `/players/{mã}`, mã ngẫu nhiên 10 ký tự, chỉ có tên, ảnh, nhãn, số liệu; không có buổi nào, ở đâu, với ai; không cho máy tìm kiếm lập chỉ mục.
17. Mã hồ sơ được tạo khi mở buổi, đăng ký buổi lần đầu, hoặc khi nick mới bấm "Chia sẻ hồ sơ của tôi". Không có script điền mã cho dữ liệu cũ vì prod chưa có buổi giao lưu.
18. Trang buổi có dòng uy tín ngắn của host kèm link hồ sơ; thẻ buổi trong danh sách tìm không hiện uy tín.
19. Trang quản lý của host hiện số lần đến, huỷ muộn, vắng của từng người đăng ký và link hồ sơ.
20. Hồ sơ đọc qua bộ nhớ đệm 10 phút; mã hồ sơ chỉ lưu id; tên, ảnh, trình độ, trạng thái và số liệu nằm chung một bộ nhớ đệm theo từng member, được làm mới ngay khi khoá, từ chối, duyệt, gộp, đổi tên, đổi ảnh, đổi trình độ. Gửi phiếu chấm không làm mới (điểm chỉ đổi khi buổi đóng chấm).

**Đánh giá sân**

21. Đánh giá sân ẩn danh trên trang công khai: không tên, không ảnh, chỉ nhãn "Đã chơi ở đây", tháng (không ngày giờ), điểm, nhận xét. Admin thấy người viết.
22. Cả 6 tiêu chí bắt buộc chấm 1-5; nhận xét không bắt buộc.
23. Điểm sân là trung bình có trọng số từng tiêu chí, điểm chung là trung bình 6 tiêu chí, kéo về trung bình chung của mọi sân bằng 5 lượt ảo, làm tròn 1 chữ số thập phân (nửa lên), tính bằng số nguyên. Dưới 3 đánh giá thì "Chưa đủ đánh giá" nhưng vẫn liệt kê.
24. Trung bình chung mọi sân chỉ tính lại mỗi giờ (và khi admin ẩn/hiện sân), không tính lại sau mỗi đánh giá. Lý do: nó gần như không đổi theo 1 đánh giá mà mỗi lần tính là quét cả bảng.
25. Điểm sân chỉ hiện ở trang chi tiết sân, chưa hiện trên thẻ sân và thẻ xem nhanh.
26. Sửa đánh giá: lần sửa đầu được bất cứ lúc nào, các lần sau cách nhau 30 ngày; đang bị ẩn thì không sửa được; gửi lại vì mạng chập chờn, hay hai tab cùng gửi lần đầu trong 1 phút, không bị tính là một lần sửa.
27. Bất thường: sân có từ 5 đánh giá mới trong 24 giờ, hoặc trong các đánh giá đang hiện của 90 ngày gần đây (từ 3 cái trở lên) quá nửa đến từ nick dưới 3 buổi, thì đánh giá mới vào hàng chờ. Đánh giá đang chờ không tính vào luật quá nửa, nên admin duyệt xong là sân hết bị kẹt. Sửa đánh giá chỉ kiểm nội dung.
28. Danh sách từ cấm nằm trong code: từ chửi thề so cả dấu, vài viết tắt không dấu không trùng chữ thường, và "dm"/"vcl" chỉ khi viết tách từng chữ ("d m", "đ.m"). Bỏ "con chó" vì sân hay có chó thật. Chữ chửi viết không dấu như "lon" sẽ lọt, chờ báo cáo.
29. Đủ 3 báo cáo của người không phải nick mới thì đánh giá tự ẩn; admin bỏ ẩn thì đếm lại từ 0; admin đóng báo cáo ở tab Báo cáo thì số báo cáo của đánh giá giảm theo.
30. Sân bị admin ẩn thì đánh giá của nó không đọc được qua trang hay action công khai.
31. Báo cáo người chơi từ hồ sơ (theo mã) và từ phiếu chấm, báo cáo sân từ trang sân, báo cáo đánh giá từ từng đánh giá. Sân bị báo cáo không tự ẩn.
32. Đánh giá bị giữ gửi chuông cho admin, tối đa 1 tin mỗi sân mỗi giờ, mở thẳng tab "Uy tín"; tin không có tên người viết hay nội dung.

**Chung**

33. Mọi thao tác ghi của G2d giữ đúng thứ tự kiểm user đã duyệt ở G2b (quyết định 30): cờ, tài khoản, dữ liệu, Turnstile, giới hạn tần suất, ghi DB. `reportAbuse` không đổi. Lý do: một thứ tự cho cả codebase, cờ tắt luôn báo "không tìm thấy", và không dòng nào được ghi trước khi cờ và tài khoản qua.
34. Cờ host: trong 90 ngày, tài khoản chưa vào nhóm được host điểm danh ở ít nhất 3 buổi của host đó và từ 80% lần được điểm danh là ở buổi host đó thì là "khách quen khép kín"; host có từ 3 người như vậy bị gắn cờ. Thành viên nhóm đã duyệt không bao giờ là khách quen khép kín. Admin bấm "Đã xem" thì cờ ẩn tới khi con số tăng; trang báo khi dữ liệu quá nhiều bị cắt. Cờ không tự phạt.
35. Toàn bộ G2d nằm sau cờ `exchangeEnabled`; cờ tắt thì trang sân vẫn hiện "Đánh giá sân: sắp có", trang hồ sơ 404.
36. Thêm index `session_attendees(member_id)` (chỉ thêm).
37. Gộp tài khoản (cả `mergeMember` và duyệt-gộp): lượt chấm, đánh giá sân, cờ host, giới thiệu chuyển sang tài khoản giữ lại, trùng thì giữ của tài khoản giữ lại; sau khi gộp không còn lượt nào tự chấm mình hay host tự chấm buổi mình (kể cả lượt vốn của tài khoản giữ lại); hai đăng ký cùng buổi giữ điểm danh và giờ điểm danh sớm hơn; tài khoản giữ lại chưa có mã thì nhận mã của tài khoản cũ. Xoá hẳn member có dữ liệu này bị chặn, dùng "Vô hiệu hoá".
38. Người bình luận chỉ có thêm nhãn "Mới"; phiếu chấm liệt kê tối đa 50 người chơi cùng.

**Người giới thiệu**

39. Người giới thiệu bấm "Giới thiệu người này" trên hồ sơ của nick mới; không làm link mời qua đăng nhập. Lý do: không đụng luồng đăng nhập Zalo/Google, cả hai bên cùng đồng ý, mã công khai không phải bí mật nên nick ảo không tự gắn được vào quota của người khác.
40. Điều kiện giới thiệu: tổng số buổi đã đến (theo quyết định 2) từ 3 và tỉ lệ đến ở buổi giao lưu từ 80%; chưa có buổi giao lưu nào được duyệt thì coi như đạt điều kiện tỉ lệ.
41. Tối đa 5 người mỗi tháng theo lịch giờ Việt Nam, tính cả lượt đã bị phá.
42. Chỉ giới thiệu được tài khoản chưa vào nhóm và chưa được điểm danh buổi nào; mỗi người chỉ được giới thiệu 1 lần, không đổi, không huỷ.
43. "30 ngày đầu" tính từ lúc được giới thiệu; lần vắng tính theo giờ bắt đầu buổi, huỷ muộn theo giờ huỷ; buổi bị huỷ không tính.
44. Vắng hoặc huỷ muộn đủ 2 lần trong 30 ngày đó: người giới thiệu mất quyền 30 ngày tính từ lần thứ 2, và người được giới thiệu quay lại bị giới hạn như nick mới. Không trừ điểm công khai.
45. Mọi trạng thái giới thiệu tính từ dữ liệu đăng ký lúc đọc, không lưu cờ riêng.
46. Được giới thiệu chỉ bỏ các giới hạn nick mới (tối đa 2 đăng ký chờ, không dắt thêm người, 5 bình luận/ngày). Nhãn "Mới" vẫn hiện, kèm chip "Được giới thiệu" không ghi tên người giới thiệu; người được giới thiệu không tính là "đã quen" khi đếm báo cáo.
47. Giới thiệu có Turnstile và giới hạn 10 lần/ngày; lấy mã hồ sơ của chính mình thì không.
48. Không gửi thông báo khi bị khoá quyền giới thiệu; người giới thiệu thấy ngày mở lại trong "Giao lưu của tôi".
49. Nút giới thiệu chỉ hiện cho người đủ điều kiện, còn lượt, không bị khoá.
50. Nick mới có thẻ giải thích giới hạn và nút "Chia sẻ hồ sơ của tôi" để nhờ người quen giới thiệu.

**Nick trùng**

51. Lưu mạng đã băm lúc đăng nhập ở trang giao lưu (Zalo, Google) và lúc đăng ký buổi giao lưu, không ghi ở đăng nhập của nhóm.
52. Chỉ lưu HMAC dùng chung khoá `USER_COOKIE_SECRET` như `hashedIpKey` của G2a, tách miền bằng tiền tố riêng; không lưu IP thô, không hiện hash cho admin, không log IP hay tên. Đánh đổi: đổi khoá này (vd khi lộ) thì mọi tín hiệu cũ không còn khớp với tín hiệu mới, tức mất tối đa 30 ngày dữ liệu nick trùng; chấp nhận vì dữ liệu này vốn chỉ sống 30 ngày.
53. Hai tín hiệu ít nhiễu: "cùng tên và từng dùng chung mạng" (một bên là tài khoản giao lưu), và "từ 3 tài khoản giao lưu tạo trong 24 giờ từ cùng một mạng". Không dùng riêng "chung mạng" vì nhà mạng di động cho nhiều người chung IP và nhóm bạn hay đăng ký chung wifi ở sân.
54. Tín hiệu chỉ để admin xem; app không tự khoá ai.
55. Dòng tín hiệu xoá sau 30 ngày: mỗi lần ghi xoá bớt một lô dòng cũ, và cron hằng ngày xoá tiếp theo lô kể cả khi đang tắt thông báo (bước dọn chạy trước cổng cờ thông báo); lúc đọc luôn bỏ qua dòng quá 30 ngày.
56. Ghi tín hiệu lỗi thì bỏ qua có chủ đích, không làm hỏng đăng nhập hay đăng ký.
57. Dùng chung banner trùng tên nhưng tách mục riêng, chỉ có "Bỏ qua"; không có nút gộp vì `mergeMember` cố ý chặn gộp tài khoản giao lưu.

**Nhắc chấm**

58. 1 giờ sau giờ kết thúc buổi, app nhắc người đã được điểm danh mà chưa chấm; mỗi người tối đa 1 tin mỗi buổi; host không nhận.
59. Tin này tắt được (nhóm "Giao lưu") và có email như các tin giao lưu khác, theo giờ yên lặng và giới hạn email của N1.
60. Lúc job chạy, app kiểm lại: buổi còn, không huỷ, không ẩn, giờ kết thúc không đổi, người nhận còn điểm danh, chưa chấm, còn trong 7 ngày.
61. Người được điểm danh muộn sau khi tin đã gửi không nhận tin; họ vẫn thấy nút "Đánh giá buổi này" và huy hiệu "Chưa đánh giá".
62. Không có QStash (máy local) thì job chỉ được lưu, cron hằng ngày chạy khi tới giờ; không dùng nhánh "chạy ngay" của `scheduleOneOffJob` cho job ở tương lai.
63. Buổi bị huỷ hoặc ẩn thì job bị huỷ ngay; bỏ ẩn trước giờ nhắc thì job sống lại. Đổi giờ buổi không có đường nào (G2b quyết định 9), vân tay giờ kết thúc trong khoá job vẫn chặn nếu sau này mở.

## Review disposition

| id | Kết quả | Ghi chú |
|---|---|---|
| C1 | accepted | Chỉ cộng buổi đã đóng chấm, ngưỡng 3 người chấm theo từng buổi (`keepEventsWithRaters`), `raters` null dưới 3, bỏ `updateTag` khỏi `submitEventFeedback`; test "host views their profile before and after a one-player event" (Task 7); quyết định 9, 20 |
| I1 | accepted | Giải bằng thứ tự G2b: cờ và tài khoản trước Turnstile, rate limit chỉ ghi sau đó; test dùng `checkBotAndRate` thật khẳng định `rate_limit_buckets` rỗng (Task 6, 8, 12) |
| I2 | accepted | `reportAbuse` giữ nguyên thứ tự và harness; bỏ quyết định đổi thứ tự cũ (nay là quyết định 33) |
| I2b | accepted | `month: "YYYY-MM"` thay `createdAt` (Task 9, 8 `MyVenueReview`); quyết định 21 |
| I3 | accepted | Cache mã chỉ giữ id; cache member gắn `repTag(id)`; `invalidateMemberReputation` ở mọi đường sửa member (Task 15); quyết định 20 |
| I4 | accepted | Xoá mọi `host_feedback` tự chấm sau gộp, `checkedIn` OR khi gộp hai đăng ký, "điểm danh hợp lệ" có `status = 'approved'` (Global Constraints, Task 5, 7, 15); quyết định 11, 37 |
| I5 | accepted | Test duyệt-gộp ở Task 15 |
| I6 | accepted | Bỏ `updateTag(VENUE_REVIEWS_TAG)` khỏi đường ghi đánh giá, trung bình chung revalidate 1 giờ; quyết định 24 |
| I7 | accepted | `queryFn` mở gói và throw, `initialPageParam`; test lỗi trang 2 (Task 21) |
| I8 | accepted | Task 13 cũ tách thành 16 và 17, Task 16 cũ thành 21 và 22; Task 10 không còn đổi thứ tự nên giữ một task |
| I9 | accepted | Luật quá nửa chỉ đếm `visible` trong 90 ngày; test admin duyệt xong thì hết kẹt (Task 8); quyết định 27 |
| I10 | accepted | Join `venues approved` ở trang và tổng; `setVenueStatus` làm mới tag sân và trung bình chung (Task 9); quyết định 30 |
| M1 | accepted | `code?: string \| null`, thêm fixture `comments/fixtures.ts` vào danh sách ngoại lệ |
| M2 | accepted | Bọc try, `code_failed`, trả `saveFailed` (Task 4) |
| M3 | accepted | `createCacheStore` khoá theo `[keyParts, args]` (Task 7) |
| M4 | accepted | Tra `idempotencyKey` trước kiểm cửa sổ (Task 6) |
| M5 | accepted | `REVIEW_DOUBLE_SUBMIT_MS`, không đặt `editedAt` (Task 8); quyết định 26 |
| M6 | accepted | `MyVenueReview.review.id`, sửa thay dòng theo `id`, dòng `held` chỉ hiện trong sheet (Task 8, 22) |
| M7 | accepted | Ẩn dòng 0, hết dòng thì câu "chưa đủ" (Task 2, 17); quyết định 8 |
| M8 | accepted | Chỉ đếm buổi huỷ còn người đã duyệt; buổi admin huỷ vẫn tính vì chưa có cột phân biệt (để lại sau G2d); quyết định 14 |
| M9 | accepted | Bỏ member approved khỏi khách quen, cắt theo `start_at DESC`, báo `truncated` (Task 11, 23); quyết định 34 |
| M10 | accepted | Bỏ "con chó"; "dm" chỉ khớp khi viết tách chữ; test "inbox DM" (Task 3); quyết định 28 |
| M11 | accepted | Đổi tên test thành "defaults to NULL", ghi rõ rủi ro index chỉ kiểm ở bước áp lên `e2e/local.db` (Task 1) |
| M12 | accepted | Thêm `hiddenAt` vào select `regRows` (Task 18) |
| M13 | accepted | `adminResolveReport` gọi `syncReviewReportCount` (Task 10); quyết định 29 |
| M14 | accepted | Mỗi người viết đánh giá trong e2e có ít nhất 3 lần điểm danh trước (Task 26) |
| M15 | accepted | Bước 0 đọc `isNotificationsEnabled(tx)` (Task 8) |
| R1 | accepted | Bước dọn tín hiệu chạy trước cổng cờ thông báo (gọi ở route cron trước khi trả `skipped`); test cờ tắt vẫn xoá dòng quá 30 ngày (Task 13); quyết định 55 |
| R2 | accepted | Index `member_ip_signals(last_seen_at)`, `pruneIpSignals` xoá theo lô `id IN (SELECT ... LIMIT 200)`, test EXPLAIN (Task 1, 13) |
| R3 | accepted | Bước `exchange_rating` đăng dòng `scheduled` chưa có `messageId` khi vào khung 7 ngày, theo mẫu `rescheduleSessionJobs`; test buổi tạo trước 10 ngày (Task 14) |
| R4 | accepted | Thêm `exchange_events_end_at_idx`; không index sẵn có nào phủ khoảng `end_at` (Task 1, 14); tổng 18 index mới |
| R5 | accepted | Giữ `USER_COOKIE_SECRET` như `hashedIpKey` của G2a, ghi đánh đổi khi đổi khoá vào quyết định 52 |
