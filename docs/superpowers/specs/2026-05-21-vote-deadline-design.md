# Vote deadline — design

**Date**: 2026-05-21
**Status**: Approved, ready to implement.

## Goal

Mỗi session có một **deadline để vote**: sau thời điểm đó, members không thể submit hoặc edit vote nữa. Mục đích: cho admin một mốc rõ ràng để chốt danh sách + tính cost mà không bị member vote-late làm xáo trộn. Default deadline là **4h trước giờ chơi**; admin có thể override hoặc mở lại bất cứ lúc nào.

Feature là OPT-IN có default: cứ tạo session mới (manual hoặc cron) là tự fill deadline `= startTime − 4h`. Admin có thể bỏ deadline (NULL) nếu muốn vote không giới hạn.

## Behaviour

Khi member submit/edit vote qua `submitVote`:

1. Load session.
2. Helper `isVoteOpen(session)` check:
   - Nếu `status` không phải `voting` hoặc `confirmed` → reject với reason `"status"` (giống behavior hiện tại).
   - Nếu `voteDeadline` không NULL và `now >= voteDeadline` → reject với reason `"deadline"`.
   - Else → pass.
3. Reject case `"deadline"` trả về error key `voteDeadlinePassed` (i18n vi/en/zh).

Khi admin set/edit deadline qua `setVoteDeadline` hoặc `extendVoteDeadline`:

- `setVoteDeadline(sessionId, deadlineIso | null)`: set deadline cụ thể hoặc clear (set NULL = vote không giới hạn). Validate `deadlineIso > now` (trừ khi clear).
- `extendVoteDeadline(sessionId, hours: 2 | 24)`: quick button cho admin → `deadline = max(now, currentDeadline) + hours`. Hữu ích khi deadline đã qua (max ensures push từ now, không từ quá khứ).

Khi UI render countdown:

- `<VoteCountdown>` client component dùng `setInterval(1000)` update remaining ms.
- Format theo magnitude: `>24h` → "còn 2 ngày 3h", `1h–24h` → "còn 3h 24p", `<1h` → "còn 24p 13s" (đỏ + pulse animation).
- Khi reach 0: hiện badge "Đã đóng vote", stop interval, fire `onExpired` callback để parent re-render disabled state.
- Cleanup interval khi unmount hoặc khi đã reach deadline.

## Data model

**1. Cột mới trên `sessions`**:

```ts
voteDeadline: text("vote_deadline"), // nullable
```

NULL = không có deadline (vote luôn mở cho đến khi admin chuyển status). Mặc định khi tạo session = `date + startTime − 4h`.

**Format**: `YYYY-MM-DDTHH:MM:SS` (ISO 8601 không có Z suffix, interpreted as Vietnam local time — giống convention của `startTime` và `date`). `new Date(deadlineStr)` parse consistent across browsers/Node là local time. Tránh ISO-with-Z để không phải convert TZ giữa client (browser local) và server (cron).

**2. Migration `0012_vote_deadline.sql`**:

```sql
ALTER TABLE sessions ADD vote_deadline text;
--> statement-breakpoint
-- Backfill existing sessions còn hoạt động. Sessions đã completed/cancelled
-- giữ NULL — voting đã bị block bởi status, không cần deadline.
-- `strftime` ép format ISO-without-Z; SQLite datetime modifier '-4 hours'
-- trừ trực tiếp lên local time string (đúng interpretation Vietnam zone).
UPDATE sessions
   SET vote_deadline = strftime('%Y-%m-%dT%H:%M:%S', date || ' ' || start_time, '-4 hours')
 WHERE status IN ('voting', 'confirmed') AND vote_deadline IS NULL;
```

App-side construction (TS): `\`${date}T${startTime}:00\`` rồi parse + subtract 4h:

```ts
const startLocal = new Date(`${session.date}T${session.startTime}:00`);
const deadlineLocal = new Date(startLocal.getTime() - 4 * 60 * 60 * 1000);
const voteDeadline = `${deadlineLocal.getFullYear()}-${String(deadlineLocal.getMonth() + 1).padStart(2, "0")}-${String(deadlineLocal.getDate()).padStart(2, "0")}T${String(deadlineLocal.getHours()).padStart(2, "0")}:${String(deadlineLocal.getMinutes()).padStart(2, "0")}:00`;
```

(Helper `formatLocalDeadline(start: Date): string` extract vào `src/lib/vote-deadline.ts` để DRY).

Lưu ý: sessions `voting` mà startTime đã qua trong quá khứ sẽ có deadline trong quá khứ → tự động "đã đóng vote" sau migration. Admin phải explicit extend nếu muốn mở lại. Đây là behavior đúng — không silently mở lại các session zombie.

## Components & call sites

**`src/lib/session-status.ts`** — extend với `isVoteOpen()`:

```ts
export function isVoteOpen(session: {
  status: SessionStatus;
  voteDeadline: string | null;
}): { open: true } | { open: false; reason: "status" | "deadline" } {
  /* ... */
}
```

**`src/actions/votes.ts`** — `submitVote` thay block `status` check bằng `isVoteOpen()`. Map reason → translation key.

**`src/actions/sessions.ts`** — thêm 2 action mới, cả hai admin-only:

- `setVoteDeadline(sessionId, deadlineIso: string | null)`
- `extendVoteDeadline(sessionId, hours: 2 | 24)`

**`src/actions/sessions.ts createSessionManually + cron `/api/cron/create-session`** — set `voteDeadline` lúc insert.

**`src/components/sessions/vote-countdown.tsx`** (mới) — client component, 2 variants:

- `variant="banner"`: glass card sticky top, dùng cho `/vote/[id]`. Pulse + destructive color khi `<1h`.
- `variant="inline"`: 1 dòng `text-sm`, không animation. Dùng cho home session card + admin list.

**`src/app/(public)/vote/[id]/page.tsx`** — chèn `<VoteCountdown variant="banner">` phía trên panel.

**`src/app/(public)/page.tsx`** (home) — chèn `<VoteCountdown variant="inline">` vào session card.

**`src/app/(admin)/admin/sessions/session-list.tsx`** — cột "Deadline" với countdown + popover edit:

- Date+time picker (HTML `<input type="datetime-local">`)
- Quick buttons "+2h", "+24h"
- "Bỏ deadline" (set NULL)
- Tất cả buttons `min-h-11` per AGENTS.md mobile rule.

**i18n keys mới** (vi/en/zh trong `src/i18n/messages/*.json`):

- `voteDeadlinePassed`: "Đã hết hạn vote cho buổi này" / "Voting closed for this session" / "投票已结束"
- `voteDeadlineHint`: "Vote sẽ đóng lúc {time}" / "Voting closes at {time}" / "投票将于 {time} 结束"
- `voteCountdownDays`: "{days}n {hours}h" / "{days}d {hours}h" / "{days}天{hours}小时"
- `voteCountdownHours`: "{hours}h {minutes}p" / "{hours}h {minutes}m" / "{hours}小时{minutes}分"
- `voteCountdownMinutes`: "{minutes}p {seconds}s" / "{minutes}m {seconds}s" / "{minutes}分{seconds}秒"
- `voteClosedLabel`: "Đã đóng vote" / "Voting closed" / "投票已结束"
- `voteDeadlineSet`: "Set deadline" / "Set deadline" / "设置截止"
- `voteDeadlineClear`: "Bỏ deadline" / "Clear deadline" / "清除截止"
- `voteDeadlineExtend2h`: "+2 giờ" / "+2 hours" / "+2小时"
- `voteDeadlineExtend24h`: "+24 giờ" / "+24 hours" / "+24小时"

## Edge cases

**Vote in-flight khi deadline qua:**
User mở vote page lúc 16:59, deadline 17:00, click vote lúc 17:00:01. Server check `isVoteOpen` tại thời điểm action chạy → reject với `voteDeadlinePassed`. Client optimistic update rollback + toast error. Frontend cũng disable button khi countdown reach 0 (defense-in-depth, server vẫn là source of truth).

**Admin extend deadline khi đã hết hạn:**
Member đang xem page với "Đã đóng vote" badge. Admin click "+2h" → server update deadline = now+2h, revalidatePath. Member's page re-renders với deadline mới, countdown resume, vote buttons enabled lại. Không cần WebSocket — TanStack Query refresh hoặc polling đã cover.

**Clock skew client vs server:**
Countdown chạy theo client clock. Edge case: client clock chậm 30s → user thấy còn 30s nhưng server đã reject. Acceptable: server là source of truth, error message rõ ràng. Không sync clock (over-engineering).

**Session bị cancel/complete trước deadline:**
`isVoteOpen` check status TRƯỚC deadline → return `reason: "status"` ngay, không show countdown trên session cancelled/completed.

**Backfill sessions cũ trong production:**
Migration UPDATE chỉ chạy cho rows `status IN ('voting', 'confirmed')`. Sessions đã `completed`/`cancelled` giữ `voteDeadline = NULL` (vô hại — vote đã bị block bởi status). Sessions `voting` mà startTime đã qua trong quá khứ sẽ tự động "đã đóng vote" — đúng behavior, admin phải explicit mở lại nếu muốn.

**Member edit vote sau deadline:**
Per câu hỏi #1 brainstorming → hard lock. Cả vote mới lẫn edit vote đều bị reject. Vote cũ giữ nguyên. Admin có thể edit vote thủ công qua admin panel (`adminSetVote` đã có và độc lập với deadline).

## Out of scope (YAGNI)

- Telegram/Messenger notification trước deadline (skip per câu hỏi countdown placement).
- Global setting cho default offset (hardcode 4h trong helper, refactor sau khi cần).
- Per-member notification preference.
- Auto-transition status sang `confirmed` khi deadline qua (deadline và status orthogonal).
- WebSocket push deadline update real-time (revalidatePath + polling đủ).

## Testing

**Unit tests** (`src/lib/session-status.test.ts`):

- `isVoteOpen({status: "voting", voteDeadline: futureIso})` → `{open: true}`
- `isVoteOpen({status: "voting", voteDeadline: pastIso})` → `{open: false, reason: "deadline"}`
- `isVoteOpen({status: "voting", voteDeadline: null})` → `{open: true}`
- `isVoteOpen({status: "completed", voteDeadline: futureIso})` → `{open: false, reason: "status"}`
- `isVoteOpen({status: "cancelled", voteDeadline: null})` → `{open: false, reason: "status"}`

**Integration tests** (`src/actions/votes-deadline.integration.test.ts`, mới):

- `submitVote` reject với `voteDeadlinePassed` khi `now > voteDeadline`.
- `setVoteDeadline` requires admin, validates `> now` (trừ NULL).
- `extendVoteDeadline(2)` khi deadline đã quá khứ → deadline mới = now + 2h (không phải past + 2h).
- `extendVoteDeadline(24)` khi deadline còn 1h tương lai → deadline mới = currentDeadline + 24h.

**Manual smoke** trên `pnpm dev`:

- Tạo session, verify deadline tự fill = startTime − 4h.
- Vote trước deadline OK; sửa thời gian system clock (hoặc seed deadline past) → vote reject.
- Admin extend +2h, member F5 → vote OK lại.
- Admin clear deadline, vote không bị block.
- Countdown UI: format đúng, đỏ + pulse <1h, "Đã đóng" sau 0.

## Implementation order

1. **Schema + migration**: thêm column, write `0012_vote_deadline.sql`, update journal, update `schema.ts`.
2. **Helper + types**: `isVoteOpen()` trong `session-status.ts`, write unit tests.
3. **Server actions**: `submitVote` thay check, thêm `setVoteDeadline` + `extendVoteDeadline`, integration tests.
4. **Call sites set default**: `createSessionManually`, `/api/cron/create-session`.
5. **i18n keys**: vi/en/zh.
6. **Component**: `vote-countdown.tsx` (banner + inline variants).
7. **Wire UI**: vote page banner, home card inline, admin list cột + popover edit.
8. **End-to-end manual smoke**.
