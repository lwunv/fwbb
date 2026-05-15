# Fund Status Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th balance bucket "gần hết quỹ" (`0 < balance < 50_000`) and surface fund-status warnings (nợ / hết / gần hết) consistently across 5 screens.

**Architecture:** Single bucketing helper `getFundStatus()` in `src/lib/fund-core.ts`. UI: full `StatusBadge` variant `lowFund` for sparse rows + new `FundStatusIcon` 14×14 icon for dense rows. Server-side bulk-load balances per page (1 `IN` query, no client fetch), prop-drilled to consumers.

**Tech Stack:** Next.js 16 App Router · React 19 · Drizzle ORM · Tailwind CSS v4 · vitest · next-intl

**Spec:** `docs/superpowers/specs/2026-05-15-fund-status-warning-design.md`

---

## File Structure

**New files:**

- `src/lib/fund-core.test.ts` — unit tests for `getFundStatus()` + `computeBalancesForMembers()`.
- `src/components/shared/fund-status-icon.tsx` — small inline icon for dense rows.

**Modified files:**

| Layer        | File                                                     | Responsibility                                                                                |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Core         | `src/lib/fund-core.ts`                                   | Add `LOW_FUND_THRESHOLD`, `FundStatus` type, `getFundStatus()`, `computeBalancesForMembers()` |
| UI primitive | `src/components/shared/status-badge.tsx`                 | Add `lowFund` variant + icon                                                                  |
| i18n         | `src/i18n/messages/vi.json`                              | Add `fundStatus.*` + `fundAdmin.filterLowFund`                                                |
| i18n         | `src/i18n/messages/en.json`, `zh.json`                   | Same keys (approximate translations)                                                          |
| Surface A    | `src/app/(admin)/admin/sessions/page.tsx`                | Bulk-load balances                                                                            |
| Surface A    | `src/app/(admin)/admin/sessions/[id]/page.tsx`           | Bulk-load balances                                                                            |
| Surface A    | `src/app/(admin)/admin/sessions/session-list.tsx`        | Thread `memberBalances` prop                                                                  |
| Surface A    | `src/app/(admin)/admin/sessions/[id]/session-detail.tsx` | Thread `memberBalances` prop                                                                  |
| Surface A    | `src/components/sessions/admin-vote-manager.tsx`         | Accept prop + render `FundStatusIcon` per row                                                 |
| Surface B    | `src/app/(admin)/admin/fund/fund-report.tsx`             | Import `getFundStatus`, add filter chip                                                       |
| Surface C    | `src/app/(admin)/admin/dashboard/page.tsx`               | Extend query for lowFund members                                                              |
| Surface C    | `src/app/(admin)/admin/dashboard/dashboard-client.tsx`   | Add "Gần hết quỹ" section                                                                     |
| Surface D    | `src/app/(admin)/admin/members/page.tsx`                 | Bulk-load balances                                                                            |
| Surface D    | `src/app/(admin)/admin/members/member-list.tsx`          | Render `StatusBadge` per row                                                                  |
| Surface E    | `src/components/finance/fund-balance-banner.tsx`         | Extend threshold + lowFund variant                                                            |

**Boundaries:** Core (`fund-core.ts`) is pure, zero deps. UI primitives are presentational. Surfaces import both. No surface contains bucketing logic locally — they all defer to `getFundStatus()`.

---

## Task 1: Core helper — `getFundStatus()` + `computeBalancesForMembers()`

**Files:**

- Create: `src/lib/fund-core.test.ts`
- Modify: `src/lib/fund-core.ts` (append at end, do not touch existing exports)

- [ ] **Step 1: Write the failing test**

Create `src/lib/fund-core.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LOW_FUND_THRESHOLD,
  getFundStatus,
  computeBalancesForMembers,
  type FundStatus,
} from "./fund-core";

describe("getFundStatus", () => {
  it("returns 'owing' for negative balance", () => {
    expect(getFundStatus(-1)).toBe<FundStatus>("owing");
    expect(getFundStatus(-100_000)).toBe<FundStatus>("owing");
  });

  it("returns 'depleted' for exactly zero", () => {
    expect(getFundStatus(0)).toBe<FundStatus>("depleted");
  });

  it("returns 'lowFund' for 0 < balance < threshold", () => {
    expect(getFundStatus(1)).toBe<FundStatus>("lowFund");
    expect(getFundStatus(LOW_FUND_THRESHOLD - 1)).toBe<FundStatus>("lowFund");
  });

  it("returns 'hasFund' for balance >= threshold", () => {
    expect(getFundStatus(LOW_FUND_THRESHOLD)).toBe<FundStatus>("hasFund");
    expect(getFundStatus(100_000)).toBe<FundStatus>("hasFund");
  });

  it("LOW_FUND_THRESHOLD is 50_000 VND", () => {
    expect(LOW_FUND_THRESHOLD).toBe(50_000);
  });
});

describe("computeBalancesForMembers", () => {
  it("returns empty object for empty memberIds", () => {
    expect(computeBalancesForMembers([], [])).toEqual({});
  });

  it("returns 0 for members with no transactions", () => {
    expect(computeBalancesForMembers([1, 2], [])).toEqual({ 1: 0, 2: 0 });
  });

  it("groups transactions by memberId correctly", () => {
    const txs = [
      { memberId: 1, type: "fund_contribution", amount: 100_000 },
      { memberId: 1, type: "fund_deduction", amount: 30_000 },
      { memberId: 2, type: "fund_contribution", amount: 50_000 },
      { memberId: 2, type: "fund_refund", amount: 20_000 },
    ];
    expect(computeBalancesForMembers([1, 2], txs)).toEqual({
      1: 70_000, // 100K - 30K
      2: 30_000, // 50K - 20K
    });
  });

  it("ignores transactions for member IDs not requested", () => {
    const txs = [
      { memberId: 1, type: "fund_contribution", amount: 100_000 },
      { memberId: 99, type: "fund_contribution", amount: 999_000 },
    ];
    expect(computeBalancesForMembers([1], txs)).toEqual({ 1: 100_000 });
  });

  it("handles reversal pairs (excludes both original and reversal)", () => {
    const txs = [
      { id: 10, memberId: 1, type: "fund_contribution", amount: 100_000 },
      {
        id: 11,
        memberId: 1,
        type: "fund_contribution",
        amount: -100_000,
        reversalOfId: 10,
      },
      { id: 12, memberId: 1, type: "fund_contribution", amount: 50_000 },
    ];
    expect(computeBalancesForMembers([1], txs)).toEqual({ 1: 50_000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/fund-core.test.ts
```

Expected: FAIL with errors like `LOW_FUND_THRESHOLD is not exported` and `getFundStatus is not a function`.

- [ ] **Step 3: Implement helpers in `src/lib/fund-core.ts`**

Append to end of `src/lib/fund-core.ts` (after `calculateFundDeduction`):

```ts
/**
 * Ngưỡng "gần hết quỹ" — balance dương nhưng dưới mức này được coi là cảnh báo.
 * 50K xấp xỉ 1 buổi play share, nên member dưới mức này có nguy cơ thiếu quỹ
 * cho buổi tiếp theo.
 */
export const LOW_FUND_THRESHOLD = 50_000;

export type FundStatus = "owing" | "depleted" | "lowFund" | "hasFund";

/**
 * Bucket balance thành 1 trong 4 trạng thái. Đây là single source of truth —
 * mọi UI surface muốn label balance phải import helper này, không inline so
 * sánh ở callsite.
 */
export function getFundStatus(balance: number): FundStatus {
  if (balance < 0) return "owing";
  if (balance === 0) return "depleted";
  if (balance < LOW_FUND_THRESHOLD) return "lowFund";
  return "hasFund";
}

/**
 * Bulk compute balance cho nhiều member trong 1 lần duyệt. Tránh O(N×M) nếu
 * caller gọi `computeBalanceFromTransactions` trong loop.
 *
 * Trả về object có 1 key cho mỗi memberId trong `memberIds` (kể cả member
 * không có transaction nào → balance 0).
 */
export function computeBalancesForMembers(
  memberIds: number[],
  allTxs: Array<{
    memberId: number;
    type: string;
    amount: number;
    id?: number;
    reversalOfId?: number | null;
  }>,
): Record<number, number> {
  const result: Record<number, number> = {};
  for (const id of memberIds) result[id] = 0;
  if (memberIds.length === 0) return result;

  const wanted = new Set(memberIds);

  // Phase 1: tìm các ID bị reversed bởi row khác trong list.
  const voidedIds = new Set<number>();
  for (const tx of allTxs) {
    if (tx.reversalOfId !== undefined && tx.reversalOfId !== null) {
      voidedIds.add(tx.reversalOfId);
    }
  }

  // Phase 2: tổng hợp theo memberId, skip reversal pairs.
  for (const tx of allTxs) {
    if (!wanted.has(tx.memberId)) continue;
    if (tx.reversalOfId !== undefined && tx.reversalOfId !== null) continue;
    if (tx.id !== undefined && voidedIds.has(tx.id)) continue;

    switch (tx.type) {
      case "fund_contribution":
        result[tx.memberId] += tx.amount;
        break;
      case "fund_deduction":
        result[tx.memberId] -= tx.amount;
        break;
      case "fund_refund":
        result[tx.memberId] -= tx.amount;
        break;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/fund-core.test.ts
```

Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fund-core.ts src/lib/fund-core.test.ts
git commit -m "feat(fund-status): add getFundStatus + computeBalancesForMembers core helpers"
```

---

## Task 2: StatusBadge `lowFund` variant

**Files:**

- Modify: `src/components/shared/status-badge.tsx`

- [ ] **Step 1: Add `"lowFund"` to `StatusVariant` union**

In `src/components/shared/status-badge.tsx`, edit the type (lines ~14-27):

Old:

```ts
export type StatusVariant =
  | "paid"
  | "unpaid"
  | "waiting"
  | "needsConfirm"
  | "partialPaid"
  | "voting"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "lowStock"
  | "inStock"
  | "depleted"
  | "neutral";
```

New:

```ts
export type StatusVariant =
  | "paid"
  | "unpaid"
  | "waiting"
  | "needsConfirm"
  | "partialPaid"
  | "voting"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "lowStock"
  | "inStock"
  | "depleted" // quỹ đã hết — vàng (cảnh báo nhẹ, chưa âm)
  | "lowFund" // gần hết quỹ (0 < balance < 50K) — cam
  | "neutral";
```

- [ ] **Step 2: Add `lowFund` to `VARIANTS` map**

In same file, add to `VARIANTS` after `depleted`:

```ts
  depleted:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  lowFund:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  neutral: "bg-muted text-muted-foreground",
```

- [ ] **Step 3: Add `lowFund` to `ICONS` map**

In same file, add to `ICONS`:

```ts
  lowStock: PackageMinus,
  inStock: PackageCheck,
  lowFund: AlertTriangle,
};
```

And import `AlertTriangle` from `lucide-react` at top of file (after `Hand`):

```ts
import {
  Check,
  CircleAlert,
  CircleSlash,
  Clock,
  HourglassIcon,
  PackageMinus,
  PackageCheck,
  CheckCircle2,
  Hand,
  AlertTriangle,
} from "lucide-react";
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: PASS (no new errors).

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/status-badge.tsx
git commit -m "feat(fund-status): add lowFund variant to StatusBadge (orange + AlertTriangle)"
```

---

## Task 3: FundStatusIcon component (icon-only, for dense rows)

**Files:**

- Create: `src/components/shared/fund-status-icon.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/shared/fund-status-icon.tsx`:

```tsx
import { AlertCircle, AlertTriangle, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatK } from "@/lib/utils";
import { getFundStatus } from "@/lib/fund-core";

/**
 * Small inline icon hiển thị fund-status của 1 member trong rows chật
 * (admin-vote-manager). Render `null` nếu hasFund — không chiếm chỗ.
 *
 * Dùng native `title` attribute → mobile long-press vẫn xem được, không cần
 * Radix tooltip (extra runtime + popper).
 */
export function FundStatusIcon({
  balance,
  size = 14,
  className,
}: {
  balance: number;
  size?: number;
  className?: string;
}) {
  const status = getFundStatus(balance);
  if (status === "hasFund") return null;

  const { Icon, color, title } =
    status === "owing"
      ? {
          Icon: AlertCircle,
          color: "text-rose-500 dark:text-rose-400",
          title: `Nợ ${formatK(-balance)}`,
        }
      : status === "depleted"
        ? {
            Icon: Wallet,
            color: "text-yellow-500 dark:text-yellow-400",
            title: "Hết quỹ",
          }
        : {
            Icon: AlertTriangle,
            color: "text-orange-500 dark:text-orange-400",
            title: `Còn ${formatK(balance)}`,
          };

  return (
    <Icon
      className={cn("shrink-0", color, className)}
      style={{ width: size, height: size }}
      aria-label={title}
      title={title}
    />
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/fund-status-icon.tsx
git commit -m "feat(fund-status): add FundStatusIcon component for dense member rows"
```

---

## Task 4: i18n keys

**Files:**

- Modify: `src/i18n/messages/vi.json`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/zh.json`

- [ ] **Step 1: Add keys to `vi.json`**

Find the `"fundAdmin"` block in `src/i18n/messages/vi.json` and add `filterLowFund`:

```json
"fundAdmin": {
  ...existing keys...
  "filterHasFund": "Vẫn còn quỹ",
  "filterDepleted": "Quỹ đã hết",
  "filterLowFund": "Gần hết quỹ",
  "filterOwing": "Còn nợ"
}
```

Then add a new top-level `"fundStatus"` block (alphabetical order with siblings — after `"fundAdmin"`):

```json
"fundStatus": {
  "owing": "Nợ quỹ",
  "depleted": "Hết quỹ",
  "lowFund": "Gần hết quỹ",
  "hasFund": "Còn quỹ",
  "bannerLowFundTitle": "Quỹ sắp hết",
  "bannerLowFundDesc": "Quỹ của bạn còn {amount}. Nạp thêm để đảm bảo các buổi sau."
}
```

- [ ] **Step 2: Add same keys to `en.json`**

```json
"fundAdmin": {
  ...existing keys...
  "filterLowFund": "Low fund"
},
"fundStatus": {
  "owing": "Owing",
  "depleted": "Depleted",
  "lowFund": "Low fund",
  "hasFund": "Funded",
  "bannerLowFundTitle": "Fund running low",
  "bannerLowFundDesc": "Your fund balance is {amount}. Top up to cover upcoming sessions."
}
```

- [ ] **Step 3: Add same keys to `zh.json`**

```json
"fundAdmin": {
  ...existing keys...
  "filterLowFund": "余额不足"
},
"fundStatus": {
  "owing": "欠款",
  "depleted": "已用完",
  "lowFund": "余额不足",
  "hasFund": "充足",
  "bannerLowFundTitle": "余额即将不足",
  "bannerLowFundDesc": "您的余额为 {amount}。请充值以参加后续活动。"
}
```

- [ ] **Step 4: Type-check (next-intl validates keys at compile time)**

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/messages/
git commit -m "feat(fund-status): add i18n keys for lowFund status (vi/en/zh)"
```

---

## Task 5: Surface A — Sessions row (PRIMARY)

**Files:**

- Modify: `src/app/(admin)/admin/sessions/page.tsx`
- Modify: `src/app/(admin)/admin/sessions/[id]/page.tsx`
- Modify: `src/app/(admin)/admin/sessions/session-list.tsx`
- Modify: `src/app/(admin)/admin/sessions/[id]/session-detail.tsx`
- Modify: `src/components/sessions/admin-vote-manager.tsx`

This is the largest task — split into sub-tasks 5a-5e for safer iteration.

### Task 5a: AdminVoteManager — accept prop + render icon

- [ ] **Step 1: Read current AdminVoteManager**

```bash
# Use Read tool on src/components/sessions/admin-vote-manager.tsx
# Identify (1) the props interface, (2) where each member row is rendered.
```

The member name renders in two places: search/add list AND voted list. Both need the icon.

- [ ] **Step 2: Add `memberBalances` to props interface**

Find the component props type (likely `interface Props` or inline `function AdminVoteManager({ ... }: { ... })`). Add a new optional prop:

```ts
memberBalances?: Record<number, number>;
```

Document it next to other props:

```ts
/** Map memberId → fund balance để render warning icon cạnh tên member. */
memberBalances?: Record<number, number>;
```

- [ ] **Step 3: Import FundStatusIcon at top**

```ts
import { FundStatusIcon } from "@/components/shared/fund-status-icon";
```

- [ ] **Step 4: Render icon next to member name (both lists)**

Wherever a member's name is rendered as text (e.g., `<span>{member.name}</span>` or similar inside the row), wrap it so the icon sits immediately after the name. Example pattern (apply to each row render site — there are ~2 places: search list + voted/playing list):

```tsx
<span className="flex min-w-0 items-center gap-1.5">
  <span className="truncate">{member.nickname || member.name}</span>
  {memberBalances?.[member.id] !== undefined && (
    <FundStatusIcon balance={memberBalances[member.id]} />
  )}
</span>
```

Apply the same pattern wherever member name renders in a row (the existing JSX may already wrap name in a `<span>` — modify to add the `<FundStatusIcon>` sibling). Do NOT render the icon in the small chip showing exempt status or other badges — only next to the primary name display.

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sessions/admin-vote-manager.tsx
git commit -m "feat(fund-status): AdminVoteManager renders FundStatusIcon per member row"
```

### Task 5b: Thread `memberBalances` through session-detail.tsx

- [ ] **Step 1: Add prop to SessionDetail component**

In `src/app/(admin)/admin/sessions/[id]/session-detail.tsx`, add to the component props (next to `exemptMemberIds`):

```ts
/** Map memberId → fund balance. */
memberBalances?: Record<number, number>;
```

Destructure in the function signature:

```ts
export function SessionDetail({
  session,
  votes,
  courts,
  brands,
  members,
  debtMap = {},
  defaultCourtId = null,
  sessionDays,
  exemptMemberIds = [],
  memberBalances = {},
}: { /* ... */ }) {
```

- [ ] **Step 2: Pass to `<AdminVoteManager>`**

Find the `<AdminVoteManager …>` JSX block (around line 162). Add `memberBalances={memberBalances}` to the props list, next to `exemptMemberIds`:

```tsx
<AdminVoteManager
  /* ... existing props ... */
  exemptMemberIds={exemptMemberIds}
  memberBalances={memberBalances}
  sessionCosts={/* ... */}
/>
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/sessions/\[id\]/session-detail.tsx
git commit -m "feat(fund-status): SessionDetail threads memberBalances to AdminVoteManager"
```

### Task 5c: Server load balances in `sessions/[id]/page.tsx`

- [ ] **Step 1: Read current page**

```bash
# Read src/app/(admin)/admin/sessions/[id]/page.tsx
# Identify the Promise.all that loads session + courts + members + exemptions.
```

- [ ] **Step 2: Add bulk-fetch of financial_transactions**

Import at top:

```ts
import { financialTransactions } from "@/db/schema";
import { computeBalancesForMembers } from "@/lib/fund-core";
```

After loading the session and its votes, collect all member IDs that appear in the session (votes + admin if linked + any other referenced members) and add a parallel query to the existing `Promise.all`:

```ts
// memberIds visible trên trang detail = votes + members list (admin có thể
// add bất kỳ member nào nên load balance cho TẤT CẢ active members).
const visibleMemberIds = members.map((m) => m.id);

const memberTxs = await db
  .select({
    memberId: financialTransactions.memberId,
    type: financialTransactions.type,
    amount: financialTransactions.amount,
    id: financialTransactions.id,
    reversalOfId: financialTransactions.reversalOfId,
  })
  .from(financialTransactions)
  .where(inArray(financialTransactions.memberId, visibleMemberIds));

const memberBalances = computeBalancesForMembers(visibleMemberIds, memberTxs);
```

(Note: `members` is presumably the active members list already loaded for the page. Reuse that query instead of duplicating.)

- [ ] **Step 3: Pass `memberBalances` to `<SessionDetail>`**

```tsx
<SessionDetail
  session={session}
  votes={votes}
  /* ... */
  exemptMemberIds={exemptMemberIds}
  memberBalances={memberBalances}
  sessionDays={sessionDays}
/>
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/sessions/\[id\]/page.tsx
git commit -m "feat(fund-status): sessions/[id]/page bulk-loads member balances"
```

### Task 5d: Thread through session-list.tsx

- [ ] **Step 1: Add prop to SessionList**

In `src/app/(admin)/admin/sessions/session-list.tsx`, add to props (around line 168-181):

```ts
memberBalances?: Record<number, number>;
```

Destructure with default:

```ts
export function SessionList({
  sessions,
  /* ... */
  sessionDays,
  memberBalances = {},
}: { /* ... */ memberBalances?: Record<number, number>; }) {
```

- [ ] **Step 2: Pass to `<AdminVoteManager>` inside expanded card**

Find the `<AdminVoteManager>` JSX inside the `isExpanded` block (around line 800). Add prop:

```tsx
<AdminVoteManager
  /* ... existing props ... */
  exemptMemberIds={session.exemptMemberIds}
  memberBalances={memberBalances}
  sessionCosts={/* ... */}
/>
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(admin\)/admin/sessions/session-list.tsx
git commit -m "feat(fund-status): SessionList threads memberBalances to AdminVoteManager"
```

### Task 5e: Server load balances in `sessions/page.tsx`

- [ ] **Step 1: Read current page**

```bash
# Read src/app/(admin)/admin/sessions/page.tsx — identify the Promise.all
# that loads activeMembers + the exemption query.
```

- [ ] **Step 2: Add bulk-fetch of financial_transactions for activeMembers**

Import at top:

```ts
import { financialTransactions } from "@/db/schema";
import { computeBalancesForMembers } from "@/lib/fund-core";
```

After `activeMembers` is loaded (and exemptions are loaded), add one more query:

```ts
const memberIds = activeMembers.map((m) => m.id);
const memberTxs =
  memberIds.length > 0
    ? await db
        .select({
          memberId: financialTransactions.memberId,
          type: financialTransactions.type,
          amount: financialTransactions.amount,
          id: financialTransactions.id,
          reversalOfId: financialTransactions.reversalOfId,
        })
        .from(financialTransactions)
        .where(inArray(financialTransactions.memberId, memberIds))
    : [];

const memberBalances = computeBalancesForMembers(memberIds, memberTxs);
```

- [ ] **Step 3: Pass `memberBalances` to `<SessionList>`**

```tsx
<SessionList
  sessions={sessionCards}
  courts={activeCourts}
  members={activeMembers}
  brands={activeBrands}
  /* ... */
  sessionDays={sessionDays}
  memberBalances={memberBalances}
/>
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(admin\)/admin/sessions/page.tsx
git commit -m "feat(fund-status): sessions/page bulk-loads member balances"
```

### Task 5f: Smoke-test Surface A

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Visit `/admin/sessions`**

Verify:

- Expand a session card. Members with `balance < 50K` show an icon next to their name.
- Hover icon → tooltip with balance label.
- Members with `balance >= 50K` show NO icon.
- No console errors.

- [ ] **Step 3: Visit `/admin/sessions/<id>` detail page**

Same verification.

- [ ] **Step 4: No commit needed** (smoke test only — if issues found, fix in a new sub-task)

---

## Task 6: Surface B — Fund report filter

**Files:**

- Modify: `src/app/(admin)/admin/fund/fund-report.tsx`

- [ ] **Step 1: Import canonical `getFundStatus`**

At top of `src/app/(admin)/admin/fund/fund-report.tsx`, add:

```ts
import { getFundStatus, type FundStatus } from "@/lib/fund-core";
```

- [ ] **Step 2: Replace local `bucket()` with canonical helper**

Find the existing `bucket()` function (lines 61-65):

```ts
function bucket(balance: number): FilterKey {
  if (balance < 0) return "owing";
  if (balance > 0) return "hasFund";
  return "depleted";
}
```

Delete it. Replace `FilterKey` type (line 54) with:

```ts
type FilterKey = FundStatus;
```

Wherever `bucket(fm.balance.balance)` is called, change to `getFundStatus(fm.balance.balance)`.

- [ ] **Step 3: Update `statusFor()` to handle `lowFund`**

Old (lines 67-77):

```ts
function statusFor(
  b: FilterKey,
  t: (key: "filterHasFund" | "filterOwing" | "filterDepleted") => string,
): {
  variant: "paid" | "unpaid" | "depleted";
  label: string;
} {
  if (b === "hasFund") return { variant: "paid", label: t("filterHasFund") };
  if (b === "owing") return { variant: "unpaid", label: t("filterOwing") };
  return { variant: "depleted", label: t("filterDepleted") };
}
```

New:

```ts
function statusFor(
  b: FilterKey,
  t: (
    key: "filterHasFund" | "filterOwing" | "filterDepleted" | "filterLowFund",
  ) => string,
): {
  variant: "paid" | "unpaid" | "depleted" | "lowFund";
  label: string;
} {
  if (b === "hasFund") return { variant: "paid", label: t("filterHasFund") };
  if (b === "owing") return { variant: "unpaid", label: t("filterOwing") };
  if (b === "lowFund") return { variant: "lowFund", label: t("filterLowFund") };
  return { variant: "depleted", label: t("filterDepleted") };
}
```

- [ ] **Step 4: Add `lowFund` to `counts` useMemo**

Find the `counts` useMemo (line 150):

```ts
const counts = useMemo(() => {
  const c = { hasFund: 0, depleted: 0, owing: 0 } as Record<FilterKey, number>;
  for (const fm of fundMembers) c[bucket(fm.balance.balance)] += 1;
  return c;
}, [fundMembers]);
```

New:

```ts
const counts = useMemo(() => {
  const c = { hasFund: 0, depleted: 0, lowFund: 0, owing: 0 } as Record<
    FilterKey,
    number
  >;
  for (const fm of fundMembers) c[getFundStatus(fm.balance.balance)] += 1;
  return c;
}, [fundMembers]);
```

- [ ] **Step 5: Add new filter chip in `FILTERS` array**

Find `FILTERS` (line 190):

```ts
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "hasFund", label: t("filterHasFund") },
  { key: "depleted", label: t("filterDepleted") },
  { key: "owing", label: t("filterOwing") },
];
```

Insert `lowFund` between `depleted` and `owing`:

```ts
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "hasFund", label: t("filterHasFund") },
  { key: "depleted", label: t("filterDepleted") },
  { key: "lowFund", label: t("filterLowFund") },
  { key: "owing", label: t("filterOwing") },
];
```

- [ ] **Step 6: Update card border accent for `lowFund`**

Find the `tones` ternary (lines 264-296). Add a `lowFund` case before the fallback `depleted`:

Old:

```ts
const tones =
  b === "hasFund"
    ? {
        /* blue */
      }
    : b === "owing"
      ? {
          /* rose */
        }
      : {
          /* yellow / depleted */
        };
```

New (insert a 3rd branch):

```ts
const tones =
  b === "hasFund"
    ? {
        /* blue — unchanged */
      }
    : b === "owing"
      ? {
          /* rose — unchanged */
        }
      : b === "lowFund"
        ? {
            bg: "bg-card",
            hover: "hover:bg-muted/40",
            ring: isOpen ? "ring-1 ring-orange-500/40" : "ring-1 ring-border",
            open: "",
            divider: "border-border",
            accent: "border-l-4 border-l-orange-500/60",
          }
        : {
            /* yellow — depleted, unchanged */
          };
```

Also update `balanceColor` ternary (lines 254-259) — add orange for lowFund:

Old:

```ts
const balanceColor =
  fm.balance.balance > 0
    ? "text-blue-600 dark:text-blue-400"
    : fm.balance.balance < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-yellow-600 dark:text-yellow-400";
```

New:

```ts
const balanceColor =
  b === "hasFund"
    ? "text-blue-600 dark:text-blue-400"
    : b === "owing"
      ? "text-rose-600 dark:text-rose-400"
      : b === "lowFund"
        ? "text-orange-600 dark:text-orange-400"
        : "text-yellow-600 dark:text-yellow-400";
```

- [ ] **Step 7: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Smoke-test**

Visit `/admin/fund`. Verify:

- 4 filter chips visible.
- "Gần hết quỹ" filter shows only members with `0 < balance < 50K`.
- Card border for lowFund members is orange.
- Status badge inside card shows correct label.

- [ ] **Step 9: Commit**

```bash
git add src/app/\(admin\)/admin/fund/fund-report.tsx
git commit -m "feat(fund-status): add lowFund filter + accent to fund-report"
```

---

## Task 7: Surface C — Dashboard section

**Files:**

- Modify: `src/app/(admin)/admin/dashboard/page.tsx`
- Modify: `src/app/(admin)/admin/dashboard/dashboard-client.tsx`

- [ ] **Step 1: Read current dashboard page**

```bash
# Read src/app/(admin)/admin/dashboard/page.tsx
# Identify how owingMembers is currently computed.
```

- [ ] **Step 2: Extend dashboard/page.tsx to collect lowFund members**

The page already loads transactions for all active members (or similar). Add a parallel computation: after computing each member's balance, bucket via `getFundStatus()` and group into two lists. Pseudo:

```ts
import { getFundStatus, computeBalancesForMembers } from "@/lib/fund-core";

const memberIds = activeMembers.map((m) => m.id);
const allTxs = await db
  .select({
    memberId: financialTransactions.memberId,
    type: financialTransactions.type,
    amount: financialTransactions.amount,
    id: financialTransactions.id,
    reversalOfId: financialTransactions.reversalOfId,
  })
  .from(financialTransactions)
  .where(inArray(financialTransactions.memberId, memberIds));

const balances = computeBalancesForMembers(memberIds, allTxs);

const owingMembers = activeMembers
  .filter((m) => getFundStatus(balances[m.id] ?? 0) === "owing")
  .map((m) => ({ ...m, balance: balances[m.id] ?? 0 }))
  .sort((a, b) => a.balance - b.balance);

const lowFundMembers = activeMembers
  .filter((m) => getFundStatus(balances[m.id] ?? 0) === "lowFund")
  .map((m) => ({ ...m, balance: balances[m.id] ?? 0 }))
  .sort((a, b) => a.balance - b.balance);
```

(Adapt to the actual existing query/loop pattern in the page — DO NOT add a duplicate query if one already exists for owingMembers; extend it instead.)

- [ ] **Step 3: Pass `lowFundMembers` to `<DashboardClient>`**

Add to the prop pass:

```tsx
<DashboardClient
  /* ...existing props... */
  owingMembers={owingMembers}
  lowFundMembers={lowFundMembers}
/>
```

- [ ] **Step 4: Update DashboardClient prop type**

In `src/app/(admin)/admin/dashboard/dashboard-client.tsx`, add to props:

```ts
lowFundMembers: Array<{
  id: number;
  name: string;
  nickname: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  balance: number;
}>;
```

(Match the shape of `owingMembers` — find existing type for that and mirror it.)

- [ ] **Step 5: Render a new "Gần hết quỹ" section**

Find the existing "Còn nợ" section in DashboardClient and duplicate its JSX immediately after, swapping:

- Section title → `t("lowFundSectionTitle")` or hardcoded "Gần hết quỹ" (if t() isn't already used for the owing title)
- Data source → `lowFundMembers` instead of `owingMembers`
- Color tones → orange instead of red
- Status badge → `<StatusBadge variant="lowFund">` instead of `unpaid`
- Empty state copy → "Không có member nào gần hết quỹ"

Render only if `lowFundMembers.length > 0` (omit the section entirely if zero — same pattern as owing section if it does the same).

- [ ] **Step 6: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 7: Smoke-test**

Visit `/admin/dashboard`. Verify:

- New "Gần hết quỹ" section appears below "Còn nợ" (or wherever owing section sits).
- Lists members with `0 < balance < 50K`.
- Orange-themed.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(admin\)/admin/dashboard/page.tsx src/app/\(admin\)/admin/dashboard/dashboard-client.tsx
git commit -m "feat(fund-status): dashboard adds 'Gần hết quỹ' section"
```

---

## Task 8: Surface D — Member list badge

**Files:**

- Modify: `src/app/(admin)/admin/members/page.tsx`
- Modify: `src/app/(admin)/admin/members/member-list.tsx`

- [ ] **Step 1: Bulk-load balances in members/page.tsx**

In `src/app/(admin)/admin/members/page.tsx`, after loading `members`, add:

```ts
import { financialTransactions } from "@/db/schema";
import { computeBalancesForMembers } from "@/lib/fund-core";
import { inArray } from "drizzle-orm";

const memberIds = members.map((m) => m.id);
const memberTxs =
  memberIds.length > 0
    ? await db
        .select({
          memberId: financialTransactions.memberId,
          type: financialTransactions.type,
          amount: financialTransactions.amount,
          id: financialTransactions.id,
          reversalOfId: financialTransactions.reversalOfId,
        })
        .from(financialTransactions)
        .where(inArray(financialTransactions.memberId, memberIds))
    : [];

const memberBalances = computeBalancesForMembers(memberIds, memberTxs);
```

Pass to `<MemberList>`:

```tsx
<MemberList
  members={members}
  debtsByMember={debtsByMember}
  currentAdminMemberId={currentAdminMemberId}
  memberBalances={memberBalances}
/>
```

- [ ] **Step 2: Add prop to MemberList**

In `src/app/(admin)/admin/members/member-list.tsx`, add to component props (around line 67-73):

```ts
memberBalances?: Record<number, number>;
```

Destructure:

```ts
export function MemberList({
  members,
  debtsByMember = {},
  currentAdminMemberId = null,
  memberBalances = {},
}: {
  members: Member[];
  debtsByMember?: Record<number, MemberDebt[]>;
  currentAdminMemberId?: number | null;
  memberBalances?: Record<number, number>;
}) {
```

- [ ] **Step 3: Import getFundStatus + add helper for label/variant**

At top of file:

```ts
import { getFundStatus } from "@/lib/fund-core";
```

Add inside the component (above the return), a small helper:

```tsx
function fundStatusBadgeFor(
  balance: number,
  tFs: ReturnType<typeof useTranslations>,
) {
  const status = getFundStatus(balance);
  if (status === "hasFund") return null;
  const variant =
    status === "owing"
      ? "unpaid"
      : status === "depleted"
        ? "depleted"
        : "lowFund";
  return (
    <StatusBadge variant={variant} className="shrink-0">
      {tFs(status)}
    </StatusBadge>
  );
}
```

Add a `tFs` translation hook usage near the existing `useTranslations` calls (line ~101):

```ts
const tFs = useTranslations("fundStatus");
```

- [ ] **Step 4: Render badge in member row**

Find the member name row JSX (around lines 310-334). The row has avatar + name + action buttons. Insert the fund-status badge **between the name block and the action buttons**:

```tsx
<MemberAvatar /* ... */ />
<div className="min-w-0 flex-1">
  <p className="flex items-center gap-1.5 text-base font-semibold">
    {member.name}
    {/* ...existing nickname, admin crown... */}
  </p>
</div>
{fundStatusBadgeFor(memberBalances[member.id] ?? 0, tFs)}
<Button /* ...crown link... */ />
<Button /* ...trash... */ />
<Button /* ...lock... */ />
```

- [ ] **Step 5: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 6: Smoke-test**

Visit `/admin/members`. Verify:

- Members with negative balance show red "Nợ quỹ" badge.
- Members with balance = 0 show yellow "Hết quỹ" badge.
- Members with `0 < balance < 50K` show orange "Gần hết quỹ" badge.
- Members with `balance >= 50K` show NO badge.
- Row layout doesn't break on mobile (badge may wrap to next line — acceptable).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(admin\)/admin/members/page.tsx src/app/\(admin\)/admin/members/member-list.tsx
git commit -m "feat(fund-status): member-list shows balance status badge per row"
```

---

## Task 9: Surface E — Member-facing banner

**Files:**

- Modify: `src/components/finance/fund-balance-banner.tsx`

- [ ] **Step 1: Import core helper**

At top of `src/components/finance/fund-balance-banner.tsx`:

```ts
import { getFundStatus, LOW_FUND_THRESHOLD } from "@/lib/fund-core";
```

- [ ] **Step 2: Extend render condition**

Old (line 33):

```ts
if (balance > 0) return null;
```

New (replace):

```ts
const status = getFundStatus(balance);
if (status === "hasFund") return null;
```

- [ ] **Step 3: Add `isLowFund` case + replace local color flags**

Old (lines 35-44):

```ts
const isOwing = balance < 0;
const debtAmount = isOwing ? Math.abs(balance) : 0;
const canExpand = memberId != null;

const wrapperClass = cn(
  "rounded-xl border transition-colors",
  isOwing
    ? "border-destructive/40 bg-destructive/5"
    : "border-amber-500/40 bg-amber-500/5",
);
```

New:

```ts
const isOwing = status === "owing";
const isLowFund = status === "lowFund";
const debtAmount = isOwing ? Math.abs(balance) : 0;
const canExpand = memberId != null;

const wrapperClass = cn(
  "rounded-xl border transition-colors",
  isOwing
    ? "border-destructive/40 bg-destructive/5"
    : isLowFund
      ? "border-orange-500/40 bg-orange-500/5"
      : "border-amber-500/40 bg-amber-500/5",
);
```

- [ ] **Step 4: Update icon + copy block to handle lowFund**

Old (lines 47-77 — the inner block with icon + headline):

```tsx
<div
  className={cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
    isOwing
      ? "bg-destructive/15 text-destructive"
      : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  )}
>
  {isOwing ? (
    <AlertCircle className="h-5 w-5" />
  ) : (
    <PiggyBank className="h-5 w-5" />
  )}
</div>
<div className="min-w-0 flex-1">
  <p
    className={cn(
      "text-sm leading-snug font-semibold",
      isOwing ? "text-destructive" : "text-amber-700 dark:text-amber-300",
    )}
  >
    {isOwing
      ? "Bạn ơi, vẫn còn nợ quỹ đấy nhé, nhớ thanh toán sớm!"
      : "Hết quỹ rồi bạn ơi, nộp thêm đi nhé!"}
  </p>
  ...
</div>
```

New:

```tsx
<div
  className={cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
    isOwing
      ? "bg-destructive/15 text-destructive"
      : isLowFund
        ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
        : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  )}
>
  {isOwing ? (
    <AlertCircle className="h-5 w-5" />
  ) : isLowFund ? (
    <AlertTriangle className="h-5 w-5" />
  ) : (
    <PiggyBank className="h-5 w-5" />
  )}
</div>
<div className="min-w-0 flex-1">
  <p
    className={cn(
      "text-sm leading-snug font-semibold",
      isOwing
        ? "text-destructive"
        : isLowFund
          ? "text-orange-700 dark:text-orange-300"
          : "text-amber-700 dark:text-amber-300",
    )}
  >
    {isOwing
      ? "Bạn ơi, vẫn còn nợ quỹ đấy nhé, nhớ thanh toán sớm!"
      : isLowFund
        ? `Quỹ sắp hết — còn ${formatK(balance)}, nạp thêm để chắc cho buổi sau nhé!`
        : "Hết quỹ rồi bạn ơi, nộp thêm đi nhé!"}
  </p>
  {isOwing && (
    <p className="text-destructive mt-1 text-base font-bold tabular-nums">
      {formatK(debtAmount)}
    </p>
  )}
  <p className="text-muted-foreground mt-1 text-xs">
    {canExpand
      ? open
        ? "Bấm lại để đóng QR"
        : "Bấm để mở QR ngay tại đây"
      : "Bấm để mở trang Quỹ và nộp tiền"}
  </p>
</div>
```

Import `AlertTriangle` at top:

```ts
import {
  AlertCircle,
  AlertTriangle,
  PiggyBank,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
```

- [ ] **Step 5: Update bottom CTA link border to include lowFund variant**

Find the inner `<Link>` (lines 137-148) — fix the className ternary the same way:

```tsx
className={cn(
  "inline-flex w-full items-center justify-center gap-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
  isOwing
    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
    : isLowFund
      ? "border-orange-500/40 text-orange-700 hover:bg-orange-500/10 dark:text-orange-300"
      : "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300",
)}
```

- [ ] **Step 6: Type-check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 7: Smoke-test**

Log in as a member with `0 < balance < 50K` (or temporarily seed one). Visit member home page. Verify:

- Banner renders with orange theme + AlertTriangle icon.
- Copy: "Quỹ sắp hết — còn 30K, nạp thêm…"
- Click → expands QR panel (canExpand path) or links to /my-fund (no-memberId path).

Member with balance ≥ 50K → banner does NOT render.

- [ ] **Step 8: Commit**

```bash
git add src/components/finance/fund-balance-banner.tsx
git commit -m "feat(fund-status): member-facing banner warns at lowFund threshold (<50K)"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: New `fund-core.test.ts` passes. Pre-existing failures unrelated to this PR are acceptable but should not have grown (compare count vs main).

- [ ] **Step 2: Type-check whole repo**

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

Expected: PASS (or no NEW warnings introduced by this PR).

- [ ] **Step 4: Manual end-to-end smoke**

Walk through each surface in browser:

1. `/admin/sessions` — expand a card with a low-fund member → icon appears.
2. `/admin/sessions/<id>` — detail page → icon appears.
3. `/admin/fund` — 4 filter chips → "Gần hết" filters correctly.
4. `/admin/dashboard` — "Gần hết quỹ" section visible.
5. `/admin/members` — badges show on rows.
6. Log in as member-facing → banner shows for lowFund member.

- [ ] **Step 5: No commit needed unless issues found**

If any surface fails: open a fix sub-task, commit fix separately.

---

## Notes for the implementing engineer

- **Money is integer VND, never floats.** `LOW_FUND_THRESHOLD = 50_000` is integer. Do not introduce `parseFloat()` anywhere in this PR.
- **Optimistic UI:** This feature only reads balance, never writes. No optimistic patterns added. If a session is finalized while the page is open, server revalidation refreshes balances via the existing `revalidatePath` flow (already in place for other writes).
- **Bulk query pattern:** The `IN (...)` query is bounded by active members count (~50). At this scale, single query is far cheaper than N queries — do not micro-optimize further (e.g., cursor pagination, partial fetches).
- **Reversal pairs:** `computeBalancesForMembers` honors `reversalOfId` exactly like the existing `computeBalanceFromTransactions` — both the reversal and the original drop out cleanly. The test in Task 1 covers this.
- **Mobile-first:** Icons in dense rows are 14×14. Member-list badge sits on its own line if needed (acceptable wrap). Do not add horizontal scroll to fit.
- **Do NOT add new MEMORY.md entries** unless surprising behavior emerges during implementation. The spec is the canonical record.
