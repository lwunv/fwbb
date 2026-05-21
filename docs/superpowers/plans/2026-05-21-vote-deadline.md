# Vote Deadline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-session vote deadline (default = `startTime − 4h`) that hard-locks `submitVote` after expiry, with admin override / extend / reopen and a live countdown UI on the vote page, home card, and admin session list.

**Architecture:** One nullable `vote_deadline` text column on `sessions` storing ISO-local-time (`YYYY-MM-DDTHH:MM:SS`, Vietnam zone interpretation, no Z suffix). All four session-creation paths backfill the default at insert. A single helper `isVoteOpen()` extends the existing status gate in `src/lib/session-status.ts` and is the only thing `submitVote` checks. Two admin actions — `setVoteDeadline` and `extendVoteDeadline` — handle override + quick-extend. One client component `<VoteCountdown>` with `banner` / `inline` variants renders on three pages.

**Tech Stack:** Next.js 16 (App Router) + React 19, Drizzle ORM + Turso (SQLite), Vitest (integration via in-process libSQL `:memory:`-on-disk via `createTestDb()`), next-intl, framer-motion, Tailwind CSS v4, Shadcn UI.

**Spec:** `docs/superpowers/specs/2026-05-21-vote-deadline-design.md`.

---

## File Structure

**Create:**

- `src/db/migrations/0012_vote_deadline.sql` — schema migration + backfill
- `src/lib/vote-deadline.ts` — date helpers (`computeDefaultDeadline`, `formatLocalDeadline`)
- `src/lib/vote-deadline.test.ts` — unit tests for the date helpers
- `src/lib/session-status.test.ts` — unit tests for `isVoteOpen` (file doesn't exist yet)
- `src/components/sessions/vote-countdown.tsx` — client countdown component
- `src/components/sessions/vote-deadline-edit.tsx` — admin popover (date+time picker + quick buttons + clear)
- `src/actions/vote-deadline.integration.test.ts` — integration tests for `setVoteDeadline`, `extendVoteDeadline`, `submitVote` deadline reject

**Modify:**

- `src/db/schema.ts` — add `voteDeadline` column to `sessions` + types
- `src/db/migrations/meta/_journal.json` — append 0012 entry
- `src/lib/session-status.ts` — add `isVoteOpen()` helper
- `src/actions/votes.ts` — `submitVote` uses `isVoteOpen`
- `src/actions/sessions.ts` — add `setVoteDeadline` + `extendVoteDeadline`; set default deadline in `createSessionManually`, `getNextSession`, `getAdminUpcomingSession`; clear deadline in `reopenSession` + `unlockSession`
- `src/app/api/cron/create-session/route.ts` — set default deadline on cron-created sessions
- `src/app/(public)/vote/[id]/page.tsx` — render `<VoteCountdown variant="banner">`
- `src/app/(public)/page.tsx` — render `<VoteCountdown variant="inline">` in session card
- `src/app/(admin)/admin/sessions/session-list.tsx` — Deadline column + edit popover
- `src/i18n/messages/vi.json`, `en.json`, `zh.json` — 10 new keys

---

## Task 1: Schema + migration

**Files:**

- Create: `src/db/migrations/0012_vote_deadline.sql`
- Modify: `src/db/schema.ts` (sessions table block)
- Modify: `src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add column to schema**

Edit [src/db/schema.ts](src/db/schema.ts) inside the `sessions` table definition (after `passRevenue: integer("pass_revenue")`, before `notes: text("notes")`):

```ts
    /**
     * Per-session vote deadline. NULL = no deadline (vote always open until
     * status changes). Default-filled at session creation as
     * `${date}T${startTime}:00` minus 4 hours. Format: ISO 8601 without `Z`
     * suffix, interpreted as Vietnam local time (matches `date` / `startTime`
     * convention). See docs/superpowers/specs/2026-05-21-vote-deadline-design.md.
     */
    voteDeadline: text("vote_deadline"),
```

- [ ] **Step 2: Write migration SQL**

Create `src/db/migrations/0012_vote_deadline.sql`:

```sql
-- Per-session vote deadline. NULL = no deadline (vote always open until
-- admin changes status). At session creation, app code default-fills
-- `${date}T${startTime}:00` − 4 hours.
--
-- Format: ISO 8601 without Z suffix (Vietnam local time interpretation,
-- matching `date` and `start_time` conventions). `strftime` here produces
-- exactly that format.

ALTER TABLE `sessions` ADD `vote_deadline` text;
--> statement-breakpoint

-- Backfill existing sessions that are still accepting votes. Completed /
-- cancelled sessions stay NULL — voting is already blocked by status.
-- Sessions whose start_time is already in the past will get a past
-- deadline → they auto-show as "vote closed" until admin extends, which is
-- the intended behaviour (don't silently reopen zombie sessions).
UPDATE `sessions`
   SET `vote_deadline` = strftime('%Y-%m-%dT%H:%M:%S', date || ' ' || start_time, '-4 hours')
 WHERE status IN ('voting', 'confirmed') AND vote_deadline IS NULL;
```

- [ ] **Step 3: Append journal entry**

Edit [src/db/migrations/meta/\_journal.json](src/db/migrations/meta/_journal.json) — add inside `"entries"` array after the `0011_fk_retrofit_and_invariants` entry:

```json
    ,
    {
      "idx": 12,
      "version": "6",
      "when": 1779439400000,
      "tag": "0012_vote_deadline",
      "breakpoints": true
    }
```

(Place the leading comma correctly — it goes after the last existing entry's closing brace.)

- [ ] **Step 4: Run tests to verify migration applies cleanly**

Run: `pnpm test`
Expected: 624 tests still pass (the new column is harmless to all existing tests; `createTestDb()` runs the migration via `client.execute(stmt)` per `--> statement-breakpoint`).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/migrations/0012_vote_deadline.sql src/db/migrations/meta/_journal.json
git commit -m "feat(db): add sessions.vote_deadline column + backfill"
```

---

## Task 2: Date helpers + tests

**Files:**

- Create: `src/lib/vote-deadline.ts`
- Create: `src/lib/vote-deadline.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/vote-deadline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDefaultDeadline, formatLocalDeadline } from "./vote-deadline";

describe("formatLocalDeadline", () => {
  it("formats a Date as YYYY-MM-DDTHH:MM:SS (no Z, local time)", () => {
    // Construct via constructor to avoid TZ ambiguity in test
    const d = new Date(2026, 4, 21, 16, 30, 0); // 2026-05-21 16:30:00 local
    expect(formatLocalDeadline(d)).toBe("2026-05-21T16:30:00");
  });

  it("zero-pads single-digit month/day/hour/minute/second", () => {
    const d = new Date(2026, 0, 5, 7, 4, 9); // 2026-01-05 07:04:09 local
    expect(formatLocalDeadline(d)).toBe("2026-01-05T07:04:09");
  });
});

describe("computeDefaultDeadline", () => {
  it("returns startTime minus 4 hours as ISO-local string", () => {
    // 2026-05-21 20:30 - 4h = 2026-05-21 16:30
    expect(computeDefaultDeadline("2026-05-21", "20:30")).toBe(
      "2026-05-21T16:30:00",
    );
  });

  it("rolls back across midnight when startTime < 04:00", () => {
    // 2026-05-21 02:30 - 4h = 2026-05-20 22:30
    expect(computeDefaultDeadline("2026-05-21", "02:30")).toBe(
      "2026-05-20T22:30:00",
    );
  });

  it("handles startTime in 24h format with leading zero", () => {
    expect(computeDefaultDeadline("2026-12-31", "08:00")).toBe(
      "2026-12-31T04:00:00",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/vote-deadline.test.ts`
Expected: FAIL with "Cannot find module './vote-deadline'".

- [ ] **Step 3: Implement helpers**

Create `src/lib/vote-deadline.ts`:

```ts
/**
 * Helpers for the vote-deadline ISO-local-time format described in
 * `docs/superpowers/specs/2026-05-21-vote-deadline-design.md`.
 *
 * Format: `YYYY-MM-DDTHH:MM:SS` (no `Z`, no timezone offset). Interpreted as
 * Vietnam local time — same convention as `sessions.date` / `sessions.startTime`.
 * `new Date(deadlineStr)` parses this as local time consistently across
 * Node and browsers, which is what we want (no TZ math at the boundary).
 */

export function formatLocalDeadline(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Default per-session deadline: `startTime − 4 hours`. Used by every session
 * creation path (manual, cron, admin auto-create).
 *
 * @param date YYYY-MM-DD
 * @param startTime HH:MM (24h)
 */
export function computeDefaultDeadline(
  date: string,
  startTime: string,
): string {
  const start = new Date(`${date}T${startTime}:00`);
  const deadline = new Date(start.getTime() - 4 * 60 * 60 * 1000);
  return formatLocalDeadline(deadline);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/vote-deadline.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vote-deadline.ts src/lib/vote-deadline.test.ts
git commit -m "feat(vote): vote-deadline date helpers + tests"
```

---

## Task 3: `isVoteOpen` helper + tests

**Files:**

- Modify: `src/lib/session-status.ts`
- Create: `src/lib/session-status.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/session-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isVoteOpen } from "./session-status";

describe("isVoteOpen", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19);

  it("returns open=true when status=voting and deadline in future", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: future })).toEqual({
      open: true,
    });
  });

  it("returns open=true when status=confirmed and deadline in future", () => {
    expect(isVoteOpen({ status: "confirmed", voteDeadline: future })).toEqual({
      open: true,
    });
  });

  it("returns open=true when deadline is null (no deadline)", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: null })).toEqual({
      open: true,
    });
  });

  it("returns open=false reason=deadline when status=voting and deadline in past", () => {
    expect(isVoteOpen({ status: "voting", voteDeadline: past })).toEqual({
      open: false,
      reason: "deadline",
    });
  });

  it("returns open=false reason=status when status=completed (regardless of deadline)", () => {
    expect(isVoteOpen({ status: "completed", voteDeadline: future })).toEqual({
      open: false,
      reason: "status",
    });
  });

  it("returns open=false reason=status when status=cancelled and deadline null", () => {
    expect(isVoteOpen({ status: "cancelled", voteDeadline: null })).toEqual({
      open: false,
      reason: "status",
    });
  });

  it("status check fires before deadline check (completed + past deadline → reason=status)", () => {
    expect(isVoteOpen({ status: "completed", voteDeadline: past })).toEqual({
      open: false,
      reason: "status",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/session-status.test.ts`
Expected: FAIL with "isVoteOpen is not exported".

- [ ] **Step 3: Implement `isVoteOpen`**

Edit [src/lib/session-status.ts](src/lib/session-status.ts) — append at end of file:

```ts
/**
 * Combined vote-acceptance gate: status must be voting/confirmed AND, if a
 * deadline is set, it must not have passed yet.
 *
 * Status check fires BEFORE deadline check so a completed session never
 * reports `reason: "deadline"` — that would be misleading (vote is closed
 * because finalize ran, not because the clock expired).
 *
 * See docs/superpowers/specs/2026-05-21-vote-deadline-design.md.
 */
export function isVoteOpen(session: {
  status: SessionStatus;
  voteDeadline: string | null;
}): { open: true } | { open: false; reason: "status" | "deadline" } {
  if (session.status !== "voting" && session.status !== "confirmed") {
    return { open: false, reason: "status" };
  }
  if (session.voteDeadline && new Date(session.voteDeadline) <= new Date()) {
    return { open: false, reason: "deadline" };
  }
  return { open: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/session-status.test.ts`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-status.ts src/lib/session-status.test.ts
git commit -m "feat(vote): isVoteOpen helper combines status + deadline gates"
```

---

## Task 4: i18n keys (vi/en/zh)

**Files:**

- Modify: `src/i18n/messages/vi.json`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/zh.json`

(No tests for translation files — added early so subsequent tasks reference real keys.)

- [ ] **Step 1: Find the `voting` namespace in vi.json**

Run: `grep -n '"voting"' src/i18n/messages/vi.json`
Expected: a line like `"voting": {` near a namespace block. Locate the closing `}` for that namespace.

- [ ] **Step 2: Add keys to vi.json**

Edit [src/i18n/messages/vi.json](src/i18n/messages/vi.json) — inside the `"voting"` namespace, add (before the closing `}`):

```json
    "voteDeadlinePassed": "Đã hết hạn vote cho buổi này",
    "voteDeadlineHint": "Vote sẽ đóng lúc {time}",
    "voteCountdownDays": "còn {days} ngày {hours}h",
    "voteCountdownHours": "còn {hours}h {minutes}p",
    "voteCountdownMinutes": "còn {minutes}p {seconds}s",
    "voteClosedLabel": "Đã đóng vote",
    "voteDeadlineSet": "Đặt deadline",
    "voteDeadlineClear": "Bỏ deadline",
    "voteDeadlineExtend2h": "+2 giờ",
    "voteDeadlineExtend24h": "+24 giờ",
```

(If the namespace already has a trailing comma on the previous entry, fine. If not, add a comma to the previous line. Keep JSON valid.)

- [ ] **Step 3: Add keys to en.json**

Edit [src/i18n/messages/en.json](src/i18n/messages/en.json) — same `"voting"` namespace, add:

```json
    "voteDeadlinePassed": "Voting closed for this session",
    "voteDeadlineHint": "Voting closes at {time}",
    "voteCountdownDays": "{days}d {hours}h left",
    "voteCountdownHours": "{hours}h {minutes}m left",
    "voteCountdownMinutes": "{minutes}m {seconds}s left",
    "voteClosedLabel": "Voting closed",
    "voteDeadlineSet": "Set deadline",
    "voteDeadlineClear": "Clear deadline",
    "voteDeadlineExtend2h": "+2 hours",
    "voteDeadlineExtend24h": "+24 hours",
```

- [ ] **Step 4: Add keys to zh.json**

Edit [src/i18n/messages/zh.json](src/i18n/messages/zh.json) — same `"voting"` namespace, add:

```json
    "voteDeadlinePassed": "投票已结束",
    "voteDeadlineHint": "投票将于 {time} 结束",
    "voteCountdownDays": "剩 {days} 天 {hours} 小时",
    "voteCountdownHours": "剩 {hours} 小时 {minutes} 分",
    "voteCountdownMinutes": "剩 {minutes} 分 {seconds} 秒",
    "voteClosedLabel": "投票已结束",
    "voteDeadlineSet": "设置截止",
    "voteDeadlineClear": "清除截止",
    "voteDeadlineExtend2h": "+2 小时",
    "voteDeadlineExtend24h": "+24 小时",
```

- [ ] **Step 5: Add server-side error keys + duplicate `voteDeadlinePassed` to `serverErrors` namespace**

`src/actions/votes.ts` already loads translations from `serverErrors` (one `getTranslations("serverErrors")` call). To avoid forcing a second translator load, also put `voteDeadlinePassed` here. The same key in both namespaces is fine — UI components reading from `voting` use that copy; server actions reading from `serverErrors` use this one.

Locate `"serverErrors"` namespace in all three files (next to existing `invalidIdempotencyKey`). Add:

vi.json:

```json
    "voteDeadlinePassed": "Đã hết hạn vote cho buổi này",
    "invalidDeadlineFormat": "Format deadline không hợp lệ",
    "deadlineMustBeFuture": "Deadline phải sau thời điểm hiện tại",
    "invalidExtendHours": "Số giờ extend phải là 2 hoặc 24",
```

en.json:

```json
    "voteDeadlinePassed": "Voting closed for this session",
    "invalidDeadlineFormat": "Invalid deadline format",
    "deadlineMustBeFuture": "Deadline must be in the future",
    "invalidExtendHours": "Extend hours must be 2 or 24",
```

zh.json:

```json
    "voteDeadlinePassed": "投票已结束",
    "invalidDeadlineFormat": "截止时间格式无效",
    "deadlineMustBeFuture": "截止时间必须是未来时间",
    "invalidExtendHours": "延长小时数必须是 2 或 24",
```

- [ ] **Step 6: Verify JSON is valid**

Run: `pnpm test` (any test will fail-fast if any messages JSON parse fails since next-intl loads them).
Expected: 624 tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/messages/vi.json src/i18n/messages/en.json src/i18n/messages/zh.json
git commit -m "i18n(vote): add deadline + countdown keys (vi/en/zh)"
```

---

## Task 5: Default deadline on session creation paths

**Files:**

- Modify: `src/actions/sessions.ts` (3 call sites: `getNextSession`, `getAdminUpcomingSession`, `createSessionManually`; also clear in `reopenSession`, `unlockSession`)
- Modify: `src/app/api/cron/create-session/route.ts`

- [ ] **Step 1: Import `computeDefaultDeadline` in sessions.ts**

Edit [src/actions/sessions.ts](src/actions/sessions.ts) imports near the top of file. Add:

```ts
import { computeDefaultDeadline } from "@/lib/vote-deadline";
```

- [ ] **Step 2: Wire into `getNextSession` (~line 124)**

Find the first `.insert(sessions).values({` block (around line 124, inside `getNextSession`). It currently looks like:

```ts
      .insert(sessions)
      .values({
        date: candidate,
        status: "voting",
        courtId: defaultCourt?.id ?? null,
        courtPrice: defaultCourt?.pricePerSession ?? null,
        useMinDeduction: true,
      })
```

Change to (the schema default startTime is `"20:30"`; we read it after insert OR use the same default constant here):

```ts
      .insert(sessions)
      .values({
        date: candidate,
        status: "voting",
        courtId: defaultCourt?.id ?? null,
        courtPrice: defaultCourt?.pricePerSession ?? null,
        useMinDeduction: true,
        voteDeadline: computeDefaultDeadline(candidate, "20:30"),
      })
```

- [ ] **Step 3: Wire into `getAdminUpcomingSession` (~line 191)**

Same change pattern — find the `.insert(sessions).values({` block around line 191 inside `getAdminUpcomingSession`:

```ts
        .insert(sessions)
        .values({
          date: today,
          status: "voting",
          courtId: defaultCourt?.id ?? null,
          courtPrice: defaultCourt?.pricePerSession ?? null,
          useMinDeduction: true,
        })
```

Change to:

```ts
        .insert(sessions)
        .values({
          date: today,
          status: "voting",
          courtId: defaultCourt?.id ?? null,
          courtPrice: defaultCourt?.pricePerSession ?? null,
          useMinDeduction: true,
          voteDeadline: computeDefaultDeadline(today, "20:30"),
        })
```

- [ ] **Step 4: Wire into `createSessionManually` (~line 944)**

Find the `.insert(sessions).values({` block around line 944 inside `createSessionManually`. It uses the admin-provided `data.date` + `data.startTime` (validated upstream). Find the insert and add `voteDeadline`:

```ts
    .insert(sessions)
    .values({
      date: data.date,
      startTime: data.startTime ?? "20:30",
      endTime: data.endTime ?? "22:30",
      status: "voting",
      courtId: data.courtId ?? null,
      // ... other existing fields
      voteDeadline: computeDefaultDeadline(data.date, data.startTime ?? "20:30"),
    })
```

(Exact existing fields vary — keep them all, just append the `voteDeadline` line.)

- [ ] **Step 5: Clear deadline in `reopenSession` (cancelled → voting)**

Find `reopenSession` around line 593. The `tx.update(sessions).set({ status: "voting", passRevenue: null, ... })` block:

```ts
await tx
  .update(sessions)
  .set({
    status: "voting",
    passRevenue: null,
    updatedAt: new Date().toISOString(),
  })
  .where(eq(sessions.id, sessionId));
```

Change to:

```ts
await tx
  .update(sessions)
  .set({
    status: "voting",
    passRevenue: null,
    // Cancelled-session reopen: the old deadline is almost certainly in
    // the past. Clear so admin can re-collect votes; admin can set a
    // new deadline via setVoteDeadline if they want one.
    voteDeadline: null,
    updatedAt: new Date().toISOString(),
  })
  .where(eq(sessions.id, sessionId));
```

- [ ] **Step 6: Clear deadline in `unlockSession` (completed → voting)**

Find `unlockSession` around line 705. The final `tx.update(sessions).set({ status: "voting", ... })`:

```ts
await tx
  .update(sessions)
  .set({
    status: "voting",
    updatedAt: new Date().toISOString(),
  })
  .where(eq(sessions.id, sessionId));
```

Change to:

```ts
await tx
  .update(sessions)
  .set({
    status: "voting",
    // Completed-session unlock: old deadline is past. Clear so admin
    // can re-collect votes without time pressure.
    voteDeadline: null,
    updatedAt: new Date().toISOString(),
  })
  .where(eq(sessions.id, sessionId));
```

- [ ] **Step 7: Wire into cron `create-session` route**

Edit [src/app/api/cron/create-session/route.ts](src/app/api/cron/create-session/route.ts). Add the import near top:

```ts
import { computeDefaultDeadline } from "@/lib/vote-deadline";
```

Change the `.insert(sessions).values({...})` block (lines 52-61):

```ts
const [newSession] = await db
  .insert(sessions)
  .values({
    date: dateStr,
    status: "voting",
    courtId: defaultCourt?.id ?? null,
    courtPrice: defaultCourt?.pricePerSession ?? null,
    useMinDeduction: true,
    voteDeadline: computeDefaultDeadline(dateStr, "20:30"),
  })
  .returning();
```

- [ ] **Step 8: Run tests**

Run: `pnpm test`
Expected: 624 + 12 = 636 tests pass (5 from Task 2 + 7 from Task 3).

- [ ] **Step 9: Commit**

```bash
git add src/actions/sessions.ts src/app/api/cron/create-session/route.ts
git commit -m "feat(vote): set default deadline at session creation; clear on reopen/unlock"
```

---

## Task 6: `submitVote` uses `isVoteOpen` + integration test

**Files:**

- Modify: `src/actions/votes.ts`
- Create: `src/actions/vote-deadline.integration.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `src/actions/vote-deadline.integration.test.ts`:

```ts
/**
 * Vote deadline behaviour: submitVote rejects after deadline,
 * setVoteDeadline + extendVoteDeadline gate properly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";

const userMock = vi.hoisted(() => ({
  getUserFromCookie:
    vi.fn<() => Promise<{ memberId: number; externalId: string } | null>>(),
}));
vi.mock("@/lib/user-identity", () => userMock);
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { submitVote } = await import("./votes");
const { setVoteDeadline, extendVoteDeadline } = await import("./sessions");

async function reset() {
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM members");
  userMock.getUserFromCookie.mockReset();
}

async function seedMember() {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Alice", facebookId: "fb-a" })
    .returning({ id: members.id });
  return m.id;
}

async function seedSession(opts: {
  status?: "voting" | "confirmed" | "completed" | "cancelled";
  voteDeadline?: string | null;
}) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      date: "2026-06-01",
      status: opts.status ?? "voting",
      voteDeadline: opts.voteDeadline ?? null,
    })
    .returning({ id: sessions.id });
  return s.id;
}

const futureIso = () =>
  new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19);
const pastIso = () =>
  new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19);

describe("submitVote — vote deadline gate", () => {
  beforeEach(reset);

  it("accepts vote when deadline is in the future", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: futureIso() });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r).toBe(false);
  });

  it("accepts vote when deadline is null (no deadline)", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: null });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r).toBe(false);
  });

  it("rejects vote when deadline has passed", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: pastIso() });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    const r = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r).toBe(true);
  });

  it("rejects edit (update) of existing vote when deadline has passed", async () => {
    const aliceId = await seedMember();
    const sessionId = await seedSession({ voteDeadline: futureIso() });
    userMock.getUserFromCookie.mockResolvedValue({
      memberId: aliceId,
      externalId: "fb-a",
    });

    // First vote OK
    const r1 = await submitVote(sessionId, true, false, 0, 0);
    expect("error" in r1).toBe(false);

    // Move deadline into the past
    await testDb
      .update(sessions)
      .set({ voteDeadline: pastIso() })
      .where(eq(sessions.id, sessionId));

    // Edit attempt fails
    const r2 = await submitVote(sessionId, true, true, 1, 0);
    expect("error" in r2).toBe(true);
  });
});

describe("setVoteDeadline — admin actions", () => {
  beforeEach(reset);

  it("sets a future deadline", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const future = futureIso();
    const r = await setVoteDeadline(sessionId, future);
    expect("error" in r).toBe(false);
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    expect(s?.voteDeadline).toBe(future);
  });

  it("clears deadline when given null", async () => {
    const sessionId = await seedSession({ voteDeadline: futureIso() });
    const r = await setVoteDeadline(sessionId, null);
    expect("error" in r).toBe(false);
    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    expect(s?.voteDeadline).toBeNull();
  });

  it("rejects past deadline", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const r = await setVoteDeadline(sessionId, pastIso());
    expect("error" in r).toBe(true);
  });

  it("rejects malformed deadline string", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const r = await setVoteDeadline(sessionId, "not-a-date");
    expect("error" in r).toBe(true);
  });
});

describe("extendVoteDeadline — quick buttons", () => {
  beforeEach(reset);

  it("extends a future deadline by N hours", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    // Set a known deadline 30 minutes from now
    const baseMs = Date.now() + 30 * 60 * 1000;
    const baseIso = new Date(baseMs).toISOString().slice(0, 19);
    await testDb
      .update(sessions)
      .set({ voteDeadline: baseIso })
      .where(eq(sessions.id, sessionId));

    const r = await extendVoteDeadline(sessionId, 2);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    const expectedMs = baseMs + 2 * 60 * 60 * 1000;
    const actualMs = new Date(s!.voteDeadline!).getTime();
    // Allow 5s drift for test execution
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(5_000);
  });

  it("pushes from NOW when current deadline is in the past", async () => {
    const sessionId = await seedSession({ voteDeadline: pastIso() });
    const beforeMs = Date.now();
    const r = await extendVoteDeadline(sessionId, 2);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    const newMs = new Date(s!.voteDeadline!).getTime();
    // Should be roughly now + 2h, not past + 2h
    expect(newMs).toBeGreaterThan(beforeMs + 2 * 60 * 60 * 1000 - 5_000);
    expect(newMs).toBeLessThan(beforeMs + 2 * 60 * 60 * 1000 + 5_000);
  });

  it("works when current deadline is null (pushes from now)", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const beforeMs = Date.now();
    const r = await extendVoteDeadline(sessionId, 24);
    expect("error" in r).toBe(false);

    const s = await testDb.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });
    const newMs = new Date(s!.voteDeadline!).getTime();
    expect(newMs).toBeGreaterThan(beforeMs + 24 * 60 * 60 * 1000 - 5_000);
    expect(newMs).toBeLessThan(beforeMs + 24 * 60 * 60 * 1000 + 5_000);
  });

  it("rejects hours other than 2 or 24", async () => {
    const sessionId = await seedSession({ voteDeadline: null });
    const r = await extendVoteDeadline(sessionId, 5 as 2 | 24);
    expect("error" in r).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/actions/vote-deadline.integration.test.ts`
Expected: FAIL — `submitVote` ignores deadline; `setVoteDeadline` / `extendVoteDeadline` not exported.

- [ ] **Step 3: Update `submitVote` to use `isVoteOpen`**

Edit [src/actions/votes.ts](src/actions/votes.ts). First update the import block — add `isVoteOpen` to the existing import from session-status:

```ts
import {
  assertEditable,
  isVoteOpen,
  type SessionStatus,
} from "@/lib/session-status";
```

(The file currently imports `assertEditable` and `SessionStatus` from there; just add `isVoteOpen`.)

Then replace the status-check block (around line 51-54):

```ts
if (session.status !== "voting" && session.status !== "confirmed") {
  return { error: t("voteNotAccepted") };
}
```

with:

```ts
const gate = isVoteOpen({
  status: session.status as SessionStatus,
  voteDeadline: session.voteDeadline,
});
if (!gate.open) {
  return {
    error:
      gate.reason === "deadline"
        ? t("voteDeadlinePassed")
        : t("voteNotAccepted"),
  };
}
```

`t` here is the existing `getTranslations("serverErrors")` already at the top of `submitVote`. Task 4 Step 5 added `voteDeadlinePassed` to the `serverErrors` namespace, so this resolves correctly — no second translator load needed.

- [ ] **Step 4: Run tests — submitVote ones should pass, action ones still fail**

Run: `pnpm test src/actions/vote-deadline.integration.test.ts -t "submitVote"`
Expected: 4 tests pass.

The `setVoteDeadline` / `extendVoteDeadline` test groups still fail because those actions don't exist yet — that's expected, addressed in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/actions/votes.ts src/actions/vote-deadline.integration.test.ts
git commit -m "feat(vote): submitVote gates on deadline via isVoteOpen + tests"
```

---

## Task 7: Admin actions `setVoteDeadline` + `extendVoteDeadline`

**Files:**

- Modify: `src/actions/sessions.ts`

- [ ] **Step 1: Add `setVoteDeadline` action**

Edit [src/actions/sessions.ts](src/actions/sessions.ts). At the end of file, add:

```ts
/**
 * Set or clear a session's vote deadline.
 *
 * - `deadline = null` clears the deadline (vote stays open until status changes).
 * - Otherwise must be `YYYY-MM-DDTHH:MM:SS` (no Z) and strictly in the future.
 *
 * See docs/superpowers/specs/2026-05-21-vote-deadline-design.md.
 */
export async function setVoteDeadline(
  sessionId: number,
  deadline: string | null,
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }

  if (deadline !== null) {
    if (
      typeof deadline !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(deadline)
    ) {
      return { error: t("invalidDeadlineFormat") };
    }
    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) {
      return { error: t("invalidDeadlineFormat") };
    }
    if (parsed.getTime() <= Date.now()) {
      return { error: t("deadlineMustBeFuture") };
    }
  }

  await db
    .update(sessions)
    .set({
      voteDeadline: deadline,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, sessionId));

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true };
}
```

- [ ] **Step 2: Add `extendVoteDeadline` action**

In the same file, append:

```ts
/**
 * Quick-extend the vote deadline by 2 or 24 hours. Pushes from `max(now,
 * currentDeadline)` so calling it when the deadline is already in the past
 * resets the clock from now, not from the past.
 */
export async function extendVoteDeadline(sessionId: number, hours: 2 | 24) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { error: t("invalidSessionId") };
  }
  if (hours !== 2 && hours !== 24) {
    return { error: t("invalidExtendHours") };
  }

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: { voteDeadline: true },
  });
  if (!session) return { error: t("sessionNotFound") };

  const now = Date.now();
  const currentDeadlineMs = session.voteDeadline
    ? new Date(session.voteDeadline).getTime()
    : now;
  const baseMs = Math.max(now, currentDeadlineMs);
  const newDeadline = new Date(baseMs + hours * 60 * 60 * 1000);
  const newDeadlineStr = formatLocalDeadline(newDeadline);

  await db
    .update(sessions)
    .set({
      voteDeadline: newDeadlineStr,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(sessions.id, sessionId));

  revalidatePath("/");
  revalidatePath(`/vote/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath(`/admin/sessions/${sessionId}`);
  return { success: true, voteDeadline: newDeadlineStr };
}
```

- [ ] **Step 3: Import `formatLocalDeadline`**

In the import block at the top of [src/actions/sessions.ts](src/actions/sessions.ts), update the vote-deadline import to include the formatter:

```ts
import {
  computeDefaultDeadline,
  formatLocalDeadline,
} from "@/lib/vote-deadline";
```

- [ ] **Step 4: Run integration tests**

Run: `pnpm test src/actions/vote-deadline.integration.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: 624 + 11 (vote-deadline) + 5 (vote-deadline.ts) + 7 (session-status.ts) = 647 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/actions/sessions.ts
git commit -m "feat(vote): setVoteDeadline + extendVoteDeadline admin actions"
```

---

## Task 8: `<VoteCountdown>` component

**Files:**

- Create: `src/components/sessions/vote-countdown.tsx`

(No unit tests — component is purely presentational with timer logic. Manual smoke covers it.)

- [ ] **Step 1: Create the component**

Create `src/components/sessions/vote-countdown.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface VoteCountdownProps {
  /** ISO-local string (YYYY-MM-DDTHH:MM:SS). NULL = render nothing. */
  deadline: string | null;
  /** banner = sticky card on vote page. inline = single text line for cards/lists. */
  variant: "banner" | "inline";
  /** Fires once when remaining time hits 0. Use to flip parent's isVotingOpen. */
  onExpired?: () => void;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export function VoteCountdown({
  deadline,
  variant,
  onExpired,
}: VoteCountdownProps) {
  const t = useTranslations("voting");
  const [remainingMs, setRemainingMs] = useState<number | null>(() =>
    deadline ? new Date(deadline).getTime() - Date.now() : null,
  );

  useEffect(() => {
    if (!deadline) {
      setRemainingMs(null);
      return;
    }
    let firedExpired = false;
    const update = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      setRemainingMs(ms);
      if (ms <= 0 && !firedExpired) {
        firedExpired = true;
        onExpired?.();
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  if (!deadline) return null;

  if (remainingMs !== null && remainingMs <= 0) {
    if (variant === "banner") {
      return (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-center text-sm font-semibold">
          {t("voteClosedLabel")}
        </div>
      );
    }
    return (
      <span className="text-destructive text-sm font-medium">
        {t("voteClosedLabel")}
      </span>
    );
  }

  const ms = remainingMs ?? 0;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000) % 24;
  const days = Math.floor(ms / 86_400_000);

  let text: string;
  if (days > 0) {
    text = t("voteCountdownDays", { days, hours });
  } else if (hours > 0) {
    text = t("voteCountdownHours", { hours, minutes });
  } else {
    text = t("voteCountdownMinutes", { minutes, seconds });
  }

  const urgent = ms < ONE_HOUR_MS;

  if (variant === "inline") {
    return (
      <span
        className={cn(
          "text-sm font-medium tabular-nums",
          urgent ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {text}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-center text-sm font-semibold tabular-nums backdrop-blur",
        urgent
          ? "border-destructive/30 bg-destructive/10 text-destructive animate-pulse"
          : "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {text}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sessions/vote-countdown.tsx
git commit -m "feat(vote): VoteCountdown component (banner + inline variants)"
```

---

## Task 9: Wire countdown into member-facing pages

**Files:**

- Modify: `src/app/(public)/vote/[id]/page.tsx`
- Modify: `src/app/(public)/page.tsx`

- [ ] **Step 1: Vote page — fetch `voteDeadline` + render banner**

Edit [src/app/(public)/vote/[id]/page.tsx](<src/app/(public)/vote/[id]/page.tsx>). First confirm `getSession` returns `voteDeadline` — it should automatically because Drizzle `findFirst` returns all columns. If `getSession` selects specific columns, add `voteDeadline: true` to the column allowlist.

Add the import at top:

```tsx
import { VoteCountdown } from "@/components/sessions/vote-countdown";
```

Then, in the returned JSX (around line 39-77), insert the countdown above `<SessionVoteOptimisticPanel>` (after the `{!isVotingOpen && (...)}` block, before the panel):

```tsx
{
  isVotingOpen && session.voteDeadline && (
    <VoteCountdown deadline={session.voteDeadline} variant="banner" />
  );
}
```

Also extend the `session` prop on `<SessionVoteOptimisticPanel>` to include `voteDeadline` (so the panel can re-evaluate `isVotingOpen` client-side if it does its own check) — but for now the panel's behavior is server-driven via `isVotingOpen` prop, and rerender on expiry happens through `revalidatePath` from subsequent server actions. No panel changes needed in this task.

- [ ] **Step 2: Home page — render inline countdown in session card**

Edit [src/app/(public)/page.tsx](<src/app/(public)/page.tsx>). Locate the session card markup (where session.date / startTime are shown). Add the import:

```tsx
import { VoteCountdown } from "@/components/sessions/vote-countdown";
```

Find the spot in the session card where you'd want a "vote còn 3h" line — typically below or near the date/time display. Insert:

```tsx
{
  session.voteDeadline &&
    (session.status === "voting" || session.status === "confirmed") && (
      <VoteCountdown deadline={session.voteDeadline} variant="inline" />
    );
}
```

(Verify the session object passed in scope has `voteDeadline`. If the home page fetches via a custom query that doesn't return it, add it.)

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: build completes without errors.

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: all tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/(public)/vote/[id]/page.tsx src/app/(public)/page.tsx
git commit -m "feat(vote): countdown UI on vote page banner + home session card"
```

---

## Task 10: Admin session list — Deadline column + edit popover

**Files:**

- Create: `src/components/sessions/vote-deadline-edit.tsx`
- Modify: `src/app/(admin)/admin/sessions/session-list.tsx`

- [ ] **Step 1: Create the edit popover component**

Create `src/components/sessions/vote-deadline-edit.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { setVoteDeadline, extendVoteDeadline } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { Calendar } from "lucide-react";

interface VoteDeadlineEditProps {
  sessionId: number;
  /** Current deadline value to seed the picker. NULL = empty. */
  current: string | null;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  // <input type="datetime-local"> expects "YYYY-MM-DDTHH:MM" (no seconds).
  return iso.slice(0, 16);
}

export function VoteDeadlineEdit({
  sessionId,
  current,
}: VoteDeadlineEditProps) {
  const t = useTranslations("voting");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => toDatetimeLocalValue(current));

  function handleSet() {
    // datetime-local returns "YYYY-MM-DDTHH:MM" — pad seconds to match our
    // stored format `YYYY-MM-DDTHH:MM:SS`.
    const deadline = value ? `${value}:00` : null;
    setOpen(false);
    fireAction(() => setVoteDeadline(sessionId, deadline));
  }

  function handleClear() {
    setOpen(false);
    fireAction(() => setVoteDeadline(sessionId, null));
  }

  function handleExtend(hours: 2 | 24) {
    setOpen(false);
    fireAction(() => extendVoteDeadline(sessionId, hours));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11 gap-1.5">
          <Calendar className="h-4 w-4" />
          {t("voteDeadlineSet")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">{t("voteDeadlineSet")}</label>
          <Input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSet} className="min-h-11 flex-1">
            {t("voteDeadlineSet")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleExtend(2)}
            className="min-h-11 flex-1"
          >
            {t("voteDeadlineExtend2h")}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExtend(24)}
            className="min-h-11 flex-1"
          >
            {t("voteDeadlineExtend24h")}
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={handleClear}
          className="text-destructive min-h-11 w-full"
        >
          {t("voteDeadlineClear")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Confirm `Popover` exists in `src/components/ui`**

Run: `ls src/components/ui/popover.tsx 2>&1`
If missing: install via `npx shadcn@latest add popover` (or use a Sheet instead — adjust component).

If popover.tsx exists, proceed.

- [ ] **Step 3: Add Deadline column to admin session list**

Edit [src/app/(admin)/admin/sessions/session-list.tsx](<src/app/(admin)/admin/sessions/session-list.tsx>). Add the imports:

```tsx
import { VoteCountdown } from "@/components/sessions/vote-countdown";
import { VoteDeadlineEdit } from "@/components/sessions/vote-deadline-edit";
```

Locate the row markup (where each session is rendered as a row/card) and add a cell/section for the deadline. Example structure (adapt to existing layout):

```tsx
<div className="flex items-center gap-2">
  {(s.status === "voting" || s.status === "confirmed") && (
    <>
      <VoteCountdown deadline={s.voteDeadline} variant="inline" />
      <VoteDeadlineEdit sessionId={s.id} current={s.voteDeadline} />
    </>
  )}
</div>
```

Place near the date/status column so admin sees deadline alongside session metadata.

- [ ] **Step 4: Confirm session data passed to list includes `voteDeadline`**

If the admin session list page (`src/app/(admin)/admin/sessions/page.tsx`) selects sessions via `db.query.sessions.findMany({ columns: { ... } })`, ensure `voteDeadline: true` is in the column allowlist. If it does `findMany()` without `columns`, all columns are selected by default — no change needed.

- [ ] **Step 5: Run build + tests**

Run: `pnpm build && pnpm test`
Expected: build OK, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/sessions/vote-deadline-edit.tsx src/app/(admin)/admin/sessions/session-list.tsx
git commit -m "feat(vote): admin Deadline column + edit popover with set/extend/clear"
```

---

## Task 11: Manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`
Wait for "Ready on https://localhost:8888".

- [ ] **Step 2: Verify new session gets default deadline**

In the admin panel, create a session manually for tomorrow at 20:30. Confirm DB row has `vote_deadline = "<tomorrow>T16:30:00"` (run `pnpm db:studio` or `sqlite3` query).

- [ ] **Step 3: Verify countdown renders on /vote/[id]**

Open `/vote/<sessionId>` in browser. Countdown banner visible above panel, format "còn Xh Yp", color primary (or red+pulse if <1h).

- [ ] **Step 4: Verify countdown on home card**

Open `/`. Session card shows inline "còn Xh Yp" line.

- [ ] **Step 5: Verify admin column + popover**

Open `/admin/sessions`. Deadline countdown shown per row. Click "Đặt deadline" → popover opens. Pick a new datetime → save → countdown updates. Click "+2 giờ" → countdown jumps by 2h. Click "Bỏ deadline" → countdown disappears.

- [ ] **Step 6: Verify deadline-expired blocks vote**

Manually set a session's `vote_deadline` to a past timestamp via `pnpm db:studio`. Refresh `/vote/<sessionId>` → "Đã đóng vote" badge shown. Click any vote toggle → error toast "Đã hết hạn vote cho buổi này".

- [ ] **Step 7: Verify admin extend reopens for members**

While the session is past-deadline, in admin click "+2 giờ" → member refreshes vote page → countdown resumes, vote buttons enabled.

- [ ] **Step 8: Verify reopen/unlock clears deadline**

Cancel a session, then reopen it → vote_deadline should be NULL. Same for unlock on a completed session.

- [ ] **Step 9: Final commit (note: this task has no code changes, just verification — if smoke surfaced bugs, commit fixes in their respective task scope above)**

If everything passes, no commit needed. If you found bugs and patched them, commit each fix referencing the original task it belongs to.

---

## Final verification

- [ ] Run `pnpm test` — expect 624 + 5 + 7 + 11 = 647 tests passing.
- [ ] Run `pnpm lint` — expect 0 errors (warnings are pre-existing).
- [ ] Run `pnpm exec tsc --noEmit` — expect no output (success).
- [ ] Run `pnpm build` — expect successful Next.js production build.
- [ ] Push to main: `git push origin main`.
