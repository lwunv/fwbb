# Fund Status Warning — Design Spec

**Date:** 2026-05-15
**Author:** lwunv
**Status:** Approved, ready for implementation plan

## Problem

Currently the app only distinguishes 3 balance states of a member's fund:

- `balance < 0` → **nợ quỹ** (owing) — surfaced in fund-report, dashboard, member-facing banner.
- `balance = 0` → **hết quỹ** (depleted) — surfaced in fund-report only.
- `balance ≥ 0` → có quỹ — no warning.

There is no "almost out" signal. Admin can't tell which members are about to run out before a session is finalized, and members aren't warned to top up early. The result: members hit zero mid-session, min-deduction floor kicks in, or admin discovers shortfalls only when finalizing.

## Goal

Add a fourth bucket — **"gần hết"** (low fund, `0 < balance < 50_000`) — and surface fund status warnings consistently across 5 screens.

## Threshold

```
balance < 0           → "owing"     (nợ quỹ)     red
balance = 0           → "depleted"  (hết quỹ)    yellow
0 < balance < 50_000  → "lowFund"   (gần hết)    orange   ← NEW
balance ≥ 50_000      → "hasFund"   (còn quỹ)    no badge
```

`50_000` (50K VND) is the chosen threshold — roughly equal to the typical per-session play cost share, so a member sitting below 50K is at real risk of insufficient funds for the next session.

## Architecture

### 1. Single source of truth — `src/lib/fund-core.ts`

All bucketing logic lives in one file. Every surface imports from here.

```ts
export const LOW_FUND_THRESHOLD = 50_000;

export type FundStatus = "owing" | "depleted" | "lowFund" | "hasFund";

export function getFundStatus(balance: number): FundStatus {
  if (balance < 0) return "owing";
  if (balance === 0) return "depleted";
  if (balance < LOW_FUND_THRESHOLD) return "lowFund";
  return "hasFund";
}

// Bulk helper: group transactions by memberId once, compute balance per ID.
// Tránh O(N×M) khi gọi computeBalanceFromTransactions trong loop.
export function computeBalancesForMembers(
  memberIds: number[],
  allTxs: FinancialTransaction[],
): Record<number, number>;
```

**Invariant:** any code that needs to label balance status MUST use `getFundStatus()`. No inline `if (balance < 0)` checks outside this module.

### 2. UI primitive — StatusBadge variant + FundStatusIcon

**`src/components/shared/status-badge.tsx`** — add variant `"lowFund"`:

- Color: `bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200`
- Icon: `AlertTriangle` (lucide-react)

**`src/components/shared/fund-status-icon.tsx`** (new) — small standalone icon for inline use in dense rows where a full pill badge is too noisy:

```tsx
<FundStatusIcon balance={balance} size={14} />
```

Behavior:

- `hasFund` → renders `null` (no DOM).
- `owing` → `AlertCircle` rose-500 + native `title="Nợ {formatK(-balance)}"`.
- `depleted` → `Wallet` yellow-500 + `title="Hết quỹ"`.
- `lowFund` → `AlertTriangle` orange-500 + `title="Còn {formatK(balance)}"`.

Uses native `title` attribute (not Radix tooltip) — works on mobile long-press, no extra runtime, no popper.

### 3. Data flow — server → client

```
Server pages (admin sessions, dashboard, members, etc.)
  ├─ Bulk-fetch financial_transactions WHERE member_id IN (visible memberIds)
  ├─ computeBalancesForMembers(memberIds, txs) → Record<memberId, balance>
  └─ Pass Record<number, number> down to client components as `memberBalances` prop
```

Zero client-side fetching. Compute once on server, prop-drill to consumers. Same pattern as existing `debtMap`.

### 4. Surfaces (5 screens)

**Icon vs full badge — choice per surface:**

- **Dense rows** (admin-vote-manager rows: avatar + name + vote buttons + stepper crowding the row) → use `<FundStatusIcon>` (14×14 icon only, no label).
- **Sparse rows / dedicated lists** (fund-report cards, member-list rows with trailing column space, dashboard sections) → use full `<StatusBadge variant="...">` with text label.

This keeps the dense mobile views readable while sparse views get the more accessible labeled badges.

#### A. Sessions row — `/admin/sessions` (PRIMARY)

**Files:**

- `src/app/(admin)/admin/sessions/page.tsx` — bulk-load balances for all members shown across all sessions on the page.
- `src/app/(admin)/admin/sessions/[id]/page.tsx` — bulk-load balances for the session's members.
- `src/app/(admin)/admin/sessions/session-list.tsx` — thread `memberBalances` to `AdminVoteManager`.
- `src/app/(admin)/admin/sessions/[id]/session-detail.tsx` — thread `memberBalances` to `AdminVoteManager`.
- `src/components/sessions/admin-vote-manager.tsx` — accept new prop `memberBalances?: Record<number, number>`, render `<FundStatusIcon>` next to each member name in the member list rows.

**Behavior:** Icon appears immediately after the member's display name in every row (search list + voted list). Members with `hasFund` render no icon (no extra space taken). Mobile-friendly.

#### B. Fund report filter — `/admin/fund`

**File:** `src/app/(admin)/admin/fund/fund-report.tsx`

- Replace local `bucket()` with import from `fund-core`.
- `statusFor()` add case for `"lowFund"` → `{ variant: "lowFund", label: t("filterLowFund") }`.
- Add 4th filter chip "Gần hết" between "Hết" and "Còn nợ".
- Update `counts` useMemo to track `lowFund` count.
- Update card border accent: add `border-l-orange-500/60` case for lowFund.

#### C. Dashboard section — `/admin/dashboard`

**Files:**

- `src/app/(admin)/admin/dashboard/page.tsx` — extend the existing owing-members query to also collect lowFund members. Single query (same `IN` clause).
- `src/app/(admin)/admin/dashboard/dashboard-client.tsx` — add a new "Gần hết quỹ" card section immediately after the existing "Còn nợ" section, using the same row layout (avatar + name + balance + badge).

#### D. Member list — `/admin/members`

**Files:**

- `src/app/(admin)/admin/members/page.tsx` — bulk-load balances for all active members.
- `src/app/(admin)/admin/members/member-list.tsx` — render `<StatusBadge variant={...}>` next to each member row when status ≠ hasFund. Position: right-side of row, before action buttons.

#### E. Member-facing banner

**File:** `src/components/finance/fund-balance-banner.tsx`

- Extend render condition from `balance ≤ 0` to `balance < LOW_FUND_THRESHOLD`.
- Add `lowFund` visual variant: orange tones (not red), copy "Quỹ gần hết, nạp thêm để đảm bảo buổi sau" (final wording TBD by i18n key).
- Existing `owing` and `depleted` variants unchanged.

### 5. i18n keys (`src/i18n/messages/vi.json`)

```json
"fundAdmin": {
  "filterLowFund": "Gần hết quỹ"
},
"fundStatus": {
  "owing": "Nợ quỹ",
  "depleted": "Hết quỹ",
  "lowFund": "Gần hết quỹ",
  "hasFund": "Còn quỹ",
  "bannerLowFundTitle": "Quỹ sắp hết",
  "bannerLowFundDesc": "Quỹ của bạn còn {amount}. Nạp thêm để đảm bảo các buổi sau."
}
```

Also add to `en.json` and `zh.json` for consistency (translations can be approximate; vi is canonical).

## Performance

- All balance compute happens server-side, prop-drilled to client. Zero hydration cost beyond the prop bytes.
- 1 query per page (not 1 per session/member). `WHERE member_id IN (...)` then group in JS via `computeBalancesForMembers`.
- Dashboard already loads owing-members; extends naturally with no extra query cost.

## Testing

**Pure unit tests** (`src/lib/__tests__/fund-core.test.ts`):

1. `getFundStatus()` boundaries: `-1 → owing`, `0 → depleted`, `1 → lowFund`, `49_999 → lowFund`, `50_000 → hasFund`, `100_000 → hasFund`.
2. `computeBalancesForMembers([1,2,3], txs)`:
   - Empty input → `{}`.
   - Each memberId in result; member with no txs gets `0`.
   - Result matches `computeBalanceFromTransactions(id, txs)` for each id individually.

**No new integration tests required** — surfaces use existing `StatusBadge` test infra and prop-drilling pattern already covered by render tests.

## Out of scope (YAGNI)

- Configurable threshold per group (constant `50_000` for now).
- Animation on icon entry/exit.
- Tooltip showing full balance history (just label + current balance).
- Push notification when member crosses into lowFund.
- Admin override to dismiss the banner per member.

## Invariants preserved

- **I8 (reconcile-fund):** No change. This spec only reads balance, never writes ledger entries.
- **Money rounding:** No change. `LOW_FUND_THRESHOLD = 50_000` is an integer VND.
- **Mobile-first:** Icon-only inline keeps row height unchanged; member list pill badge sits in existing trailing column.
- **Optimistic UI:** Balance is server-truth; no optimistic mutation paths are added by this feature. If a future feature mutates balance, the prop revalidates via the existing `revalidatePath` flow.

## Files touched (summary)

| Layer        | File                                                     | Change                                                                                   |
| ------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Core         | `src/lib/fund-core.ts`                                   | Add `LOW_FUND_THRESHOLD`, `FundStatus`, `getFundStatus()`, `computeBalancesForMembers()` |
| UI primitive | `src/components/shared/status-badge.tsx`                 | Add `lowFund` variant + icon                                                             |
| UI primitive | `src/components/shared/fund-status-icon.tsx`             | New file                                                                                 |
| i18n         | `src/i18n/messages/vi.json`                              | Add `fundStatus.*`, `fundAdmin.filterLowFund`                                            |
| i18n         | `src/i18n/messages/en.json`, `zh.json`                   | Same keys (approximate translations)                                                     |
| Surface A    | `src/app/(admin)/admin/sessions/page.tsx`                | Bulk-load balances, pass down                                                            |
| Surface A    | `src/app/(admin)/admin/sessions/[id]/page.tsx`           | Bulk-load balances, pass down                                                            |
| Surface A    | `src/app/(admin)/admin/sessions/session-list.tsx`        | Thread prop                                                                              |
| Surface A    | `src/app/(admin)/admin/sessions/[id]/session-detail.tsx` | Thread prop                                                                              |
| Surface A    | `src/components/sessions/admin-vote-manager.tsx`         | Accept prop, render icon per row                                                         |
| Surface B    | `src/app/(admin)/admin/fund/fund-report.tsx`             | Use core `getFundStatus`, add filter                                                     |
| Surface C    | `src/app/(admin)/admin/dashboard/page.tsx`               | Extend query to lowFund                                                                  |
| Surface C    | `src/app/(admin)/admin/dashboard/dashboard-client.tsx`   | Add lowFund section                                                                      |
| Surface D    | `src/app/(admin)/admin/members/page.tsx`                 | Bulk-load balances                                                                       |
| Surface D    | `src/app/(admin)/admin/members/member-list.tsx`          | Render status badge per row                                                              |
| Surface E    | `src/components/finance/fund-balance-banner.tsx`         | Extend threshold + add lowFund variant                                                   |
| Tests        | `src/lib/__tests__/fund-core.test.ts`                    | Unit tests for new helpers                                                               |

## Approval

User confirmed approach (icon-only Approach A) and full scope (all 5 surfaces) on 2026-05-15.
