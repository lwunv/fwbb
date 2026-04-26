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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function createTestDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });

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
