/**
 * Backfill `fund_deduction` cho admin Châu (#1) ở 4 buổi đã chốt.
 *
 * Lý do: code [finance.ts:272-273] skip admin's fund_deduction
 * (isAdminDebt ? 0 : debt.totalAmount). User quyết định: admin tính như
 * member bình thường → backfill 4 khoản trừ quỹ tương ứng với
 * `session_debts.total_amount` (đã bao gồm guest cost của khách admin).
 *
 * Idempotent: kiểm tra existing fund_deduction theo (sessionId, debtId) trước
 * khi insert.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DRY_RUN = process.argv.includes("--dry");
const ADMIN_MEMBER_ID = 1; // Châu

console.log(`\nMode: ${DRY_RUN ? "DRY RUN" : "EXECUTE"}\n`);

const debts = await client.execute({
  sql: `SELECT sd.id AS debt_id, sd.session_id, s.date, sd.total_amount
        FROM session_debts sd
        JOIN sessions s ON s.id = sd.session_id
        WHERE sd.member_id = ?
        ORDER BY s.date`,
  args: [ADMIN_MEMBER_ID],
});

const fmt = (n) => Number(n).toLocaleString("vi-VN") + " đ";

console.log(`Châu (#${ADMIN_MEMBER_ID}) có ${debts.rows.length} debt rows đã chốt:\n`);
let totalAmount = 0;
const toInsert = [];

for (const r of debts.rows) {
  const sessionId = Number(r.session_id);
  const debtId = Number(r.debt_id);
  const amount = Number(r.total_amount);

  // Check if a fund_deduction already exists for this debtId (active, not reversed)
  const existing = await client.execute({
    sql: `SELECT ft.id
          FROM financial_transactions ft
          WHERE ft.member_id = ?
            AND ft.session_id = ?
            AND ft.debt_id = ?
            AND ft.type = 'fund_deduction'
            AND ft.reversal_of_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM financial_transactions r WHERE r.reversal_of_id = ft.id
            )`,
    args: [ADMIN_MEMBER_ID, sessionId, debtId],
  });

  if (existing.rows.length > 0) {
    console.log(`  ✓ ${r.date}  debt#${debtId}  ${fmt(amount).padStart(11)}  (ĐÃ có fund_deduction #${existing.rows[0].id})`);
  } else {
    console.log(`  → ${r.date}  debt#${debtId}  ${fmt(amount).padStart(11)}  (sẽ insert)`);
    toInsert.push({ sessionId, debtId, amount, date: String(r.date) });
    totalAmount += amount;
  }
}

console.log(`\nSẽ insert ${toInsert.length} fund_deduction cho Châu, tổng ${fmt(totalAmount)}`);

if (DRY_RUN || toInsert.length === 0) {
  if (DRY_RUN) console.log("DRY RUN — không thay đổi DB.");
  process.exit(0);
}

const now = new Date().toISOString().replace("T", " ").slice(0, 19);

for (const t of toInsert) {
  const idempKey = `backfill-admin-deduction-${t.sessionId}-${ADMIN_MEMBER_ID}-${t.debtId}`;
  await client.execute({
    sql: `INSERT INTO financial_transactions
          (type, direction, amount, member_id, session_id, debt_id,
           description, idempotency_key, created_at)
          VALUES ('fund_deduction', 'out', ?, ?, ?, ?,
                  ?, ?, ?)`,
    args: [
      t.amount,
      ADMIN_MEMBER_ID,
      t.sessionId,
      t.debtId,
      `Trừ quỹ buổi ${t.date}`,
      idempKey,
      now,
    ],
  });
  console.log(`  ✓ ${t.date}  inserted fund_deduction ${fmt(t.amount)}`);
}

console.log(`\n✅ Backfill xong ${toInsert.length} khoản (${fmt(totalAmount)})`);

const bal = await client.execute({
  sql: `SELECT
          COALESCE(SUM(CASE
            WHEN ft.reversal_of_id IS NOT NULL THEN 0
            WHEN ft.id IN (SELECT reversal_of_id FROM financial_transactions WHERE reversal_of_id IS NOT NULL AND member_id = ?) THEN 0
            WHEN ft.type = 'fund_contribution' THEN ft.amount
            WHEN ft.type = 'fund_deduction' THEN -ft.amount
            WHEN ft.type = 'fund_refund' THEN -ft.amount
            ELSE 0
          END), 0) AS balance
        FROM financial_transactions ft
        WHERE ft.member_id = ?`,
  args: [ADMIN_MEMBER_ID, ADMIN_MEMBER_ID],
});
console.log(`\nSố dư mới của Châu: ${fmt(bal.rows[0].balance)}`);

process.exit(0);
