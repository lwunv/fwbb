-- Hot-path balance query optimization.
--
-- Canonical reads in finance code (computeBalanceFromTransactions,
-- fund-core, finance-summary) filter by (memberId + type bucket) and order
-- by createdAt. With only single-column indexes on memberId, type, and
-- createdAt separately, SQLite picks one and table-scans the rest — cost
-- grows linearly with ledger row count. This composite index covers the
-- common access pattern.
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_member_type_created`
  ON `financial_transactions` (`member_id`, `type`, `created_at`);
