# Financial Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fund-only transactions with a single append-only financial ledger for all money events.

**Architecture:** Add `financialTransactions` as the source of truth for fund balance and payment audit trails. Keep `paymentNotifications` as the raw bank inbox, link classified notifications into ledger rows, and leave `sessionDebts` as the current payable state.

**Tech Stack:** Next.js 16 server actions, Drizzle ORM, Turso SQLite, Vitest.

---

### Task 1: Schema And Types

**Files:**

- Modify: `src/db/schema.ts`
- Generate: `src/db/migrations/*`

- [ ] Fix `src/actions/finance.ts` imports so typecheck can parse the repo.
- [ ] Replace `fundTransactions` with `financialTransactions` in schema.
- [ ] Add nullable references for `memberId`, `sessionId`, `debtId`, `paymentNotificationId`, and `inventoryPurchaseId`.
- [ ] Add integer `amount`, text `direction`, text `type`, optional `description`, optional `metadataJson`, optional `reversalOfId`, and `createdAt`.
- [ ] Generate a Drizzle migration. Old dev data does not need to be preserved.

### Task 2: Ledger Helpers

**Files:**

- Create: `src/lib/financial-ledger.ts`
- Modify: `src/lib/fund-core.ts`
- Modify: `src/lib/fund-calculator.ts`

- [ ] Add typed transaction constants and a `recordFinancialTransaction()` helper.
- [ ] Update fund balance calculation to read only `financialTransactions` where type is fund contribution, deduction, or refund.
- [ ] Keep all VND amounts as integers and reject negative transaction amounts.

### Task 3: Finance Flows

**Files:**

- Modify: `src/actions/finance.ts`
- Modify: `src/actions/fund.ts`
- Modify: `src/lib/payment-matcher.ts`
- Modify: `src/actions/inventory.ts`

- [ ] Record ledger rows when debts are created, confirmed by member, confirmed by admin, undone, deducted from fund, contributed to fund, refunded, matched from bank, and inventory purchases are recorded.
- [ ] Keep `sessionDebts` as current state, but ledger rows as history.
- [ ] Revalidate affected finance/fund/debt/history routes.

### Task 4: Tests And Verification

**Files:**

- Modify/create relevant `*.test.ts`

- [ ] Update tests for ceil-to-1K rounding.
- [ ] Add fund balance tests using ledger-style transactions.
- [ ] Run `pnpm exec tsc --noEmit --pretty false`.
- [ ] Run focused Vitest tests for fund/cost/payment logic.
