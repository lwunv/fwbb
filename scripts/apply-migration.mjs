/**
 * Apply pending migrations to Turso production manually.
 *
 * Drizzle-kit migrate hangs sometimes (libsql + partial UNIQUE INDEX).
 * This script:
 *   1. Reads __drizzle_migrations to see what's already applied (creates table if missing).
 *   2. Reads journal entries from src/db/migrations/meta/_journal.json.
 *   3. Applies any unapplied migration SQL files, statement-by-statement.
 *   4. Records the hash + tag in __drizzle_migrations to keep journal in sync.
 *
 * Idempotent: safe to re-run. "Already applied" is matched on the file hash
 * in either LF or CRLF form (see migration-hash.mjs).
 *
 * Usage: node scripts/apply-migration.mjs --env=<file> [--dry-run]
 *   --env=<file>  REQUIRED. The default used to be .env.local (= PROD), which
 *                 is too dangerous to leave implicit.
 *   --dry-run     Print applied / WOULD APPLY per migration and execute
 *                 nothing. The only statement run is CREATE TABLE IF NOT
 *                 EXISTS __drizzle_migrations (a no-op when it exists).
 */

import { config } from "dotenv";
const envArg = process.argv.find((a) => a.startsWith("--env="));
const envPath = envArg ? envArg.slice("--env=".length) : "";
const dryRun = process.argv.includes("--dry-run");
if (!envPath) {
  console.error(
    "Missing --env=<file>. Refusing to guess a database: pass the env file explicitly (e.g. --env=.env.prod).",
  );
  process.exit(1);
}
// processEnv: {} keeps dotenv from touching process.env, so the target comes
// only from the --env file and shell-exported prod vars can never win.
const dotenvResult = config({ path: envPath, processEnv: {} });
console.log(`Loaded env from ${envPath}`);

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isMigrationApplied,
  recordHash,
  resolveMigrationTarget,
} from "./migration-hash.mjs";

let target;
try {
  target = resolveMigrationTarget(dotenvResult, envPath);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { url, authToken } = target;
console.log(`Target database: ${target.label}`);

const client = createClient({ url, authToken });

const MIGRATIONS_DIR = join(process.cwd(), "src/db/migrations");
const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
);

// Drizzle's bookkeeping table — same name it uses internally.
await client.execute(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash text NOT NULL,
    created_at numeric
  )
`);

const appliedRows = await client.execute(
  "SELECT hash FROM __drizzle_migrations",
);
const appliedHashes = new Set(appliedRows.rows.map((r) => r.hash));

console.log(`Found ${appliedHashes.size} previously-applied migrations`);

for (const entry of journal.entries) {
  const sqlPath = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
  const sql = readFileSync(sqlPath, "utf8");

  if (isMigrationApplied(sql, appliedHashes)) {
    console.log(`  ✓ ${entry.tag} (already applied)`);
    continue;
  }

  if (dryRun) {
    console.log(`  → ${entry.tag} (WOULD APPLY)`);
    continue;
  }

  console.log(`  → ${entry.tag} (applying...)`);
  const statements = sql
    .split(/--> statement-breakpoint/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Apply statement-by-statement; record bookkeeping at the end.
  // We can't wrap the whole thing in a transaction because some libsql
  // DDL doesn't play nice inside transactions, so we do it sequentially.
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (err) {
      // If the migration was partially applied earlier (e.g., the column
      // exists already but the index doesn't), tolerate "already exists"
      // errors and keep going. Re-throw anything else.
      const msg = (err && err.message) || String(err);
      const idempotent =
        msg.includes("already exists") ||
        msg.includes("duplicate column") ||
        msg.includes("duplicate column name");
      if (!idempotent) {
        console.error(`    ✗ statement failed: ${stmt.slice(0, 80)}…`);
        console.error(`    ${msg}`);
        throw err;
      }
      console.log(`    (skipped — already exists: ${msg.slice(0, 60)})`);
    }
  }

  await client.execute({
    sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    args: [recordHash(sql), Date.now()],
  });
  console.log(`  ✓ ${entry.tag} applied`);
}

console.log(
  dryRun ? "\nDry run: nothing was executed." : "\nAll migrations up to date.",
);
client.close();
