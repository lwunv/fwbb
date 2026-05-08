/**
 * Pre-flight check trước khi apply migration 0004 (UNIQUE on sessions.date,
 * UNIQUE on members.bank_account_no). Nếu DB có duplicate, migration sẽ
 * fail với SQLITE_CONSTRAINT — script này phát hiện trước để admin xử lý.
 *
 * Usage: node scripts/check-migration-0004-safety.mjs
 *
 * Exit 0 nếu safe, exit 1 nếu phát hiện duplicates.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing");
  process.exit(1);
}

const client = createClient({ url, authToken });

let hasDuplicates = false;

console.log("\n=== Migration 0004 safety check ===");
console.log(`DB: ${url}\n`);

// Check 1: sessions.date duplicates
const sessionsDup = await client.execute(`
  SELECT date, COUNT(*) as count, GROUP_CONCAT(id) as ids
  FROM sessions
  GROUP BY date
  HAVING COUNT(*) > 1
  ORDER BY date DESC
`);
if (sessionsDup.rows.length > 0) {
  hasDuplicates = true;
  console.log(`❌ sessions.date duplicates: ${sessionsDup.rows.length} dates`);
  for (const row of sessionsDup.rows) {
    console.log(`   ${row.date}: ${row.count} rows (ids: ${row.ids})`);
  }
} else {
  console.log("✅ sessions.date: no duplicates");
}

// Check 2: members.bank_account_no duplicates (NULL is OK)
const bankDup = await client.execute(`
  SELECT bank_account_no, COUNT(*) as count, GROUP_CONCAT(id) as ids,
         GROUP_CONCAT(name, '|') as names
  FROM members
  WHERE bank_account_no IS NOT NULL AND bank_account_no != ''
  GROUP BY bank_account_no
  HAVING COUNT(*) > 1
`);
if (bankDup.rows.length > 0) {
  hasDuplicates = true;
  console.log(
    `\n❌ members.bank_account_no duplicates: ${bankDup.rows.length} accounts`,
  );
  for (const row of bankDup.rows) {
    console.log(
      `   ${row.bank_account_no}: ${row.count} members (ids ${row.ids}: ${row.names})`,
    );
  }
} else {
  console.log("✅ members.bank_account_no: no duplicates");
}

// Check 3: dangling matchedTransactionId refs (would fail FK)
const danglingTx = await client.execute(`
  SELECT pn.id as notif_id, pn.matched_transaction_id
  FROM payment_notifications pn
  LEFT JOIN financial_transactions ft ON pn.matched_transaction_id = ft.id
  WHERE pn.matched_transaction_id IS NOT NULL AND ft.id IS NULL
`);
if (danglingTx.rows.length > 0) {
  console.log(
    `\n⚠ payment_notifications dangling matched_transaction_id refs: ${danglingTx.rows.length}`,
  );
  console.log(
    "   (FK enforcement OFF by default in libsql — won't block migration but should clean up)",
  );
  for (const row of danglingTx.rows) {
    console.log(
      `   notif ${row.notif_id} → missing tx ${row.matched_transaction_id}`,
    );
  }
} else {
  console.log("✅ payment_notifications matched_transaction_id: no dangling refs");
}

console.log("\n=== Result ===");
if (hasDuplicates) {
  console.log(
    "❌ NOT SAFE TO MIGRATE — fix duplicates above before running apply-migration.mjs",
  );
  client.close();
  process.exit(1);
} else {
  console.log("✅ SAFE TO MIGRATE — proceed with: node scripts/apply-migration.mjs");
  client.close();
  process.exit(0);
}
