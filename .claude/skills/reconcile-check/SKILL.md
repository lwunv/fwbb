---
name: reconcile-check
description: Run the money-integrity checks (reconcile + deep integrity + balance-vs-CSV) and summarize. Use to validate the fund ledger invariant I8 after finance changes.
---

# reconcile-check

Three read-only checker scripts that validate the FWBB fund ledger against its invariants (I1–I10), surface orphan/dangling rows, and compare live balances to a frozen spreadsheet snapshot. Run them after any change to finance code (`finalizeSession`, `recordContribution`, `recordRefund`, `confirmPayment*`, `deleteSession`, `mergeMember`, `reconcile-fund.ts`).

## ⚠️ Read before running

**All scripts hit PRODUCTION.** They read `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` from `.env.local`, which points at the live prod Turso DB (`libsql://fwbb-lwcifer.aws-ap-northeast-1.turso.io`). There is no local-DB mode. The three checkers below are **strictly read-only** (every statement is a bare `SELECT`, no INSERT/UPDATE/DELETE, no file output) so they are safe to run unattended, but they do read real member PII and balances.

`backup-db.mjs` (optional, last section) is read-only on the DB but **writes a plaintext-PII JSON file to disk** — treat it as a side-effecting command and only run it when you actually want a snapshot.

## Run order

Run all three from the repo root (`d:/Lwcifer/LW/FWBB`). They are independent and read-only, so order does not affect correctness, but this order goes from the core invariant check outward:

```bash
node scripts/run-reconcile.mjs
node scripts/db-integrity-deep.mjs
node scripts/check-fund-balance-vs-csv.mjs
```

---

## 1. `run-reconcile.mjs` — the invariant check (incl. I8)

**Invocation:** `node scripts/run-reconcile.mjs` (no flags, no args).

**What it verifies:** Standalone re-implementation of the reconcile checks in `src/actions/reconcile-fund.ts`, run directly against the DB (bypasses auth). It pulls fund transactions, payment notifications, members, debt-scoped txs, and reversals (reversal pairs are excluded from sums), then evaluates:

- **I1** — aggregate net (`totalIn − totalOut − totalRefund`) must equal Σ per-member balances. (error)
- **I3** — matched notification with no backing tx. (warn)
- **I4** — tx references a missing notification. (error)
- **I5** — amount must be a non-negative integer. (error)
- **I6** — duplicate `idempotency_key`. (error)
- **I7** — debt-scoped tx points at a missing `session_debts` row. (warn)
- **I8** — a `bank_payment_received` debt must have **both** `member_confirmed` and `admin_confirmed` true. (error)
- **I9** — reversal points at a missing original tx. (warn)

**Mutates?** **READ-ONLY.** Only `SELECT`, no writes, no file output. Targets prod Turso.

**Output:** `=== Reconcile Report ===` with an ISO timestamp; a Totals block (`totalIn`, `totalOut`, `totalRefund`, `netInternal`, `Σ(positive)`, `Σ(negative)`, `netByMembers`, all `vi-VN` formatted); Notifications counts (matched / pending / matchedWithoutTx / txMissingNotif); Debt-ledger counts (orphanDebtRefs / bankPaidPartial / orphanReversals); a per-member balance list sorted ascending (name padded, signed amount); then `=== N ERROR(s), M WARN(s) ===` followed by one `[SEVERITY] CODE: message` line per issue.

**Exit code — this matters:**

- `0` = clean (no error-severity issues).
- `1` = invariant errors found. **This is a finding, not a tool failure.** Read the `[ERROR]` lines.
- `2` = uncaught exception (the script actually broke — check env/connectivity).

---

## 2. `db-integrity-deep.mjs` — orphan / dangling-FK / data-sanity

**Invocation:** `node scripts/db-integrity-deep.mjs` (no flags, no args).

**What it verifies:** 20 checks across the schema, each a `SELECT`. Highlights: orphan `session_attendees` (missing member / invitedBy), orphan `session_debts` / `session_shuttlecocks` / `financial_transactions` referencing missing sessions, guest/inviter ambiguity, `session_debts` with NULL `session_id`, completed sessions with no debts or no `fund_deduction` (broken finalize), fund-deduction `debt_id` orphans, admin-row consistency, large negative `stock_adjust_qua`, non-positive shuttlecock qty/price, admin-guest sessions missing the Châu (`member_id=1`) debt row, a fund total-by-type aggregate, sessions with no `court_id`, and `court_rent_payments` with non-positive amount or missing `bucket` metadata. Findings are tagged ERROR / WARN / NOTE.

**Mutates?** **READ-ONLY.** All `SELECT`; only `console.log`. No file output. Targets prod Turso.

**Output:** First `=== Fund total by type (excluding reversal pairs) ===` (one line per type, `vi-VN` + "đ"). Then `=== DB Integrity Findings ===`: if clean, `✅ No issues found.`; otherwise per finding a `[SEV] message` line plus indented detail rows (most checks cap detail at the first 5 rows).

**Exit code:** No explicit `process.exit` — exits `0` on normal completion regardless of findings (non-zero only if it throws). Unlike `run-reconcile`, it does **not** signal "errors found" via exit code, so **scan stdout for `[ERROR]`** to know whether problems exist.

---

## 3. `check-fund-balance-vs-csv.mjs` — live balances vs frozen spreadsheet

**Invocation:** `node scripts/check-fund-balance-vs-csv.mjs` (no flags, no args).

**What it verifies:** Reconciles a hard-coded expected table (28 members with contrib/spent/balance, baked into the script as the `expected` array, transcribed from a spreadsheet) against live DB balances. Loads members (id/name/nickname/is_active), all `member_id`-scoped `financial_transactions`, and session dates; excludes reversal pairs; sums per member into `{contrib, deduct, refund}` where `balance = contrib − deduct − refund`. Fuzzy-matches each CSV row to a member by exact name/nickname then substring. For any mismatch it lists that member's live `fund_deduction` rows (date + amount + description) to help locate the discrepancy, and also lists active DB members not in the CSV but with activity.

**Mutates?** **READ-ONLY.** All `SELECT`; no writes, no file output. The "CSV" is literal data inside the file, not an external file read. Targets prod Turso.

**Output:** `=== TỔNG QUAN — CSV vs DB ===` — a box-drawing table (Member, Nộp CSV, Nộp DB, Chi CSV, Chi DB, Dư CSV, Dư DB, Δ Bal), `✓` where balance matches else the signed diff, `❌ KHÔNG TÌM THẤY` for unmatched aliases. Then `=== CHI TIẾT LỆCH ===` per-member breakdowns with the deduction list, `=== Member active trong DB nhưng KHÔNG có trong CSV ===`, and a final tally `Tổng: N dòng CSV, X khớp, Y lệch.`

**Exit code:** Always `0` (mismatches are reported in text, not via exit code). **Parse the `Y lệch` tally** (and the table) to detect drift.

**Staleness caveat:** the expected numbers are a frozen snapshot. A non-zero `lệch` count can mean the DB drifted **or** that the baked-in CSV is simply out of date. Do not read mismatches here as definitive DB corruption — corroborate with script 1 (I1/I8) before concluding the ledger is broken.

---

## Interpreting results

**Clean ledger looks like:**

- `run-reconcile.mjs`: exits `0`, report ends with `=== 0 ERROR(s), ... ===`. I1 holds (`netInternal` matches `netByMembers`), no `[ERROR]` lines. Warns are tolerable but worth a glance.
- `db-integrity-deep.mjs`: `=== DB Integrity Findings ===` is followed by `✅ No issues found.` and stdout has no `[ERROR]`.
- `check-fund-balance-vs-csv.mjs`: tally reads `... X khớp, 0 lệch.` (or any `lệch` rows are explainable by a stale CSV snapshot).

**Broken ledger looks like:**

- Any `[ERROR]` line from script 1 — especially **I8** (`bank_payment_received` debt missing `member_confirmed`/`admin_confirmed`) or **I1** (aggregate net ≠ Σ member balances). I8 errors mean someone set a confirm flag without a matching ledger entry, or a bank-received tx wasn't fully confirmed — the exact invariant `reconcile-fund.ts` exists to protect. I1 errors mean money was added/removed without a balancing entry.
- Any `[ERROR]` in script 2's stdout — e.g. a completed session with no `fund_deduction` rows means `finalizeSession` ran broken.
- A `lệch` count in script 3 that can't be explained by a stale snapshot, and that lines up with an I1/I8 error from script 1.

**Summarize after running:** report each script's headline (exit code for script 1; presence of `[ERROR]` for script 2; `khớp / lệch` tally for script 3), then quote any `[ERROR]` lines verbatim. Do not call the ledger "clean" unless all three pass per the criteria above.

---

## Optional: `backup-db.mjs` (side-effecting — run only on purpose)

**Invocation:** `node scripts/backup-db.mjs` → writes `d:/tmp/fwbb-backup-<timestamp>.json`; or `node scripts/backup-db.mjs <path>` → writes to the given path (the only positional arg).

**What it does:** Introspects `sqlite_master` for all user tables (excludes `sqlite_%`, `_litestream%`, `__drizzle%`), `SELECT *` each, dumps everything to one JSON file (`meta` + `tables` map, BigInt→Number). Full snapshot for manual restore. Exits `1` early if `TURSO_DATABASE_URL` is missing.

**Mutates?** **DB is READ-ONLY.** But it `mkdirSync` + `writeFileSync` one JSON file — a filesystem side effect, not part of the integrity check.

**⚠️ PII warning (from the file's own header):** the dump is plaintext PII — names, emails, phones, bank accounts, fund balances, password hashes, OAuth ids. The default `d:/tmp` is outside the repo, so `.gitignore` does not protect it. Never commit it, keep it out of cloud-sync, and delete or encrypt it after use. Do not run this as part of routine reconcile checks; run it only when you explicitly want a backup.
