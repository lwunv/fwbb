/**
 * Destructive migration: remove phone, add facebookId/avatarUrl/email to members table.
 * Deletes all existing member data and related records.
 *
 * Usage: npx tsx src/db/migrate-fb.ts
 */
import { createClient } from "@libsql/client";
import { config } from "dotenv";
config({ path: ".env.local" });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

async function migrate() {
  console.log("Starting FB migration...");
  console.log("⚠️  This will DELETE all existing member data and related records.\n");

  // 1. Delete child rows in dependency order
  const tables = [
    "session_debts",
    "session_attendees",
    "votes",
    "session_shuttlecocks",
    "sessions",
    "members",
  ];

  for (const table of tables) {
    const result = await client.execute(`DELETE FROM ${table}`);
    console.log(`  Deleted ${result.rowsAffected} rows from ${table}`);
  }

  // 2. Alter members table
  // SQLite doesn't support DROP COLUMN well in older versions,
  // so we recreate the table

  // 2a. Create new table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS members_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      nickname TEXT,
      avatar_key TEXT,
      facebook_id TEXT NOT NULL UNIQUE,
      avatar_url TEXT,
      email TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (current_timestamp)
    )
  `);
  console.log("\n  Created members_new table");

  // 2b. Drop old table and rename
  await client.execute(`DROP TABLE IF EXISTS members`);
  await client.execute(`ALTER TABLE members_new RENAME TO members`);
  console.log("  Renamed members_new → members");

  // 2c. Create unique index
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS members_facebook_id_unique ON members (facebook_id)
  `);
  console.log("  Created facebook_id unique index");

  console.log("\n✅ Migration complete! Members table now uses facebookId instead of phone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
