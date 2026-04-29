/**
 * Build a fresh in-memory libsql Drizzle client for integration tests.
 * Applies all migration SQL files in order so the schema matches production.
 *
 * Usage:
 *   const { db, client } = await createTestDb();
 *   // ... test work ...
 *   client.close();
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function createTestDb() {
  // libsql `:memory:` gives each connection its own database, so a
  // `db.transaction()` (which opens a new connection) wouldn't see tables
  // created on the outer connection. Use a unique on-disk file in tmpdir so
  // all connections share state. Vitest worker process exits clean up tmpdir.
  const dir = mkdtempSync(join(tmpdir(), "fwbb-test-"));
  const dbPath = join(dir, "test.db");
  const client = createClient({ url: `file:${dbPath.replace(/\\/g, "/")}` });
  const db = drizzle(client, { schema });
  // Best-effort: remove the dir at process exit (in-memory was already best-effort).
  process.once("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // Apply migrations in lexical order (0000_, 0001_, ...).
  const sqlFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of sqlFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Drizzle uses `--> statement-breakpoint` to delimit statements.
    const statements = sql
      .split(/--> statement-breakpoint/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.execute(stmt);
    }
  }

  return { db, client };
}
