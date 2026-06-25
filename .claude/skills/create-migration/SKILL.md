---
name: create-migration
description: Create a Drizzle+Turso DB migration safely. Use when adding/altering schema. Encodes DDL-only + the Turso recreate-table index-drop gotcha + post-apply index verification.
disable-model-invocation: true
---

# Create a Drizzle + Turso migration (FWBB)

Safe procedure for adding/altering schema in FWBB. The DB is Drizzle ORM on Turso (libsql/SQLite). The schema in `src/db/schema.ts` is the source; migrations are generated from its diff, then **hand-reviewed**, backed up, applied, and **verified**.

> This skill has DB side effects (it applies migrations to a live DB). It is user-invoked only.

There is **no `db:migrate` script** and **no `drizzle-kit migrate`** in this repo — they hang on libsql with partial UNIQUE indexes. The real applier is the hand-rolled `scripts/apply-migration.mjs`. Ignore any doc that says `pnpm db:migrate` (only a stale design doc mentions it).

Package manager is **pnpm**. Run every command from the repo root `d:\Lwcifer\LW\FWBB`.

---

## The one gotcha that bites: recreate-table drops indexes

When a migration recreates a table (`CREATE __new_x` → `INSERT ... SELECT` → `DROP x` → `RENAME __new_x TO x`), Turso silently drops **every index** attached to the old table. drizzle-kit emits the `CREATE INDEX` statements **before** the DROP+RENAME, so the new indexes get destroyed along with the old table. Queries keep "working" (just unindexed, and worse: any UNIQUE guard is gone).

The one that matters most: `idx_financial_transactions_idempotency_key` (partial UNIQUE). Lose it and duplicate money writes can slip through — it's the last line of defence on financial transactions.

So: after `db:generate`, you **must** hand-edit any recreate-table migration to move index creates **after** the `RENAME`, and after apply you **must** prove the indexes came back by querying `sqlite_master` on the live DB.

---

## Step-by-step

### 1. Back up prod first (always)

```bash
node scripts/backup-db.mjs        # read-only; dumps every table → d:/tmp/fwbb-backup-<ts>.json
```

`backup-db.mjs` reads `.env.local` only. To back up **prod**, point `.env.local` at prod creds first (or run with prod values in the environment), then run it.

### 2. Edit the schema

Edit `src/db/schema.ts`. The Drizzle schema is the source of truth — never hand-write the migration first.

### 3. Generate the migration SQL

```bash
pnpm db:generate                  # = drizzle-kit generate
```

Writes a new `src/db/migrations/NNNN_<name>.sql` and appends an entry to `src/db/migrations/meta/_journal.json`.

Config (`drizzle.config.ts`): `schema: ./src/db/schema.ts`, `out: ./src/db/migrations`, `dialect: "turso"`, creds from `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`, loads `.env.local`.

### 4. Review the generated SQL — DDL ONLY (mandatory)

Open the new `src/db/migrations/NNNN_*.sql` and check it by hand:

- **DDL only.** `CREATE/ALTER/DROP TABLE`, `CREATE/DROP INDEX`, FK retrofits, CHECK constraints, PRAGMA. Nothing else.
- **NO seed / NO business-data INSERT.** Seeding never goes in a migration (it would re-run / double-insert on a re-apply). Seed via the separate `pnpm db:seed` (`tsx src/db/seed.ts`) or a dedicated `scripts/*.mjs` (e.g. `seed-fresh.mjs`).
- The ONLY in-migration `INSERT`/`UPDATE` allowed is **data-preserving plumbing**, not seeding:
  - `INSERT INTO __new_x (...) SELECT ... FROM x` — copying existing rows into a rebuilt table (see 0011, 0014).
  - A targeted backfill to satisfy a new NOT-NULL/UNIQUE invariant, e.g. 0011's `UPDATE financial_transactions SET idempotency_key = 'legacy-tx-' || id WHERE idempotency_key IS NULL` before enforcing NOT NULL. That makes old rows valid for the new constraint — it is not new business data.

**If it is a recreate-table migration, ALSO fix these by hand (see step 5).**

### 5. Hand-edit recreate-table migrations (the gotcha fix)

For any diff that rebuilds a table, before applying:

1. **Wrap the recreate dance in FK toggles** so the INSERT/DROP/RENAME doesn't trip live FK enforcement (`db/index.ts` sets `PRAGMA foreign_keys=ON`):

   ```sql
   PRAGMA foreign_keys=OFF;
   --> statement-breakpoint
   ... CREATE __new_x / INSERT SELECT / DROP x / RENAME __new_x TO x ...
   --> statement-breakpoint
   PRAGMA foreign_keys=ON;
   ```

   Both 0011 and 0014 do this.

2. **Move every index `CREATE` to AFTER `ALTER TABLE __new_x RENAME TO x`.** drizzle-kit emits them before the DROP+RENAME, so they'd be lost with the old table. 0014 has the hand-written precedent at the `financial_transactions` block:
   > "Recreate financial_transactions indexes AFTER the table recreate. drizzle-kit emitted these before the DROP+RENAME above, so they would have been lost with the old table (incl. the critical idempotency_key UNIQUE). Moved here by hand."

### 6. Apply to local/dev

```bash
node scripts/apply-migration.mjs              # default env = .env.local = dev
```

What it does: ensures `__drizzle_migrations` exists, reads applied hashes, iterates `meta/_journal.json` entries in order, and for each unapplied `<tag>.sql` splits on `--> statement-breakpoint` and runs statements **one at a time** (not in one transaction — some libsql DDL won't run inside a tx). It swallows `already exists` / `duplicate column` errors so a partial migration can be re-run; any other error aborts. On success it records the file's sha256. **Idempotent — safe to re-run.**

### 7. Apply to prod (explicit flag, confirm first)

```bash
node scripts/apply-migration.mjs --env=.env.prod
```

`apply-migration.mjs` is the only one of the three scripts that takes `--env=<path>`. Default (no flag) is `.env.local`. Pass `--env=.env.prod` to hit production. This mutates prod — do it deliberately, after the backup in step 1.

### 8. Verify the schema + indexes survived

```bash
node scripts/verify-migration.mjs             # exit 0 = pass, 1 = SOME CHECKS FAILED
```

`verify-migration.mjs` runs 6 hard-coded smoke checks against `sqlite_master` / `pragma_table_info` (so it asks the live DB "does this object actually exist?"):

- Tables: `rate_limit_buckets`.
- Columns: `idempotency_key` on `financial_transactions`; `pass_revenue` on `sessions`; `price_per_session_retail` on `courts`.
- Indexes: `idx_financial_transactions_idempotency_key`, `idx_rate_limit_buckets_reset_at`.

It reads `.env.local` only (no `--env` flag). To verify **prod**, point `.env.local` at prod creds first.

### 9. CRITICAL: prove every recreate-table index came back

The script's list is **not exhaustive** — treat it as a smoke test. After ANY recreate-table migration, query `sqlite_master` directly on the **live prod DB** for every index that belongs on each rebuilt table:

```sql
SELECT name, sql FROM sqlite_master
WHERE type='index' AND tbl_name='financial_transactions'
ORDER BY name;
```

- For `financial_transactions` expect 6 rows. Confirm `idx_financial_transactions_idempotency_key` is present AND its `sql` still has the partial `WHERE ... idempotency_key IS NOT NULL` clause.
- Repeat per recreated table, e.g.:
  - `votes` → `votes_session_member_idx`
  - `session_debts` → `debts_session_member_idx`
  - `sessions` → `idx_sessions_date`
  - `payment_notifications` → `payment_notifications_gmail_message_id_unique`
- Verify against **prod**, not just local. Turso has DDL replication lag on top of the drizzle-kit emit-order bug — if a just-created index doesn't show up, wait a moment and re-query before concluding it was dropped.

---

## Checklist

- [ ] Backed up prod (`node scripts/backup-db.mjs`) before touching anything.
- [ ] Edited `src/db/schema.ts` (schema is the source; didn't hand-write SQL first).
- [ ] Ran `pnpm db:generate`.
- [ ] Reviewed the generated `.sql`: DDL only, no seed/business INSERT.
- [ ] Recreate-table? Wrapped in `PRAGMA foreign_keys=OFF/ON` and moved all `CREATE INDEX` to after the `RENAME`.
- [ ] Applied to local (`node scripts/apply-migration.mjs`) and it passed.
- [ ] Applied to prod (`node scripts/apply-migration.mjs --env=.env.prod`) deliberately.
- [ ] Ran `node scripts/verify-migration.mjs` (exit 0).
- [ ] Queried `sqlite_master` on prod for every index of each recreated table, incl. the partial UNIQUE `idx_financial_transactions_idempotency_key`.

---

## When NOT to hand-edit migration SQL

- **Don't hand-edit non-recreate diffs.** Plain `ALTER TABLE ADD COLUMN` / `CREATE INDEX` / `CREATE TABLE` migrations are emitted correctly — leave them as generated. Hand-editing is only for the recreate-table dance (reorder indexes after RENAME, wrap in FK toggles) and the data-preserving backfill described in step 4.
- **Don't add seed/business data** to a migration to "save a step." Use `pnpm db:seed` (`tsx src/db/seed.ts`) or `scripts/seed-fresh.mjs`. Seeding stays out of the migration chain so it never double-inserts on re-apply.
- **Don't change an already-applied migration file's contents.** The applier keys on the file's sha256 — editing an applied `.sql` changes its hash and it will try to re-run. To change schema, generate a NEW migration.
- **Don't reach for `pnpm db:push` (`drizzle-kit push`) to change prod.** It shoves the diff straight to the DB with no migration file, skipping the journal AND the hand index-reordering — so it can silently drop the very indexes this skill protects. Use it only against a throwaway local DB.

---

## Files (absolute)

- `d:\Lwcifer\LW\FWBB\drizzle.config.ts`
- `d:\Lwcifer\LW\FWBB\package.json`
- `d:\Lwcifer\LW\FWBB\scripts\backup-db.mjs`
- `d:\Lwcifer\LW\FWBB\scripts\apply-migration.mjs`
- `d:\Lwcifer\LW\FWBB\scripts\verify-migration.mjs`
- `d:\Lwcifer\LW\FWBB\src\db\schema.ts`
- `d:\Lwcifer\LW\FWBB\src\db\migrations\` (and `meta\_journal.json`)
- Precedents: `0011_fk_retrofit_and_invariants.sql`, `0014_hardening_fk_check_notnull.sql`
