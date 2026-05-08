/**
 * Verify migration 0004 đã apply xong: UNIQUE indexes + FK reference.
 * Usage: node scripts/verify-migration-0004.mjs
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient({ url, authToken });

let ok = true;

// Check sessions.date UNIQUE INDEX
const sessIdx = await client.execute(
  "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='sessions' AND name='idx_sessions_date'",
);
if (sessIdx.rows.length === 1 && /UNIQUE/i.test(String(sessIdx.rows[0].sql))) {
  console.log("✅ sessions.date is UNIQUE");
} else {
  ok = false;
  console.log("❌ sessions.date NOT UNIQUE:", sessIdx.rows[0]?.sql ?? "missing");
}

// Check members.bank_account_no UNIQUE INDEX
const bankIdx = await client.execute(
  "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='members' AND name LIKE '%bank_account_no%'",
);
if (bankIdx.rows.length >= 1 && /UNIQUE/i.test(String(bankIdx.rows[0].sql))) {
  console.log("✅ members.bank_account_no is UNIQUE:", bankIdx.rows[0].name);
} else {
  ok = false;
  console.log("❌ members.bank_account_no NOT UNIQUE");
}

// Check payment_notifications.matched_transaction_id has FK
const pnSchema = await client.execute(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='payment_notifications'",
);
const pnSql = String(pnSchema.rows[0]?.sql ?? "");
if (/matched_transaction_id[^,]*REFERENCES\s+financial_transactions/i.test(pnSql)) {
  console.log("✅ payment_notifications.matched_transaction_id has FK");
} else {
  ok = false;
  console.log("❌ payment_notifications.matched_transaction_id NO FK");
}

console.log(`\n${ok ? "✅ All migration 0004 checks passed" : "❌ Some checks failed"}`);
client.close();
process.exit(ok ? 0 : 1);
