# G2c Bình luận dạng Reddit trên buổi giao lưu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi buổi giao lưu có 2 khu bình luận ở cuối bài: "Hỏi đáp" (ai cũng đọc, người đã đăng nhập viết) và "Nhóm buổi" (chỉ host và người được duyệt). Có trả lời lồng 2 tầng, "Hữu ích", sắp xếp, ghim, khoá, sửa trong 10 phút, xoá mềm, giữ lại bình luận có sđt/link chờ duyệt, báo cáo đủ 3 lần thì tạm ẩn, chặn người bị host chặn, thông báo trên chuông, và số bình luận mới ở "Giao lưu của tôi". Không polling. Toàn bộ sau cờ `exchangeEnabled`.

**Architecture:** Ba bảng mới `exchange_comments`, `exchange_comment_votes`, `exchange_comment_reads` và cột `exchange_events.comments_locked` (migration 0031, chỉ thêm). Logic thuần (chuẩn hoá chữ, dò sđt/link, dựng cây trả lời) ở `src/lib/exchange/comment-text.ts`, `comment-tree.ts`. Quyền theo khu ở `src/lib/exchange/comment-access.ts`; đọc danh sách và đếm bình luận mới ở `src/lib/exchange/comment-reads.ts` (cả hai server-only, nhận `tx`/`db`). Vỏ server action ở `src/actions/exchange-comments.ts`. Khách đọc qua 2 lớp cache: thông tin buổi cho bình luận (tag `"exchange"` + `xcmeta:{code}`) và trang Hỏi đáp (tag `xcmt:e{eventId}`, key có `"qa"` cố định). Phần riêng của người đã đăng nhập (phiếu của mình, số Hữu ích mới nhất, bình luận chờ duyệt) đọc theo request. Turnstile chỉ ở bình luận đầu tiên mỗi phiên đăng nhập, nhớ bằng cookie ký HMAC 12 giờ, không ghi DB.

**Tech Stack:** Next.js 16.2.1 App Router (server actions, `unstable_cache`, `updateTag`, `cookies()`), Drizzle + Turso (libsql, SQLite window functions), zod, next-intl (vi/en/zh), @tanstack/react-query 5 (`useInfiniteQuery`), nuqs, framer-motion, Cloudflare Turnstile (`checkBotAndRate`, `TurnstileWidget`), vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-exchange-events-nearby-design.md` (4.6f là yêu cầu chính; 4.6c, 4.6e cho chặn, báo cáo, chống bot; 4.7 dòng `exchange_comments`, `exchange_comment_votes`, `exchange_comment_reads`, `comments_locked`; mục 6 quyết định 16, 17). Thông báo: `docs/superpowers/specs/2026-11-04-notifications-design.md` (4.6, 4.10 N2). Quy ước kế thừa: `docs/superpowers/plans/2026-11-05-exchange-events-g2b.md` (Global Constraints, quyết định 14, 30, 31, "Phạm vi để lại cho G2c"). Bản rà plan: `.superpowers/g2c/plan-review.md` (33 mục, xử lý ở cuối plan).

## Global Constraints

- **Nơi làm:** worktree `D:/Lwcifer/LW/FWBB-g2c`, nhánh `feat/g2c-comments` (từ `feat/g2b-events` 76e0174). Không push, không merge vào `main`, không deploy (memory `feedback_g2_local_until_complete`).
- **Env và DB:** KHÔNG đọc, tạo hay sửa file `.env*` (`D:/Lwcifer/LW/FWBB/.env.local`, `.env.prod` trỏ PROD). Env test: `.superpowers/g2c/test-env.sh`, `.superpowers/g2c/local-db.env` (`TURSO_DATABASE_URL=file:e2e/local.db`). Mọi lệnh script DB kèm `--env=.superpowers/g2c/local-db.env`.
- **Kế thừa nguyên văn từ G2b Global Constraints:** thứ tự kiểm cờ → quyền → zod → Turnstile → rate limit → `db.transaction` (quyết định 30 G2b); cache trả JSON thuần; Next 16 docs (đọc thêm `cookies.md`, `updateTag.md`, `01-getting-started/*mutating*.md` mục cookie); mobile-first; Turnstile client rule I1; log `console.error("[Exchange] <mã>", { id })`, không `console.log`.
- **Ranh giới server action (C3, siết lại cho G2c):** `src/actions/exchange-comments.ts` chỉ export đúng các action: `addComment`, `editComment`, `deleteComment`, `toggleCommentVote`, `pinComment`, `setCommentsLocked`, `approveHeldComment`, `listExchangeComments`, `listCommentReplies`, `markCommentsRead`. `src/actions/exchange-mine.ts` vẫn chỉ export `getMyExchanges`. Mọi hàm nhận `db`/`tx`, `memberId`, `eventId` hay đọc dữ liệu thô (`loadThreadRows`, `getPublicQaPageCached`, `getCommentEventMetaCached`, `countNewComments`, `newCommentsSince`, `loadCommentContext`...) nằm ở `src/lib/exchange/comment-*.ts` có `import "server-only"`, không export lại từ file action. Task 8 có test khoá danh sách export.
- **Gọi helper có sẵn đúng chữ ký:** `checkRateLimit(key, RL.limit, RL.windowMs)`; `checkBotAndRate({ token, action, rateKey, limit, windowMs })`. `checkRateLimit` tự mở transaction trên `db`, nên KHÔNG gọi bên trong `db.transaction` (dễ BUSY).
- **Tiền:** G2c không có tiền. KHÔNG đụng `financial_transactions`, `session_debts`, `exchange-fee.ts`, `settle.ts`. Riêng Task 3 sửa `member-rows.ts` (trong luồng gộp member) nên phải qua `finance-invariant-reviewer`.
- **Migration:** số **0031**. Chỉ `CREATE TABLE`, `CREATE [UNIQUE] INDEX` và đúng một `ALTER TABLE exchange_events ADD comments_locked integer DEFAULT false NOT NULL`. Thấy `__new_`, `INSERT`, `DROP` là sai. Enum chỉ ở TS. `zalo_group_link` đã có từ 0029. Sau khi áp lên `e2e/local.db`, so `sqlite_master` với mốc Task 0: chỉ có thêm.
- **Quota Turso:** không `usePolling`, không `refetchInterval`. react-query `staleTime: 60_000`, `refetchOnWindowFocus: true`, nút "Tải bình luận mới". Khách đọc hoàn toàn qua cache (không truy vấn DB khi cache còn). `updateTag` trong server action làm Next render lại cả trang buổi (`revalidate.js:59-61`), đặt cookie cũng vậy (docs mutating, mục cookie). Vì thế: `toggleCommentVote` và `markCommentsRead` KHÔNG gọi `updateTag` và không đặt cookie; chỉ viết, sửa, xoá, ghim, duyệt, khoá, ẩn mới gọi `updateTag(commentTag(eventId))` (khoá gọi thêm `updateTag(commentMetaTag(code))`). KHÔNG gọi `updateTag("exchange")` ở G2c. Mọi danh sách tối đa 50 dòng bình luận mỗi lần gọi (spec 4.6e).
- **Riêng tư:** payload bình luận chỉ có `name`, `avatarUrl`, `avatarKey` của tác giả và cờ `isHost`. Không member id, không sđt/email. Dòng `deleted`, `hidden`, `held` trong cache công khai có `body = NULL`, tác giả `NULL` ngay trong SQL. Khu Nhóm buổi không bao giờ đi qua cache.
- **Hiển thị chữ:** body render là text node React trong `whitespace-pre-wrap break-words`. Không `dangerouslySetInnerHTML`, không linkify, không markdown. `@tên` là chip dựng từ `replyToMemberId` lúc đọc, không nằm trong body.
- **i18n:** namespace `exchange.comments.*`, lỗi ở `exchange.errors.*`, đủ vi/en/zh, `src/i18n/locale-parity.test.ts` xanh, không em dash.
- **Commit:** Conventional Commits 1 dòng, không body, không trailer.

### Quy ước dùng chung

| Việc | Quy ước |
|---|---|
| Hằng số | `src/lib/exchange/constants.ts` (Task 1) |
| Tầng | gốc: `parentId = null`; tầng 1: cha là gốc; tầng 2: cha là tầng 1. Trả lời một bình luận tầng 2 → lưu với `parentId` = cha của nó (tầng 1). `replyToMemberId` luôn = tác giả bình luận được bấm "Trả lời"; chip `@tên` chỉ hiện khi người đó khác tác giả của `parentId` |
| Vai trò người xem | `guest` (chưa đăng nhập hoặc bị khoá), `member`, `approved` (đăng ký `approved`), `host` |
| Quyền khu | Hỏi đáp: đọc = ai thấy được buổi; viết = `member/approved/host`. Nhóm buổi: đọc và viết = `approved/host` |
| Trạng thái ghi | `open`; `locked` (host khoá); `closed` (buổi bị ẩn, host hết hiệu lực, hoặc quá 7 ngày sau `endAt`/`cancelledAt`) |
| Thấy bình luận `held` | Chỉ tác giả và host. Người khác: như không tồn tại (lỗi chung `commentNotFound`); trong cây chỉ là dòng giữ chỗ khi có trả lời |
| Kết quả action | `{ success: true, data? } \| { needsCaptcha: true } \| { error: string }` |
| Rate limit (khoá) | Viết mới `exchange-comment-burst:{id}` 1/10s; host trong buổi mình `exchange-comment-host:{id}` 20/phút, không giới hạn ngày; ngày `exchange-comment-day:{id}` 30 (nick mới 5); sửa `exchange-comment-edit:{id}` 10/phút; Hữu ích `exchange-comment-vote:{id}` 60/giờ; xoá/ghim/khoá/duyệt `exchange-comment-mod:{id}` 60/giờ |
| `dedupBase` | `xcn:e{eventId}:{hourUTC}` (host, gốc mới), `xcr:e{eventId}:{hourUTC}` (có người trả lời), `xch:c{commentId}` (host đăng ở Nhóm buổi), `xchd:e{eventId}:{hourUTC}` (có bình luận chờ duyệt). `hourUTC = now.toISOString().slice(0, 13)` |

## Review Focus

1. **Người không có quyền chạm khu Nhóm buổi hay bình luận chờ duyệt qua id đoán được:** tài khoản chưa được duyệt, khách, hay member của buổi khác gửi `parentId`/`commentId` của bình luận khu Nhóm buổi hoặc bình luận `held` của người khác để trả lời, sửa, xoá, ghim, Hữu ích, báo cáo, xem trả lời; hay đổi `channel` thành `group`: luôn nhận lỗi chung, không ghi gì, không gửi tin. Test ở Task 5, 6, 7, 8, 9.
2. **Cookie "đã qua Turnstile" bị dùng lại sai:** cookie của member A khi member B đăng nhập trên cùng máy, sau khi đăng xuất rồi đăng nhập lại, quá 12 giờ, chữ ký sai, hay thiếu `USER_COOKIE_SECRET`: đều đòi Turnstile lại (thiếu khoá thì báo lỗi cấu hình, không ghi bình luận). Test ở Task 5, 6.
3. **Số điện thoại và link viết lách luật, cùng ngày giờ dễ nhầm:** "0 9 1 2 3 4 5 6 7 8", "091 234 5678", "+84 912 345 678", "zalo.me/0912345678", "shopee.vn/abc" bị giữ; "Buổi 09.11.2026 19:30 còn slot không?", "05/12 lúc 19h, 2 slot", "120.000", "1.200.000đ", "slot 12/24" không bị giữ; sửa để thêm link thì vào hàng chờ và câu trả lời bên dưới vẫn hiện. Test ở Task 2, 6.
4. **Báo cáo đồng loạt hoặc bằng nick mới:** 3 người báo cùng lúc thì ẩn đúng 1 lần; 3 nick mới không ẩn được gì; bình luận của host không tự ẩn; admin bỏ ẩn thì đếm lại từ 0. Test ở Task 9.
5. **Cache công khai lộ hoặc cũ, hoặc khách làm tốn quota:** khách không bao giờ thấy nội dung `held`, `deleted`, `hidden` hay khu Nhóm buổi; xoá xong tải lại thấy "[đã xoá]" ngay; khách tải lại nhiều lần không chạm DB khi cache còn; bình luận không làm mất cache tìm buổi. Test ở Task 8.

---

### Task 0: Chuẩn bị env và đo baseline

**Files:** không sửa code. `.superpowers/g2c/` đã có `test-env.sh`, `local-db.env` (gitignored).

- [ ] **Step 1:** `git status` trong `D:/Lwcifer/LW/FWBB-g2c`: sạch, chỉ có file plan chưa theo dõi. `pnpm install`.
- [ ] **Step 2:** Kiểm không có server nào mở `D:/Lwcifer/LW/FWBB-g2b/e2e/local.db`, rồi copy sang `e2e/local.db`. `git check-ignore .superpowers/g2c/test-env.sh e2e/local.db` in cả hai.
- [ ] **Step 3:** `node scripts/apply-migration.mjs --env=.superpowers/g2c/local-db.env --dry-run`: thấy "Loaded env from", tới 0030 "applied", không "WOULD APPLY". Lưu `select type, name, tbl_name, sql from sqlite_master order by name` vào `.superpowers/g2c/sqlite-master-before.txt`.
- [ ] **Step 4:** Baseline, mỗi lệnh ghi exit riêng (`cmd > .superpowers/g2c/base-<x>.log 2>&1; echo "x_exit=$?"`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/g2c/test-env.sh && pnpm build`, `source .superpowers/g2c/test-env.sh && pnpm test:e2e`. Expected: exit 0 hết. Ghi số test vào `.superpowers/g2c/ledger.md`. Đỏ sẵn thì dừng và báo.

### Task 1: Bảng dữ liệu, migration 0031, hằng số

**Files:**
- Modify: `src/lib/exchange/constants.ts`, `src/db/schema.ts`
- Create: `src/db/migrations/0031_*.sql` + meta (`pnpm db:generate`)
- Test: `src/db/exchange-comments-schema.integration.test.ts`

**Interfaces:**
- `constants.ts` thêm: `REPORT_TARGET_TYPES = ["member", "event", "comment"]`; `COMMENT_CHANNELS = ["qa", "group"]`; `COMMENT_STATUSES = ["visible", "held", "deleted", "hidden"]`; `COMMENT_SORTS = ["top", "new"]`; `COMMENT_MAX_LEN = 1000`; `COMMENT_EDIT_WINDOW_MS = 600_000`; `COMMENT_PAGE_ROOTS = 10`; `COMMENT_PAGE_TIER1 = 2` (trả lời tầng 1 mỗi gốc trong trang); `COMMENT_PAGE_TIER2 = 1` (trả lời tầng 2 mỗi tầng 1 trong trang); `COMMENT_REPLIES_PAGE = 10` (tầng 1 mỗi lần "Xem thêm trả lời", kèm tối đa 4 tầng 2 mỗi cái); `COMMENT_MAX_ROWS = 50`; `COMMENT_CHANNEL_CAP = 500`; `COMMENT_REPORT_HIDE_THRESHOLD = 3`; `COMMENT_OPEN_AFTER_END_DAYS = 7`; `COMMENT_COUNT_WINDOW_DAYS = 14`; `COMMENT_PASS_TTL_MS = 43_200_000`; `RL_COMMENT_BURST = { limit: 1, windowMs: 10_000 }`; `RL_COMMENT_HOST = { limit: 20, windowMs: 60_000 }`; `RL_COMMENT_DAY = { limit: 30, windowMs: 86_400_000 }`; `RL_COMMENT_DAY_NEW = { limit: 5, windowMs: 86_400_000 }`; `RL_COMMENT_EDIT = { limit: 10, windowMs: 60_000 }`; `RL_COMMENT_VOTE = { limit: 60, windowMs: 3_600_000 }`; `RL_COMMENT_MOD = { limit: 60, windowMs: 3_600_000 }`; `TS_COMMENT = "exchange_comment"`; type `CommentChannel`, `CommentStatus`, `CommentSort`.
- Bảng:
  - `exchangeComments`: `id`; `eventId` FK notNull; `channel` notNull; `parentId` FK self nullable; `replyToMemberId` FK members nullable; `authorMemberId` FK members notNull; `body` notNull; `status` default `"visible"`; `upvotes` integer default 0; `pinned` boolean default false; `idempotencyKey` nullable; `editedAt` nullable; `createdAt` notNull. Index: `(event_id, channel, created_at)` (spec), `(event_id, created_at)` (đếm mới, Task 8), `(parent_id, created_at)`, `(author_member_id, created_at)`, unique `idempotency_key`. CHECK `upvotes >= 0`.
  - `exchangeCommentVotes`: `id`, `commentId` FK, `memberId` FK, `createdAt`; unique `(comment_id, member_id)`, index `(member_id)`.
  - `exchangeCommentReads`: `id`, `eventId` FK, `memberId` FK, `lastReadAt` nullable (khu Hỏi đáp, cột spec), `lastReadGroupAt` nullable (khu Nhóm buổi); unique `(event_id, member_id)`, index `(member_id)`.
  - `exchangeEvents.commentsLocked` boolean notNull default false.

- [ ] **Step 1: Test đỏ** (mẫu `src/db/exchange-schema.integration.test.ts`, `createTestDb()`): `creates the three comment tables with every declared index`; `comment vote (comment, member) is unique`; `comment read (event, member) is unique`; `negative upvotes rejected`; `exchange_events.comments_locked defaults to 0 for an existing row`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Viết, `pnpm db:generate`. Mở file 0031, kiểm chỉ có `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, 1 `ALTER TABLE ... ADD`.
- [ ] **Step 4:** PASS. `node scripts/apply-migration.mjs --env=.superpowers/g2c/local-db.env`, so `sqlite_master` với mốc: chỉ thêm.
- [ ] **Step 5: Commit** `feat(exchange): add exchange comment tables`

### Task 2: Chữ bình luận và cây trả lời (thuần)

**Files:** Create `src/lib/exchange/comment-text.ts`, `src/lib/exchange/comment-tree.ts`; Test `comment-text.test.ts`, `comment-tree.test.ts` cùng thư mục.

**Interfaces:**
- `normalizeCommentBody(raw: string): string`: NFC, bỏ ký tự điều khiển trừ `\n`, đổi `\r\n` thành `\n`, gộp hơn 2 dòng trống liên tiếp thành 2, trim.
- `detectContact(body: string): { phone: boolean; link: boolean }`. Phone làm 2 bước, KHÔNG bỏ khoảng trắng cả bài:
  1. Thay bằng 1 dấu cách các mẫu dễ nhầm: ngày `\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b`, giờ `\b\d{1,2}[:h]\d{2}\b`, tiền `\b[1-9]\d{0,2}(?:[.,]\d{3})+(?![.,]?\d)`.
  2. Tìm `(?<!\d)(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)` trên chuỗi đã thay (đúng 10 chữ số với `0`, 11 với `84`; mỗi chữ số cách nhau tối đa 1 ký tự phân cách).
  Link: `https?://`, `www\.`, `zalo\.me`, `fb\.com`, `t\.me`, `m\.me`, hoặc `[a-z0-9-]+\.(com|vn|net|org|me|io|co|link|ly|xyz|info|top|shop|store|site|online|app|gg|tv)\b` (không phân biệt hoa thường).
- `type CommentRow = { id; parentId: number | null; channel; authorMemberId: number | null; authorName: string | null; authorAvatarUrl; authorAvatarKey; replyToName: string | null; body: string | null; status; upvotes; pinned; editedAt; createdAt; replyCount: number }` (JSON thuần; `authorMemberId`, `authorName`, `body` là null với dòng `held/deleted/hidden` lấy từ cache công khai; `replyCount` = số con `visible`).
- `type CommentView = { id; parentId; author: { name; avatarUrl; avatarKey; isHost: boolean } | null; replyToName: string | null; body: string | null; state: CommentStatus; upvotes; pinned; edited: boolean; createdAt; mine: boolean; myVote: boolean; canEdit: boolean; canDelete: boolean; canApprove: boolean; canPin: boolean; moreReplies: number; replies: CommentView[] }`
- `buildThreads(rows: CommentRow[], opts: { hostMemberId: number; viewerId: number | null; isHost: boolean; myVotes: Set<number>; sort: CommentSort; now: Date; writeOpen: boolean }): CommentView[]`:
  - Gốc: ghim trước; `top` → `upvotes` giảm dần rồi `createdAt` tăng dần; `new` → `createdAt` giảm dần. Trả lời luôn cũ trước.
  - Dòng không có `body` (`held/deleted/hidden` chưa được ghép bản đầy đủ): `author = null`, `body = null`, giữ `state`; bỏ hẳn nếu không còn con nào hiện được.
  - `moreReplies = replyCount - số con có trong rows`.
  - `canEdit` = `mine && state in (visible, held) && now - createdAt <= COMMENT_EDIT_WINDOW_MS && writeOpen`; `canDelete` = `(mine || isHost) && state in (visible, held)`; `canApprove` = `isHost && state === "held"`; `canPin` = `isHost && parentId === null && state === "visible"`.
  - Trả lời mồ côi bị bỏ. Không key nào chứa member id.

- [ ] **Step 1: Test đỏ:** `normalize trims, keeps single newlines, collapses blank runs, strips control chars`; `detects 0912345678, 0912 345 678, 091 234 5678, 0912.345.678, +84 912 345 678, 84912345678, "0 9 1 2 3 4 5 6 7 8"`; `does not flag "Buổi 09.11.2026 19:30 còn slot không?", "05/12 lúc 19h, 2 slot", 120.000, 1.200.000đ, 2026-11-20, slot 12/24, 0912345 (7 số)`; `detects https://, www., shopee.vn/abc, zalo.me/g/abc, fb.com/x, t.me/x`; `does not flag "cầu.Thành Công" or "a.b"`; `pinned root first, then top sort by upvotes`; `new sort puts the newest root first, replies stay oldest first`; `deleted leaf is dropped; deleted, hidden or held root with a visible reply shows a placeholder without author or body`; `full held row shows to its author and the host`; `canEdit false after 10 minutes and when writing is closed`; `moreReplies counts children not on the page`; `orphan replies are dropped`; `output contains no member id field` (duyệt key đệ quy).
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/lib/exchange/comment-`).
- [ ] **Step 3: Commit** `feat(exchange): normalize comment text and build reply threads`

### Task 3: Gộp và xoá member với dữ liệu bình luận

**Files:** Modify `src/lib/exchange/member-rows.ts`; Test case mới trong `src/actions/merge-member-exchange.integration.test.ts` (chỉ thêm).

**Interfaces:**
- `repointExchangeRows(tx, sourceId, targetId)` thêm, chạy SAU phần đăng ký và chặn hiện có:
  - `exchange_comments.author_member_id` và `reply_to_member_id`: nguồn → đích.
  - `exchange_comment_votes`: trùng `(comment, đích)` → xoá phiếu nguồn, `upvotes = MAX(upvotes - 1, 0)`; phiếu thành tự bấm sau khi gộp (cả hai chiều: phiếu của nguồn cho bình luận của đích, và phiếu sẵn có của đích cho bình luận vốn của nguồn) → xoá và trừ như trên; còn lại chuyển sang đích.
  - `exchange_comment_reads`: trùng `(event, đích)` → dòng đích lấy `max` của từng cột (`lastReadAt`, `lastReadGroupAt`), xoá dòng nguồn; còn lại chuyển.
  - Báo cáo nhắm `comment` không đổi.
- `countExchangeRefs` cộng số dòng ở 3 bảng mới. Xoá cứng member vẫn bị chặn (memory `project_member_hard_delete_blocked_by_money`: đúng thiết kế, dùng "Vô hiệu hoá").

- [ ] **Step 1: Test đỏ:** `merge moves comments, reply targets, votes and reads to the target`; `merge drops the duplicate vote and keeps upvotes equal to the vote count`; `merge drops the source's vote on a target comment`; `merge drops the target's vote on a source comment`; `merge keeps the later read time per channel`; `deleteMember with only a vote is blocked with the exchange ref error`; `approve-as-merge of a pending account that commented succeeds`.
- [ ] **Step 2:** FAIL (FK) → viết → PASS + `pnpm test src/actions/merge src/actions/member-approval src/actions/members`.
- [ ] **Step 3:** `finance-invariant-reviewer`, prompt: "Review `git -C D:/Lwcifer/LW/FWBB-g2c diff 76e0174..HEAD -- src/lib/exchange/member-rows.ts`, đọc file dưới `D:/Lwcifer/LW/FWBB-g2c`. Khẳng định mergeMember vẫn chuyển đủ nợ và sổ quỹ, không ghi financial_transactions/session_debts." PASS mới đóng.
- [ ] **Step 4: Commit** `fix(members): carry exchange comments through merge and block delete`

### Task 4: Thông báo bình luận

**Files:**
- Modify: `src/lib/notifications/catalog.ts` (group `"exchange_comments"` vào `NotificationGroup` và `MEMBER_GROUPS`; 4 kind), `src/lib/notifications/render.ts` (`notificationHref`), `src/components/notifications/notification-prefs-section.tsx` (lọc ở dòng 87-89: ẩn cả `exchange_comments` khi `!exchangeEnabled`), i18n `notifications.kinds.*`, `notifications.groups.exchange_comments`, `notifications.reportTargets.comment`
- Create: `src/lib/notifications/exchange-comments.ts` (`import "server-only"`)
- Test: `src/lib/notifications/exchange-comments.integration.test.ts`, case mới trong `catalog.test.ts`, `render.test.ts`, test prefs section

**Interfaces:**

| kind | nhận | group | mandatory | email | level | payload |
|---|---|---|---|---|---|---|
| `exchange_comment_new` | host, khi một bình luận GỐC của người khác trở thành `visible` (cả 2 khu) | exchange_comments | no | no | now | `{eventCode, eventTitle, channel}` |
| `exchange_comment_reply` | tác giả bình luận cha và `replyToMember`, trừ người viết | exchange_comments | no | no | now | `{eventCode, eventTitle, channel}` |
| `exchange_comment_host_post` | mọi đăng ký `approved`, khi host đăng gốc ở Nhóm buổi | exchange_comments | no | no | now | `{eventCode, eventTitle}` |
| `exchange_comment_held` | host, khi có bình luận vào hàng chờ duyệt | exchange_comments | no | no | now | `{eventCode, eventTitle}` |

- Không payload nào có tên hay nội dung. Không email nên không có giờ yên lặng và không tính vào trần 6 email/ngày.
- `notificationHref`: 4 kind trên → `/giao-luu/{eventCode}?kenh={qa|nhom}#binh-luan` (`held` → `qa`, `host_post` → `nhom`); thiếu code → `/giao-luu`. `exchange_reported` với `targetType: "comment"` vẫn về `/admin/giao-luu`.
- `notifyCommentVisible(tx, input: { event: { id; publicCode; title; hostMemberId }; comment: { id; channel; parentId; authorMemberId }; parentAuthorId: number | null; replyToMemberId: number | null; groupMemberIds: number[] }, gate, now)`: gọi mỗi khi một bình luận trở thành `visible` (viết mới, sửa từ `held` về `visible`, host duyệt, admin duyệt). Gốc của người khác → `exchange_comment_new` cho host. Gốc của host ở `group` (chỉ lúc viết mới) → `exchange_comment_host_post` cho `groupMemberIds`. Trả lời → `exchange_comment_reply` cho `{parentAuthorId, replyToMemberId} \ {author}`; khu `group` chỉ giữ người trong `groupMemberIds` hoặc host.
- `notifyCommentHeld(tx, input: { event; commentId }, gate, now)`: `exchange_comment_held` cho host.
- Tác giả không nhận tin khi bình luận của mình được duyệt hay bị ẩn.

- [ ] **Step 1: Test đỏ:** `catalog: four comment kinds have vi/en/zh title and body`; `href: comment kinds open the right tab anchor`; `prefs: exchange_comments shows only when exchangeEnabled` (case cũ xanh nguyên văn); `held comment notifies only the host`; `ten questions in one hour give the host one notification`; `reply notifies parent author and reply target once each, never the writer`; `group reply never notifies someone no longer approved`; `host group post notifies approved registrants only`; `approving a held reply notifies the parent author`; `gate false writes nothing`; `payload has no name and no body`.
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/lib/notifications src/components/notifications src/i18n`).
- [ ] **Step 3: Commit** `feat(notifications): add exchange comment notifications`

### Task 5: Quyền theo khu và cookie qua Turnstile

**Files:** Create `src/lib/exchange/comment-access.ts`, `src/lib/exchange/comment-pass.ts` (đều `import "server-only"`); Modify `src/lib/user-identity.ts` (`clearUserCookie` xoá thêm `COMMENT_PASS_COOKIE`); i18n `exchange.errors.{commentsClosed, commentsLocked, cannotComment, commentNotFound, commentEditExpired, commentCapReached}`; Test `comment-access.integration.test.ts`, `comment-pass.test.ts`, case mới trong test của `user-identity`.

**Interfaces:**
- `commentTag(eventId: number): string` = `` `xcmt:e${eventId}` ``; `commentMetaTag(code: string): string` = `` `xcmeta:${code}` ``.
- `type CommentEventMeta = { id; publicCode; title; hostMemberId; hostActive: boolean; hidden: boolean; status; endAt; cancelledAt: string | null; commentsLocked: boolean }`
- `getCommentEventMetaCached(code: string): Promise<CommentEventMeta | null>`: `unstable_cache` dựng mỗi lần gọi với key `["xcmeta", code]`, `tags: ["exchange", commentMetaTag(code)]`, `revalidate: 60`. 1 truy vấn `exchange_events` join `members` theo `public_code`. Tag `"exchange"` có sẵn nên ẩn/huỷ buổi của G2b làm mới luôn.
- `commentWriteState(ev: Pick<CommentEventMeta, "commentsLocked" | "hidden" | "endAt" | "cancelledAt">, hostActive: boolean, now: Date): "open" | "locked" | "closed"`: `hidden` hoặc `!hostActive` → `closed`; `now > (cancelledAt ?? endAt) + COMMENT_OPEN_AFTER_END_DAYS` → `closed`; `commentsLocked` → `locked`; còn lại `open`.
- `type CommentContext = { event: CommentEventMeta; role: "guest" | "member" | "approved" | "host"; canRead: Record<CommentChannel, boolean>; canWrite: Record<CommentChannel, boolean>; writeState; blocked: boolean }`
- `loadCommentContext(tx: DbOrTx, by: { code: string } | { eventId: number }, viewer: { id: number } | null, now: Date, opts?: { fresh?: boolean }): Promise<CommentContext | null>`: theo `code` thì lấy meta từ `getCommentEventMetaCached`; theo `eventId` hoặc `fresh: true` (mọi action ghi) thì đọc thẳng trong `tx`. Khách: không đọc DB thêm. Đã đăng nhập: thêm 1 truy vấn đăng ký của mình và `isBlockedByHost` (host bỏ qua). Null khi không có buổi, hoặc buổi ẩn/host hết hiệu lực mà người xem không phải host và không có đăng ký. `canWrite[c] = canRead[c] && role !== "guest" && writeState === "open" && !blocked`.
- `type CommentRowLite = { id; eventId; channel: CommentChannel; parentId: number | null; authorMemberId; status: CommentStatus; pinned: boolean; createdAt: string }`
- `loadCommentInEvent(tx, commentId: number, ctx: CommentContext, viewerId: number | null, opts?: { authorAnyChannel?: boolean }): Promise<CommentRowLite | null>`: chỉ trả khi bình luận thuộc `ctx.event.id`, `ctx.canRead[channel]` (bỏ qua khi `authorAnyChannel` và người xem là tác giả, dùng cho xoá), và nếu `held` thì người xem là tác giả hoặc host.
- `loadCommentWithContext(tx, commentId, viewer, now, opts?): Promise<{ ctx: CommentContext; comment: CommentRowLite } | null>`: đọc `eventId` của bình luận, `loadCommentContext({ eventId })`, rồi `loadCommentInEvent`. Mọi action nhận `commentId` đi qua hàm này.
- `comment-pass.ts`: `COMMENT_PASS_COOKIE = "fwbb_xcp"`; `sealCommentPass(memberId: number, now: Date): string` = `` `${memberId}.${now.getTime()}.${hmacHex}` `` (HMAC-SHA256, khoá `USER_COOKIE_SECRET`, tiền tố `"exchange-comment-pass:"`, mẫu `src/lib/notifications/tokens.ts`); `openCommentPass(raw: string | undefined, memberId: number, now: Date): boolean` (sai member, sai chữ ký, quá `COMMENT_PASS_TTL_MS`, ở tương lai quá 60 giây, sai dạng, thiếu khoá → false, không ném); `hasCommentPass(memberId): Promise<boolean>`; `grantCommentPass(memberId): Promise<{ ok: true } | { ok: false }>` (bắt lỗi thiếu khoá, trả `ok: false`; cookie `httpOnly`, `sameSite: "lax"`, `secure` khi production, `path: "/"`, `maxAge` 12 giờ).

- [ ] **Step 1: Test đỏ:** `write state: hidden or inactive host closes; 7 days after end closes; cancelled counts from cancelledAt; locked only when otherwise open`; `guest reads qa, not group, writes nothing, and runs no DB query when the meta cache is warm` (spy `db.select`); `pending outsider with no registration writes qa only`; `approved registrant and host read and write both`; `pending, waitlist, cancelled registrants cannot read group`; `blocked member reads qa but cannot write`; `hidden event returns null for a stranger and a context for its registrant`; `loadCommentInEvent rejects a comment of another event, a group comment for a member, and someone else's held comment`; `author may load own group comment for delete after losing approval`; `pass: valid for the same member within 12h`; `pass: another member, expired, future, tampered, malformed, missing secret → false`; `grantCommentPass without secret returns ok false`; `clearUserCookie also deletes fwbb_xcp`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): decide comment access per channel and remember turnstile`

### Task 6: Viết, sửa, xoá bình luận (server)

**Files:** Create `src/actions/exchange-comments.ts`; Test `src/actions/exchange-comments-write.integration.test.ts`

**Interfaces:**
- `addComment(input: { code: string; channel: CommentChannel; parentId?: number; body: string; idempotencyKey: string /* uuid */; turnstileToken?: string })` → `{ success: true; data: { id: number; status: "visible" | "held" } } | { needsCaptcha: true } | { error }`. Thứ tự:
  1. `exchangeGate()` → `requireExchangeMember()` → zod (body sau `normalizeCommentBody`, 1..1000).
  2. Tra `idempotencyKey` (unique index, `author_member_id = me`): có thì trả dòng cũ, không làm gì thêm.
  3. `getCommentEventMetaCached(code)` → null thì `commentNotFound`. `isHostHere = meta.hostMemberId === member.id`.
  4. Turnstile: `hasCommentPass` → có thì bỏ qua. Không có: thiếu token → `{ needsCaptcha: true }`; có token → `checkBotAndRate({ token, action: TS_COMMENT, rateKey, limit, windowMs })` với khoá burst (hoặc khoá host khi `isHostHere`); qua thì `grantCommentPass`, `ok: false` → `{ error: t("config") }`. Có pass thì `checkRateLimit` khoá burst/host.
  5. Không phải host: `checkRateLimit("exchange-comment-day:{id}", ...)` với `RL_COMMENT_DAY_NEW` khi nick mới (`member.approvalStatus !== "approved" && (await attendanceStats(db, member.id)).checkedIn === 0`), ngược lại `RL_COMMENT_DAY`.
  6. `db.transaction`: `loadCommentContext({ code }, ..., { fresh: true })`; `!canWrite[channel]` → `commentsLocked` / `commentsClosed` / `cannotComment` (chung cho chặn và thiếu quyền). Số bình luận của khu ≥ `COMMENT_CHANNEL_CAP` → `commentCapReached`. Có `parentId`: `loadCommentInEvent`, cùng `channel`, cha `visible` (hoặc `held` khi người viết là host). Tầng của cha: `parentId = null` → gốc; cha của cha là gốc → tầng 1; còn lại tầng 2 (thêm 1 lần đọc). Cha tầng 2 → lưu dưới cha của nó. `status = held` khi `channel = qa`, không phải host, và `detectContact` có phone hoặc link. Insert. `held` → `notifyCommentHeld`; `visible` → `notifyCommentVisible`.
  7. Sau commit: `updateTag(commentTag(eventId))`.
- `editComment({ commentId; body })`: gate → quyền → zod → `checkRateLimit` khoá sửa → tx: `loadCommentWithContext(..., { fresh })`, chỉ tác giả, `visible/held`, trong `COMMENT_EDIT_WINDOW_MS`, `canWrite[channel]`. Dò lại: qa + không phải host + có sđt/link → `held` và `pinned = false` (kể cả đang `visible`; câu trả lời bên dưới vẫn hiện vì cây giữ dòng giữ chỗ); `held` hết sđt/link → `visible` và `notifyCommentVisible`. `editedAt = now`. Sang `held` thì `notifyCommentHeld`.
- `deleteComment({ commentId })`: `checkRateLimit` khoá mod → tác giả (qua `authorAnyChannel`) hoặc host của buổi; `visible/held` → `deleted`, `pinned = false`; được cả khi `locked`/`closed`. Trả lời bên dưới giữ nguyên.

- [ ] **Step 1: Test đỏ** (mọi test gửi nhiều lần dùng `vi.setSystemTime` tăng 11 giây giữa các lần, trừ test burst): `first comment without a pass asks for captcha and writes nothing`; `comment with a token grants the pass; a second comment 11 seconds later needs no token`; `failed Turnstile writes no row and no rate-limit bucket`; `missing USER_COOKIE_SECRET after Turnstile returns the config error and writes nothing`; `second comment within 10 seconds is rate limited`; `resending the same idempotencyKey within 10 seconds returns the first row, not a rate-limit error`; `host posts 3 replies in 20 seconds in their own event`; `new outsider stops at 5 a day, approved group member at 30`; `qa comment with a phone is held, the host's own is visible, a group one is visible`; `reply to a tier-2 reply is stored under its tier-1 parent with replyToMemberId`; `parentId from another event, the other channel, or someone else's held comment is rejected with no notification`; `member without group access cannot post or reply in group, also when sending channel group`; `blocked member gets the generic error and cannot edit`; `locked, hidden, 7 days after end → rejected`; `cap of 500 per channel`; `edit within 10 seconds of posting is allowed`; `edit after 10 minutes rejected; edit adding a link moves it to held and unpins it`; `edit removing the link from a held reply notifies the parent author`; `edit by someone else rejected`; `host deletes another's comment; a member cannot`; `author deletes own group comment after losing approval`; `delete keeps replies and unpins`; `flag off errors before any DB read`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): post, edit and delete exchange comments`

### Task 7: Hữu ích, ghim, khoá, duyệt (server)

**Files:** Modify `src/actions/exchange-comments.ts`; Test `src/actions/exchange-comments-moderation.integration.test.ts`

**Interfaces:**
- `toggleCommentVote({ commentId; voted: boolean })` → `{ success: true; data: { upvotes: number } } | { error }`: gate → `requireExchangeMember` → zod → `checkRateLimit("exchange-comment-vote:{id}", RL_COMMENT_VOTE.limit, RL_COMMENT_VOTE.windowMs)` → tx: `loadCommentWithContext`; bấm được khi `canRead[channel]`, `writeState !== "closed"`, `!blocked` (được khi `locked`); bình luận `visible`; không phải của mình. `voted: true` insert `onConflictDoNothing().returning()`, có dòng mới thì `UPDATE ... SET upvotes = upvotes + 1 ... RETURNING upvotes`; `false` xoá `.returning()`, xoá được thì `SET upvotes = MAX(upvotes - 1, 0)`. KHÔNG `updateTag`, không đặt cookie (để không render lại cả trang).
- `pinComment({ commentId; pinned: boolean })`: khoá mod; host; gốc `visible`; ghim thì bỏ ghim mọi bình luận khác cùng buổi cùng khu trong cùng tx.
- `setCommentsLocked({ eventId; locked: boolean })`: khoá mod; host qua `loadHostedEvent`; `updateTag(commentTag(id))` và `updateTag(commentMetaTag(publicCode))`.
- `approveHeldComment({ commentId })`: khoá mod; host; `held` → `visible`; `notifyCommentVisible`.
- Mọi hàm trừ Hữu ích: `updateTag(commentTag(eventId))` sau commit. Không nhận id người thực hiện.

- [ ] **Step 1: Test đỏ:** `vote true twice counts once; false twice never goes below 0`; `two members voting at once both count` (`Promise.all`); `cannot vote own comment, someone else's held one, a deleted one, or a group comment without access`; `vote allowed while locked, refused when closed`; `vote calls neither updateTag nor cookies().set`; `pinning a second root unpins the first in the same channel only`; `cannot pin a reply`; `non-host cannot pin, lock or approve, also with an extra actor field`; `approve turns held into visible and notifies the host for a root question`; `lock blocks addComment but allows delete`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): vote, pin, lock and approve exchange comments`

### Task 8: Đọc bình luận, đánh dấu đã đọc, số bình luận mới

**Files:**
- Create: `src/lib/exchange/comment-reads.ts` (`import "server-only"`)
- Modify: `src/actions/exchange-comments.ts`, `src/actions/exchange-mine.ts`
- Test: `src/actions/exchange-comments-read.integration.test.ts`, `src/actions/exchange-comments-exports.test.ts`, case mới trong `src/actions/exchange-mine.integration.test.ts`

**Interfaces (đều ở `comment-reads.ts`, trừ action):**
- `loadThreadRows(db: DbOrTx, eventId: number, channel: CommentChannel, sort: CommentSort, offset: number): Promise<{ rows: CommentRow[]; hasMore: boolean; total: number }>`: gốc `parent_id IS NULL` (mọi trạng thái), sắp như `buildThreads`, `LIMIT COMMENT_PAGE_ROOTS + 1 OFFSET offset`; tầng 1 của các gốc đó lấy `COMMENT_PAGE_TIER1` cái đầu mỗi gốc bằng `ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at)`; tầng 2 lấy `COMMENT_PAGE_TIER2` cái đầu mỗi tầng 1 cùng cách; `replyCount` bằng 1 truy vấn `GROUP BY parent_id` (chỉ `visible`). Tối đa 50 dòng. SQL trả `body`, `author_member_id`, tên, avatar là `NULL` khi `status IN ('held','deleted','hidden')`; `replyToName` là `NULL` khi `reply_to_member_id` trùng tác giả của `parent_id`. `total` = số `visible` của khu.
- `loadReplyRows(db, commentId: number, offset: number): Promise<{ rows: CommentRow[]; hasMore: boolean }>`: gốc → `COMMENT_REPLIES_PAGE` tầng 1 kèm tối đa 4 tầng 2 mỗi cái; tầng 1 → tối đa 50 tầng 2. Cùng luật `NULL` như trên.
- `getPublicQaPageCached(eventId, sort, offset)` = `unstable_cache(() => loadThreadRows(db, eventId, "qa", sort, offset), ["xcmt", String(eventId), "qa", sort, String(offset)], { tags: [commentTag(eventId)], revalidate: 60 })()`. Kênh luôn là `"qa"` cố định; khu `group` gọi `loadThreadRows` thẳng, không bao giờ qua cache.
- `loadViewerOverlay(db, ctx, viewerId, rows): Promise<{ myVotes: Set<number>; upvotes: Map<number, number>; heldFull: CommentRow[]; hostHeld: CommentRow[] }>` (chỉ người đã đăng nhập): phiếu của mình và `upvotes` mới nhất cho các id trên trang (1 truy vấn mỗi thứ); bản đầy đủ của các dòng `held` trên trang mà người xem là tác giả hoặc host; host ở `offset = 0` có thêm `hostHeld` = mọi `held` của khu, `LIMIT LIST_LIMIT`, mới nhất trước.
- `newCommentsSince(db, memberId, events: { id; groupAccess: boolean }[], now): Promise<[number, number][]>`: chỉ buổi có `COALESCE(cancelled_at, end_at) > now - COMMENT_COUNT_WINDOW_DAYS` (buổi khác trả 0, không truy vấn). Hai nhánh `UNION ALL`: `channel = 'qa' AND created_at > COALESCE(r.last_read_at, '')` và `channel = 'group' AND event_id IN groupIds AND created_at > COALESCE(r.last_read_group_at, '')`, đều `status = 'visible' AND author_member_id <> me`, `LEFT JOIN exchange_comment_reads r` theo (event, me), rồi `GROUP BY event_id`. `EXPLAIN QUERY PLAN` dùng index `(event_id, channel, created_at)`, không `SCAN exchange_comments`.
- Action `listExchangeComments(input: { code; channel; sort; offset /* 0..COMMENT_CHANNEL_CAP, bội số COMMENT_PAGE_ROOTS */ })` → `{ success: true; data: CommentPage } | { error }`, `type CommentPage = { channel; sort; roots: CommentView[]; hostHeld: CommentView[]; hasMore: boolean; nextOffset: number | null; total: number; writeState; role; canRead: Record<CommentChannel, boolean>; canWrite: boolean; needsCaptcha: boolean; unread: boolean; newestAt: string | null }`. `loadCommentContext({ code })` (khách không chạm DB khi cache còn). Không đọc được khu → `commentNotFound`. Đã đăng nhập: ghép overlay (thay dòng giữ chỗ `held` bằng bản đầy đủ, thay `upvotes` bằng số mới) rồi `buildThreads`. `needsCaptcha` = đã đăng nhập và `!hasCommentPass`; khách luôn `false`. `unread` = `newCommentsSince` cho đúng buổi này và đúng khu đang xem > 0 (chỉ host và người có đăng ký; người không đọc được khu Nhóm buổi không bao giờ có `unread` của khu đó). Bỏ mọi member id trước khi trả.
- Action `listCommentReplies({ commentId; offset })`: `loadCommentWithContext`, rồi `loadReplyRows` + overlay + `buildThreads`. Gốc `held` của người khác → `commentNotFound`.
- Action `markCommentsRead({ code; channel; upTo: string /* ISO */ })`: gate → `requireExchangeMember` → zod → host hoặc có đăng ký, và `canRead[channel]` (khác thì `success`, không ghi) → upsert theo unique `(event_id, member_id)`, cột của khu = `max(cột cũ, min(upTo, now))`. Không `updateTag`.
- `getMyExchanges()`: `MyRegistration` và phần tử `hosting` thêm `newComments: number` qua `newCommentsSince` (`groupAccess` = host hoặc `approved`). Type `hosting` thành `(ExchangeCard & { newComments: number })[]`.

- [ ] **Step 1: Test đỏ:** dùng mock `next/cache` có lưu theo `keyParts`, serialize JSON, và `updateTag(tag)` xoá mục có tag đó.
  - `guest gets qa only and the group channel returns commentNotFound`; `guest listing twice runs DB queries only on the first call`.
  - `the cached qa payload has null body and author for held, deleted and hidden rows and never contains a group comment` (đọc giá trị đã lưu trong mock).
  - `without updateTag a second read returns the cached page; after deleteComment it shows the placeholder` và `expect(updateTag).toHaveBeenCalledWith("xcmt:e<id>")`; `posting never calls updateTag("exchange")`.
  - `held reply under the 15th root shows on page 2 to the host and its author, as a placeholder or not at all to others`; `host gets the held queue at offset 0`.
  - `edited-to-held root keeps its replies visible to everyone`.
  - `a page never returns more than 50 comment rows; moreReplies counts the rest; listCommentReplies returns them`; `listCommentReplies on someone else's held root returns commentNotFound`.
  - `top and new sort; pinned first in both`; `a voter sees the fresh upvote count while guests may see the cached one`.
  - `payload has no member id, phone or email`; `needsCaptcha follows the pass cookie and is false for guests`.
  - `unread is false for a pending registrant when only the group channel has new comments`; `unread true only for the channel with newer comments by others`; `markCommentsRead stores min(upTo, now) per channel and never moves back`; `markCommentsRead by a stranger writes nothing`.
  - `my exchanges counts new comments per readable channel since last read; events older than 14 days count 0 without a query`; `EXPLAIN QUERY PLAN of the count has no SCAN exchange_comments`.
  - `exchange-comments exports exactly the ten listed actions; exchange-mine exports only getMyExchanges` (`Object.keys(await import(...))`).
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): list comments and count new ones since last read`

### Task 9: Báo cáo bình luận và kiểm duyệt của admin (server)

**Files:** Modify `src/actions/exchange-reports.ts`, `src/actions/exchange-admin.ts`; i18n lỗi; Test case mới trong `exchange-reports.integration.test.ts`, `exchange-admin.integration.test.ts` (thêm `testDb.delete(exchangeCommentVotes)`, `exchangeCommentReads`, `exchangeComments` vào `beforeEach` TRƯỚC dòng xoá `exchangeEvents`; không sửa expected cũ)

**Interfaces:**
- `reportAbuse` thêm target `{ type: "comment"; commentId: number }`. Trong tx: `loadCommentWithContext` (không được → `commentNotFound`); bình luận của mình → `cannotReport`; chỉ báo được bình luận `visible`. Insert như cũ (`targetType: "comment"`), giữ `notifyReported`. Sau insert, đếm báo cáo `open` của bình luận mà người báo KHÔNG phải nick mới: `members.approval_status = 'approved' OR EXISTS (đăng ký checked_in = 1)`. Đủ `COMMENT_REPORT_HIDE_THRESHOLD` và tác giả KHÔNG phải host của buổi → `UPDATE ... SET status = 'hidden', pinned = false WHERE id = ? AND status = 'visible' RETURNING id`; có dòng trả về mới `console.error("[Exchange] comment_hidden", { commentId })` và `updateTag(commentTag(eventId))`. Bình luận của host không tự ẩn, chỉ vào danh sách "Bị báo cáo" của admin.
- `AdminReportRow` thêm `commentExcerpt: string | null` (120 ký tự đầu của body, cả khi đã xoá). Với target `comment`: `targetName` = tên buổi chứa bình luận, `eventCode` = mã buổi đó, lấy bằng 1 truy vấn `inArray` comment join event (sửa nhánh rơi vào member ở `exchange-admin.ts:311-318`).
- `type AdminCommentRow = { id; eventCode; eventTitle; channel; authorName; authorIsHost: boolean; body; status: CommentStatus; openReports: number; createdAt }`
- `adminListComments(filter: "held" | "hidden" | "reported")` → tối đa `LIST_LIMIT`; `reported` = bình luận có ít nhất 1 báo cáo `open`, nhiều báo cáo trước. `openReports` bằng 1 truy vấn `GROUP BY target_id`, không N+1.
- `adminModerateComment({ commentId; action: "approve" | "unhide" | "delete" | "dismiss" })`: `approve` (`held` → `visible`, `notifyCommentVisible`); `unhide` (`hidden` → `visible`, báo cáo `open` → `dismissed`); `dismiss` (giữ nguyên bình luận, báo cáo `open` → `dismissed`); `delete` (→ `deleted`, bỏ ghim, báo cáo `open` → `resolved`). `updateTag(commentTag(eventId))`.

- [ ] **Step 1: Test đỏ:** `third report by established members hides the comment and unpins it`; `three concurrent reports hide it once` (`Promise.all`, đếm đúng 1 log `comment_hidden` và 1 lần `updateTag`); `three reports by new accounts do not hide it but list it as reported`; `the host's comment is never auto-hidden`; `same reporter twice counts once`; `cannot report own comment, someone else's held one, or a group comment without access`; `after admin unhide two new reports from different people do not hide it again; an earlier reporter cannot report again`; `admin delete resolves open reports`; `admin lists held, hidden and reported comments with counts`; `report list shows the event title, code and excerpt for a comment target`; `admin comment actions refuse a member cookie`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): report comments and moderate them as admin`

### Task 10: Khu bình luận trên trang buổi

**Files:**
- Create: `src/components/exchange/comments/{comment-section,comment-thread,comment-item,comment-composer,comment-skeleton}.tsx`
- Modify: `src/app/(exchange)/giao-luu/[code]/event-post.tsx` (thay `<div data-slot="exchange-comments" />` bằng `<CommentSection code={event.code} signedIn={viewer.role !== "guest"} />` bọc trong `id="binh-luan"`), `src/components/exchange/report-sheet.tsx` (prop tuỳ chọn `commentId?: number`: có thì gửi target `comment`, ẩn lựa chọn buổi/host)
- Test: `src/components/exchange/comments/comment-section.test.tsx`, `comment-composer.test.tsx`

**Interfaces:**
- `CommentSection`: vai trò, quyền đọc và ghi lấy từ `CommentPage` (prop chỉ là gợi ý ban đầu). `TabSegment` "Hỏi đáp" / "Nhóm buổi" (tab Nhóm buổi chỉ hiện khi `canRead.group`; vào bằng `?kenh=nhom` mà không đọc được thì chuyển về Hỏi đáp, không báo lỗi). nuqs `kenh` (`qa` | `nhom`), `bl` (`top` | `new`; mặc định `top` cho Hỏi đáp, `new` cho Nhóm buổi). `useInfiniteQuery({ queryKey: ["exchange-comments", code, channel, sort], getNextPageParam: (p) => p.nextOffset, staleTime: 60_000, refetchOnWindowFocus: true })`; ghép các trang và khử trùng theo `id`. "Xem thêm" = `fetchNextPage`; "Tải bình luận mới" = `refetch` (tải lại các trang đã mở). "Xem N trả lời" gọi `listCommentReplies` và chèn vào chủ đề. Trang đầu có `unread` thì gọi `markCommentsRead({ code, channel, upTo: newestAt })` một lần. Host thấy khối "Đang chờ duyệt (N)" từ `hostHeld` và công tắc "Khoá bình luận". Skeleton 3 thẻ đúng cỡ. Rỗng: "Chưa có câu hỏi nào. Hỏi host điều bạn cần biết." + nút mở ô viết.
- `CommentItem`: avatar, tên, nhãn "Host", "· 5 phút trước", "đã sửa"; chip `@tên` khi có `replyToName`; body chữ thuần; nhãn "Đang chờ host duyệt" (`held` của mình hoặc host xem), "[đang chờ duyệt]", "[đã xoá]", "[đã ẩn vì bị báo cáo]"; hàng nút ≥ 44px: Hữu ích (optimistic qua `fireAction(..., { retry: false })`, lấy `upvotes` server trả về, rollback + `toast.error`), Trả lời, menu "…" (Sửa, Xoá có `ConfirmDialog`, Ghim, Duyệt, Báo cáo). Tầng 1 và tầng 2 thụt lề có đường kẻ trái, tầng 2 không thụt thêm trên mobile. Ghim, xoá, duyệt, khoá optimistic qua `fireAction(..., { retry: false })`.
- `CommentComposer`: textarea tự giãn, đếm "x/1000", nút gửi dính đáy trên mobile. Gửi: thêm ngay dòng "Đang gửi…", gọi `addComment` thẳng với `idempotencyKey` sinh 1 lần cho mỗi nội dung. `needsCaptcha` (từ trang hoặc từ action) → hiện `TurnstileWidget` trên nút gửi, có token thì tự gửi lại cùng `idempotencyKey`; luôn tăng `resetKey` sau mỗi lần gửi. Lỗi → bỏ dòng tạm, giữ chữ, `toast.error` đúng thông báo server. Kết quả `held` → toast "Bình luận có số điện thoại hoặc link nên chờ host duyệt". `writeState` khác `open` hoặc khách → thay ô viết bằng dòng giải thích (khách: "Đăng nhập để bình luận" với `next` về buổi).

- [ ] **Step 1: Test đỏ:** `guest sees qa only and a login button instead of the composer`; `guest opening ?kenh=nhom lands on Hỏi đáp`; `approved registrant sees the group tab`; `body renders <script> and a link as plain text with no anchor`; `vote is optimistic, uses the server count, rolls back with a toast on error, and is not retried`; `Xem thêm keeps the first page's threads and appends the next without duplicates`; `Xem 3 trả lời loads the remaining replies into the thread`; `first send shows Turnstile, token resends with the same idempotencyKey`; `send error keeps the text and shows the server message`; `held result shows the waiting label and toast`; `locked shows the locked line, host still sees delete`; `reply to a tier-2 comment shows the @name chip, a direct reply does not`; `Tải bình luận mới refetches; no interval is set` (fake timers, không gọi lại sau 5 phút); `unread triggers markCommentsRead once with newestAt`; `report sheet with commentId sends a comment target`.
- [ ] **Step 2:** FAIL → viết → PASS (`pnpm test src/components/exchange "src/app/(exchange)" src/i18n`).
- [ ] **Step 3: Commit** `feat(exchange): add the comment section to exchange events`

### Task 11: "Giao lưu của tôi" và trang admin

**Files:**
- Modify: `src/app/(exchange)/giao-luu/cua-toi/my-exchanges.tsx` (huy hiệu "N bình luận mới" trên thẻ, link `/giao-luu/{code}#binh-luan`), `src/app/(admin)/admin/giao-luu/admin-exchange-client.tsx` (tab thứ ba "Bình luận" với `TabSegment` con "Chờ duyệt" / "Đang ẩn" / "Bị báo cáo"; thẻ có tên buổi, khu, tác giả, nhãn "Host", nội dung chữ thuần, số báo cáo; nút Duyệt / Bỏ ẩn / Bỏ qua báo cáo / Xoá optimistic qua `fireAction(..., { retry: false })`; tab Báo cáo hiện `commentExcerpt` cho báo cáo bình luận)
- Test: case mới trong `src/app/(exchange)/giao-luu/cua-toi/cua-toi.test.tsx`; test admin client hiện có (hoặc tạo `admin-exchange-client.test.tsx`)

- [ ] **Step 1: Test đỏ:** `my exchanges shows the new comment badge only when newComments > 0`; `admin comments tab lists held, hidden and reported and approves optimistically`; `admin unhide rolls back on error`; `comment report shows its excerpt and event title`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(exchange): show new comment counts and admin comment moderation`

### Task 12: Rà toàn nhánh trước e2e

**Files:** chỉ sửa lỗi review tìm ra, mỗi lỗi kèm test hồi quy.

- [ ] **Step 1:** `mobile-ui-reviewer` trên mọi `.tsx` mới/sửa (`git -C D:/Lwcifer/LW/FWBB-g2c diff --name-only 76e0174..HEAD -- "*.tsx"`). Sửa vi phạm.
- [ ] **Step 2:** Grep, mỗi lệnh phải rỗng: `grep -rn "console.log\|refetchInterval\|usePolling\|dangerouslySetInnerHTML" src/actions/exchange-comments.ts src/lib/exchange/comment-* src/components/exchange/comments`; `grep -rn 'updateTag("exchange")' src/actions/exchange-comments.ts src/lib/exchange/comment-*`; `grep -rn "financialTransactions\|sessionDebts" src/actions/exchange-comments.ts src/lib/exchange/comment-*`; `grep -nE "^export (async )?function \w+\((db|tx)\b|DbOrTx|memberId: number|eventId: number" src/actions/exchange-*.ts`; `grep -n "updateTag" src/actions/exchange-comments.ts` không có dòng nào trong `toggleCommentVote` hay `markCommentsRead`. Test khoá export của Task 8 xanh. `grep -rn "—" src/i18n/messages` chỉ còn dòng có trước nhánh.
- [ ] **Step 3: Commit** (nếu có sửa) `fix(exchange): address comment branch review findings`

### Task 13: e2e và 4 cổng

**Files:** Create `e2e/exchange-comments.spec.ts`

**Interfaces:**
- Seed theo mẫu `e2e/exchange-events.spec.ts`: libsql `file:e2e/local.db`, `PRAGMA busy_timeout = 5000`, bật `exchangeEnabled` và `notificationsEnabled`, khôi phục ở `afterAll`. Member riêng của spec (host approved, 1 tài khoản giao lưu pending, 1 member approved được duyệt vào buổi, 3 member approved khác để báo cáo), 1 buổi seed thẳng. Turnstile khoá test trong `test-env.sh`. Trước mỗi lần cùng một tài khoản gửi bình luận thứ hai trở đi, xoá `rate_limit_buckets` có khoá `exchange-comment-burst:<id>` của tài khoản đó (không chờ 10 giây). `afterAll` xoá theo thứ tự FK: `exchange_comment_votes`, `exchange_comment_reads`, `UPDATE exchange_comments SET parent_id = NULL` rồi xoá `exchange_comments` theo buổi, `abuse_reports` có `target_type = 'comment'`, `notification_deliveries` + `notifications` `kind LIKE 'exchange_%'` của member test, `rate_limit_buckets` khoá `exchange-comment-%`, rồi đăng ký, buổi, member.
- [ ] **Step 1: e2e (390px):** `exchange account asks a question after Turnstile, host replies, asker sees the nested reply and a bell notification`; `second comment in the same session shows no Turnstile`; `comment with a phone waits for the host, guest cannot see it, host approves`; `guest and pending account see no Nhóm buổi tab; approved registrant posts there`; `three reports hide a comment; admin unhides it in /admin/giao-luu`; `host locks comments and the composer is replaced by the locked line`; `deleting a comment with a reply shows [đã xoá] right after reload`; `Hữu ích keeps its count after reload`; `Giao lưu của tôi shows 1 new comment, then 0 after opening the event`.
- [ ] **Step 2:** 4 cổng + full e2e, exit từng lệnh (`cmd > .superpowers/g2c/final-<x>.log 2>&1; echo "x_exit=$?"`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/g2c/test-env.sh && pnpm build` (đọc cuối log tìm "Failed to compile"/"Type error"), `source .superpowers/g2c/test-env.sh && pnpm test:e2e`. Expected: exit 0 hết; số test ở Task 0 vẫn xanh đủ.
- [ ] **Step 3:** So `sqlite_master` của `e2e/local.db` với mốc Task 0: chỉ thêm bảng/index/cột của 0031.
- [ ] **Step 4: Commit** `test(e2e): cover exchange comments`
- [ ] **Step 5:** Cập nhật memory `project_exchange_events_nearby.md` (G2c xong ở `feat/g2c-comments`, commit cuối, ngày tuyệt đối, chưa deploy, bước kế G2d) và dòng trỏ trong `MEMORY.md`.

---

## Phạm vi để lại cho G2d

Nhãn "Mới" cạnh tên người bình luận, uy tín người bình luận, danh sách từ cấm dùng chung cho đánh giá sân (G2d dùng lại `detectContact` và thêm từ cấm). Web push cho bình luận thuộc N3.

## Quyết định của người viết plan (cần user soát)

1. Bình luận chỉ báo trên chuông trong app, không gửi email. Vì vậy không có email lúc nửa đêm, và bình luận không chiếm suất 6 email mỗi ngày của tin khác.
2. Mọi tin bình luận đều tắt được. Chúng nằm trong nhóm mới "Bình luận giao lưu" ở cài đặt thông báo, tách khỏi nhóm "Giao lưu", để người dùng tắt bớt bình luận mà vẫn nhận tin đăng ký và tiền.
3. Host nhận tin khi có bình luận mới mở đầu một chủ đề (không tính trả lời), ở cả hai khu. Mỗi buổi host nhận tối đa 1 tin như vậy mỗi giờ, dù có bao nhiêu câu hỏi.
4. Ai có bình luận được trả lời, hoặc được gắn "@tên", thì nhận tin "có người trả lời bạn", tối đa 1 tin mỗi giờ mỗi buổi. Người tự trả lời mình thì không nhận.
5. Khi host đăng một bình luận mới ở khu Nhóm buổi, mọi người đã được duyệt nhận tin, vì khu này hay dùng để báo đổi sân, đổi giờ, đi chung xe. Bình luận của người khác ở Nhóm buổi không báo cho cả nhóm, để nó không thành chat.
6. Host nhận tin khi có bình luận đang chờ duyệt, tối đa 1 tin mỗi giờ mỗi buổi. Admin không nhận tin này mà xem ở trang admin.
7. Khi một bình luận chờ duyệt được host hay admin duyệt, những người liên quan nhận tin như thể bình luận vừa được đăng (host nhận tin câu hỏi mới, người được trả lời nhận tin trả lời). Riêng người viết không nhận tin khi bình luận của mình được duyệt hay bị ẩn, vì họ thấy trạng thái ngay trên bình luận.
8. Người "được duyệt" để vào khu Nhóm buổi là host và người có đăng ký đang ở trạng thái đã duyệt. Người đang chờ duyệt, ở danh sách chờ, đã huỷ, bị từ chối hay không đến đều không đọc được khu này. Ai mất trạng thái đã duyệt thì mất quyền đọc ngay, nhưng vẫn tự xoá được bình luận cũ của mình ở đó.
9. Turnstile chỉ hỏi ở bình luận đầu tiên. Qua được một lần thì trình duyệt nhớ trong 12 giờ bằng một cookie có ký, gắn với đúng tài khoản. Đổi tài khoản, đăng xuất rồi đăng nhập lại, hay quá 12 giờ thì phải qua lại. Cách này không ghi gì vào DB.
10. Bấm "Hữu ích", sửa, xoá, ghim, khoá, duyệt không hỏi Turnstile. Spec 4.6c ghi Turnstile ở mọi thao tác ghi, nhưng spec 4.6f riêng cho bình luận chỉ đòi ở bình luận đầu tiên, nên plan theo 4.6f. Các thao tác này đều có giới hạn tần suất riêng.
11. Giới hạn tần suất: mỗi người 1 bình luận mới mỗi 10 giây và 30 bình luận mỗi ngày. Tài khoản giao lưu chưa được điểm danh buổi nào chỉ được 5 bình luận mỗi ngày. Thành viên đã duyệt của nhóm không bị coi là nick mới (giống quyết định 14 của G2b).
12. Host trả lời trong buổi của chính mình được tới 20 bình luận mỗi phút và không bị giới hạn theo ngày, để host trả lời liền nhiều câu hỏi được.
13. Sửa bình luận có giới hạn riêng 10 lần mỗi phút, nên vừa đăng xong thấy lỗi chính tả thì sửa ngay được. "Hữu ích" tối đa 60 lần mỗi giờ. Xoá, ghim, khoá, duyệt chung giới hạn 60 lần mỗi giờ.
14. Bấm gửi lại cùng một bình luận (mạng chập chờn, bấm hai lần) luôn trả về bình luận đã lưu, không bị báo quá tần suất và không tạo bình luận thứ hai. Bảng bình luận có thêm cột mã chống gửi trùng cho việc này, ngoài các cột spec liệt kê.
15. Một bình luận ở khu Hỏi đáp bị giữ lại chờ duyệt khi có số điện thoại Việt Nam (kể cả viết cách, có dấu chấm, có +84) hoặc có link (http, www, tên miền phổ biến, zalo.me, fb.com, t.me). App bỏ qua ngày, giờ và số tiền trước khi dò số điện thoại, nên "09.11.2026 19:30" hay "120.000" không bị giữ.
16. Bình luận của chính host không bao giờ bị giữ lại, vì host được phép đưa số liên hệ của mình. Khu Nhóm buổi cũng không giữ lại, đúng như spec.
17. Host duyệt bình luận chờ ngay trên trang buổi, ở khối "Đang chờ duyệt" đầu khu bình luận. Admin duyệt ở tab mới "Bình luận" trong trang admin giao lưu. Người viết thấy bình luận của mình kèm nhãn "Đang chờ host duyệt". Người khác không thấy nội dung; nếu bình luận đó đã có câu trả lời thì họ chỉ thấy dòng "[đang chờ duyệt]" để luồng trả lời không gãy.
18. Sửa một bình luận để thêm số điện thoại hay link thì nó quay về hàng chờ duyệt và bị bỏ ghim, còn các câu trả lời bên dưới vẫn hiện. Sửa bỏ hết số và link thì nó hiện lại.
19. Đủ 3 báo cáo thì bình luận tự ẩn và bị bỏ ghim. Chỉ báo cáo của thành viên đã duyệt hoặc người đã từng được điểm danh mới được đếm vào ngưỡng này. Báo cáo của nick mới vẫn được lưu để admin xem, nhưng 3 nick mới không làm ẩn được bình luận của ai.
20. Bình luận của host không bao giờ tự ẩn vì báo cáo, mà chỉ vào danh sách "Bị báo cáo" để admin quyết định. Lý do là một nhóm người có thể báo cáo để ẩn thông báo đổi sân của host.
21. Chỉ admin bỏ ẩn được bình luận (host thì không). Khi admin bỏ ẩn, các báo cáo cũ được đóng lại, nên phải có thêm 3 báo cáo từ 3 người CHƯA từng báo bình luận đó thì mới ẩn lần nữa. Người đã báo một lần không báo lại được.
22. Báo cáo bình luận dùng chung form báo cáo có sẵn, có Turnstile như G2b. Không tự báo cáo bình luận của mình được, và chỉ báo cáo được bình luận đang hiện.
23. Trả lời lồng tối đa 2 tầng. Trả lời một bình luận ở tầng 2 thì bình luận mới nằm cùng tầng 2 và có chip "@tên" ở đầu, giống Reddit trên điện thoại. Trả lời thẳng vào bình luận cha thì không có chip. Tên trong chip lấy theo hồ sơ hiện tại.
24. Mỗi lần tải hiện 10 chủ đề, mỗi chủ đề kèm 2 câu trả lời đầu và 1 câu trả lời con đầu của mỗi câu đó, tối đa 50 bình luận, đúng trần 50 dòng của spec 4.6e. Phần còn lại mở bằng nút "Xem N trả lời". Nút "Xem thêm" nối thêm chủ đề vào cuối, không thay danh sách cũ.
25. Mỗi khu của một buổi nhận tối đa 500 bình luận, để một buổi bị spam không làm tốn quota.
26. Mặc định khu Hỏi đáp sắp theo "Hữu ích", khu Nhóm buổi sắp theo "Mới nhất". Bình luận được ghim luôn ở đầu. Câu trả lời luôn xếp cũ trước, mới sau.
27. Host ghim được 1 bình luận mở đầu chủ đề cho mỗi khu (không ghim câu trả lời). Ghim cái mới thì cái cũ tự bỏ ghim.
28. Khách chưa đăng nhập đọc khu Hỏi đáp hoàn toàn qua bộ nhớ đệm 60 giây, nên mở trang nhiều lần không tốn lượt đọc DB. Mỗi lần có người viết, sửa, xoá, duyệt hay ẩn, bộ nhớ đệm của riêng buổi đó được làm mới ngay. Bộ nhớ đệm của trang tìm buổi không bị ảnh hưởng. Khu Nhóm buổi ít người đọc nên đọc thẳng.
29. Bấm "Hữu ích" không làm mới bộ nhớ đệm, vì làm mới sẽ khiến cả trang buổi tải lại và tốn khoảng 10 lượt đọc DB cho mỗi lần bấm. Người đã đăng nhập luôn thấy số "Hữu ích" mới nhất; khách có thể thấy số cũ tối đa 60 giây.
30. Không tự làm mới theo giờ. Bình luận tải khi mở trang, khi quay lại tab (nếu đã quá 60 giây), và khi bấm "Tải bình luận mới".
31. Khi host khoá khu bình luận, không ai viết, trả lời hay sửa được. "Hữu ích", báo cáo, xoá, ghim và duyệt vẫn dùng được.
32. Buổi bị admin ẩn, hoặc host bị khoá tài khoản, thì khu bình luận chỉ còn đọc. Buổi đã xong hoặc bị huỷ vẫn bình luận được thêm 7 ngày (tính từ giờ kết thúc hoặc giờ huỷ), để mọi người hỏi chuyện hoàn cọc, đồ để quên. Sau đó khu bình luận chỉ còn đọc.
33. Người bị host chặn vẫn đọc được khu Hỏi đáp nhưng không viết, sửa, trả lời hay bấm "Hữu ích" ở mọi buổi của host đó. Họ chỉ thấy lỗi chung "không bình luận được ở buổi này", không biết là bị chặn.
34. Xoá là xoá mềm: chỗ đó hiện "[đã xoá]" nếu còn câu trả lời bên dưới, còn không có trả lời thì ẩn hẳn. Nội dung vẫn giữ trong DB để admin xử lý báo cáo, nhưng không bao giờ gửi ra trang và không nằm trong bộ nhớ đệm. Host xoá được mọi bình luận trong buổi của mình, admin xoá được tất cả.
35. Không tự bấm "Hữu ích" cho bình luận của mình được. Mỗi người chỉ có 1 lượt cho mỗi bình luận, bấm lại thì bỏ.
36. Tên và ảnh đại diện của người viết ở khu Hỏi đáp hiện công khai cho cả khách chưa đăng nhập, vì đó là chỗ họ tự chọn đăng công khai. Trang không ghi ai đã đăng ký buổi, chỉ có nhãn "Host" cho host. Số điện thoại và email không bao giờ có trong dữ liệu gửi ra.
37. "Giao lưu của tôi" hiện số bình luận mới của người khác kể từ lần cuối mình xem. App nhớ riêng cho từng khu, nên xem Hỏi đáp không xoá số mới của Nhóm buổi. Chỉ đếm khu mình đọc được, và chỉ đếm cho buổi kết thúc hoặc bị huỷ trong 14 ngày gần đây (buổi cũ hơn luôn là 0) để không tốn lượt đọc DB.
38. Khi admin gộp hai tài khoản, bình luận, lượt "Hữu ích" và mốc đã đọc của tài khoản cũ chuyển sang tài khoản giữ lại. Lượt "Hữu ích" trùng, hay thành tự bấm cho mình sau khi gộp, thì bị bỏ và số đếm được trừ đúng. Xoá hẳn một member từng bình luận hay bấm "Hữu ích" thì bị chặn như khi có dữ liệu giao lưu khác, và admin dùng "Vô hiệu hoá" thay thế.
39. Khi cờ giao lưu tắt, mọi thao tác bình luận báo "không tìm thấy" trước khi đọc DB, trang buổi và trang admin vẫn trả 404 như G2b, và nhóm "Bình luận giao lưu" không hiện trong cài đặt thông báo.
40. e2e phủ 9 tình huống: hỏi và được trả lời kèm thông báo, Turnstile chỉ hỏi lần đầu, bình luận có số điện thoại chờ duyệt, quyền vào khu Nhóm buổi, 3 báo cáo làm ẩn và admin bỏ ẩn, host khoá bình luận, xoá rồi tải lại thấy "[đã xoá]", "Hữu ích" giữ số sau khi tải lại, và số bình luận mới ở "Giao lưu của tôi".

## Plan review response

| Finding | Kết quả | Ghi chú |
|---|---|---|
| C1 | accepted | Đã kiểm `exchange-mine.ts:1` là `"use server"`. Mọi hàm đọc/đếm ở `comment-reads.ts` (server-only); Global Constraints liệt kê đúng export cho phép; test khoá `Object.keys` ở Task 8; grep mới ở Task 12 |
| I1 | accepted | Tra `idempotencyKey` đứng trước Turnstile và rate limit; sửa dùng khoá riêng 10/phút; host trong buổi mình dùng khoá 20/phút, không giới hạn ngày (quyết định 12, 13, 14) |
| I2 | accepted | Integration test tăng 11 giây bằng `vi.setSystemTime`; e2e xoá bucket burst trước lần gửi thứ hai |
| I3 | accepted | Đã kiểm `revalidate.js:59-61` và docs mục cookie. Chọn (a): Hữu ích và đánh dấu đã đọc không `updateTag`, không đặt cookie; overlay trả số Hữu ích mới cho người đăng nhập; test "vote calls neither updateTag nor cookies().set" (quyết định 29) |
| I4 | accepted | `getCommentEventMetaCached` (tag `"exchange"` + `xcmeta:{code}`) thay vì sửa whitelist `PublicExchangeEvent` của G2b; khoá bình luận làm mới tag meta; test khách không chạm DB khi cache còn |
| I5 | accepted | Chỉ đếm buổi trong 14 ngày, 2 nhánh `UNION ALL` có `channel =` để dùng index, thêm index `(event_id, created_at)`; test `EXPLAIN QUERY PLAN` |
| I6 | accepted | Thêm cột `last_read_group_at` (bảng mới của chính G2c, vẫn chỉ thêm); `unread` và đếm dùng chung `newCommentsSince`, chỉ trên khu đọc được; test người `pending` |
| I7 | accepted | `loadCommentInEvent` chỉ trả `held` cho tác giả và host; trả lời đòi cha `visible`; test trả lời, báo cáo, Hữu ích, xem trả lời vào `held` của người khác |
| I8 | accepted | Cache lấy cả `held` dưới dạng dòng giữ chỗ (nội dung NULL), cây giữ khi có trả lời; chuyển `held` thì bỏ ghim; test ở Task 6 và 8 |
| I9 | accepted | `held` nằm đúng trang theo cây (giữ chỗ trong cache, overlay thay bản đầy đủ cho tác giả/host); host có khối "Đang chờ duyệt" `LIMIT LIST_LIMIT`; test trang 2 |
| I10 | accepted | `useInfiniteQuery`, `nextOffset`, khử trùng theo `id`; test "Xem thêm" giữ trang 1 |
| I11 | accepted | Giảm còn 10 chủ đề, 2 tầng 1 và 1 tầng 2 mỗi cái (tối đa 50 dòng), `moreReplies` + action `listCommentReplies` |
| I12 | accepted | Đã thử regex đề xuất: vẫn khớp "09.11.2026 19" (0 rồi 9 chữ số cách 1 ký tự). Thay bằng che ngày, giờ, tiền trước rồi mới dò số; thêm các ví dụ của review vào test |
| I13 | accepted | `loadThreadRows(db, eventId, channel, ...)` + `getPublicQaPageCached` cố định `"qa"`, key cache có `"qa"` |
| I14 | accepted | `notifyCommentVisible` gọi ở cả 3 đường duyệt (host, admin, sửa bỏ link); test duyệt trả lời báo tác giả cha |
| I15 | accepted | Chỉ đếm báo cáo của người không phải nick mới; bình luận host không tự ẩn, vào lọc "Bị báo cáo" của admin (quyết định 19, 20) |
| I16 | accepted | Mock `unstable_cache` lưu theo key và `updateTag` xoá theo tag; bước ẩn `RETURNING id`, test đếm đúng 1 log và 1 `updateTag` |
| M1 | accepted | Ghi đúng chữ ký `checkRateLimit(key, limit, windowMs)` và `checkBotAndRate({ token, ... })` ở Global Constraints và Task 6, 7 |
| M2 | accepted | `grantCommentPass` trả `ok: false`, action trả lỗi cấu hình, không ghi; khách luôn `needsCaptcha: false` |
| M3 | accepted | `clearUserCookie` (`user-identity.ts:116`) xoá thêm `fwbb_xcp`; test; quyết định 9 |
| M4 | accepted | Cộng trừ bằng SQL `upvotes + 1` / `MAX(upvotes - 1, 0)` sau insert/delete có `returning`; client `fireAction(..., { retry: false })` |
| M5 | accepted | `editComment` dùng `canWrite[channel]`; xoá của tác giả bỏ qua quyền đọc khu (`authorAnyChannel`) |
| M6 | accepted | Thêm khoá `exchange-comment-mod` 60/giờ cho xoá, ghim, khoá, duyệt |
| M7 | accepted | Dùng `approvalStatus` + `attendanceStats` thay `newAccountLimits` |
| M8 | accepted | Target `comment` lấy tên và mã buổi chứa bình luận bằng 1 truy vấn `inArray`; `openReports` bằng `GROUP BY` |
| M9 | accepted | Quyết định 21 và test "an earlier reporter cannot report again" |
| M10 | accepted | Đã kiểm `exchange-admin.integration.test.ts:102-106`; Task 9 thêm dòng dọn 3 bảng mới trước `exchangeEvents`, không sửa expected |
| M11 | accepted | `markCommentsRead` nhận `upTo`, lưu `max(cũ, min(upTo, now))` theo khu |
| M12 | accepted | Vai trò lấy từ `CommentPage`; prop chỉ `signedIn`; khách vào `?kenh=nhom` chuyển về Hỏi đáp |
| M13 | partly | Chip chỉ hiện khi người được trả lời khác tác giả cha (SQL trả `replyToName` NULL khi trùng). Không ẩn chip theo trạng thái bình luận được trả lời: bảng không lưu id bình luận đó, và tên người viết đã công khai lúc bình luận còn hiện; việc ẩn là ẩn nội dung |
| M14 | partly | Thêm test tự bấm theo cả hai chiều. Giữ chặn xoá cứng khi chỉ có phiếu hay mốc đọc: memory `project_member_hard_delete_blocked_by_money` ghi chặn xoá là đúng thiết kế, dùng "Vô hiệu hoá" (quyết định 38) |
| M15 | accepted | Thêm e2e "xoá rồi tải lại thấy [đã xoá]" và "Hữu ích giữ số sau khi tải lại" |
| M16 | accepted | SQL trả `body`, tác giả `NULL` cho `held/deleted/hidden`, nên cache không giữ nội dung đã xoá |
