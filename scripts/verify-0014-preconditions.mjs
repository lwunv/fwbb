/**
 * Read-only pre-flight check for migration 0014 against PROD (Turso).
 * Runs only SELECT COUNT(*) — never writes, never reads PII. If every count is
 * 0, migration 0014 (FK + CHECK + NOT NULL) will apply without violating any
 * existing row. Any non-zero count = prod data must be cleaned BEFORE applying.
 *
 *   node scripts/verify-0014-preconditions.mjs
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing in .env.local");
  process.exit(1);
}
const db = createClient({ url, authToken });

const checks = [
  ["amount < 0 (financial_transactions)", `SELECT COUNT(*) AS n FROM financial_transactions WHERE amount < 0`],
  ["tubes < 1 (inventory_purchases)", `SELECT COUNT(*) AS n FROM inventory_purchases WHERE tubes < 1`],
  ["price/total < 0 (inventory_purchases)", `SELECT COUNT(*) AS n FROM inventory_purchases WHERE price_per_tube < 0 OR total_price < 0`],
  ["quantity_used < 1 (session_shuttlecocks)", `SELECT COUNT(*) AS n FROM session_shuttlecocks WHERE quantity_used < 1`],
  ["is_active IS NULL (members)", `SELECT COUNT(*) AS n FROM members WHERE is_active IS NULL`],
  ["approval_status IS NULL (members)", `SELECT COUNT(*) AS n FROM members WHERE approval_status IS NULL`],
  [
    "dangling payment_notification_id",
    `SELECT COUNT(*) AS n FROM financial_transactions ft
       WHERE ft.payment_notification_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM payment_notifications pn WHERE pn.id = ft.payment_notification_id)`,
  ],
  [
    "dangling reversal_of_id",
    `SELECT COUNT(*) AS n FROM financial_transactions ft
       WHERE ft.reversal_of_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM financial_transactions o WHERE o.id = ft.reversal_of_id)`,
  ],
];

let total = 0;
console.log(`\nPre-flight for migration 0014 against: ${url}\n`);
for (const [label, sql] of checks) {
  const r = await db.execute(sql);
  const n = Number(r.rows[0].n);
  total += n;
  console.log(`${n === 0 ? "✓" : "✗"}  ${label}: ${n}`);
}
console.log(`\n${total === 0 ? "ALL CLEAR — 0014 safe to apply to prod." : `BLOCKED — ${total} violating rows; clean before applying.`}\n`);
process.exit(total === 0 ? 0 : 1);
