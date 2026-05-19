/**
 * Fix double-charge buổi 27/4: 12 member có cả "manual 61K Tiền chơi cầu 27/4"
 * + session #9 (60K) → bị trừ thừa 61K mỗi người. Khoản đúng là 60K (session 9).
 *
 * Reverse 12 khoản manual bằng pattern chuẩn:
 *   insert fund_contribution direction=in amount=61K reversalOfId=<original>
 *
 * Idempotent: nếu đã reverse rồi (có row reversalOfId trỏ về original) thì skip.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DRY_RUN = process.argv.includes("--dry");

// 1) Find manual entries
const originals = await client.execute(`
  SELECT ft.id, ft.member_id, ft.amount, ft.description, ft.created_at, m.name
  FROM financial_transactions ft
  JOIN members m ON m.id = ft.member_id
  WHERE ft.description = 'Tiền chơi cầu 27/4'
    AND ft.type = 'fund_deduction'
    AND ft.reversal_of_id IS NULL
  ORDER BY m.name
`);

console.log(`\nMode: ${DRY_RUN ? "DRY RUN (không ghi DB)" : "EXECUTE"}\n`);
console.log(`Tìm thấy ${originals.rows.length} khoản manual "Tiền chơi cầu 27/4":\n`);

const fmt = (n) => Number(n).toLocaleString("vi-VN") + " đ";

let totalAmount = 0;
let willReverseCount = 0;
let alreadyReversed = 0;
const toReverse = [];

for (const row of originals.rows) {
  // Check if already reversed
  const existing = await client.execute({
    sql: "SELECT id FROM financial_transactions WHERE reversal_of_id = ?",
    args: [row.id],
  });
  if (existing.rows.length > 0) {
    console.log(`  ✓ ${String(row.name).padEnd(15)} #${row.id}  ${fmt(row.amount)}  (ĐÃ reverse trước đó)`);
    alreadyReversed++;
  } else {
    console.log(`  → ${String(row.name).padEnd(15)} #${row.id}  ${fmt(row.amount)}  (sẽ reverse)`);
    toReverse.push(row);
    totalAmount += Number(row.amount);
    willReverseCount++;
  }
}

console.log(`\nTổng: sẽ reverse ${willReverseCount} khoản = ${fmt(totalAmount)}`);
console.log(`Đã reverse trước đó: ${alreadyReversed} khoản`);

if (DRY_RUN) {
  console.log("\nDRY RUN — không thay đổi DB. Chạy không có --dry để execute.");
  process.exit(0);
}

if (toReverse.length === 0) {
  console.log("\nKhông có gì để reverse — exit.");
  process.exit(0);
}

// 2) Insert reversals
console.log("\nInserting reversals...");
const now = new Date().toISOString().replace("T", " ").slice(0, 19);

for (const r of toReverse) {
  const idempKey = `fix-double-charge-27-4-${r.id}`;
  await client.execute({
    sql: `INSERT INTO financial_transactions
          (type, direction, amount, member_id, session_id, reversal_of_id,
           description, idempotency_key, created_at)
          VALUES ('fund_contribution', 'in', ?, ?, NULL, ?,
                  'Hoàn trả khoản trùng - session 27/4 đã chốt đủ', ?, ?)`,
    args: [Number(r.amount), Number(r.member_id), Number(r.id), idempKey, now],
  });
  console.log(`  ✓ ${String(r.name).padEnd(15)} reversed ${fmt(r.amount)}`);
}

console.log(`\n✅ Hoàn tất — reverse ${toReverse.length} khoản (${fmt(totalAmount)})\n`);

// 3) Verify new balances for affected members
console.log("Số dư mới của 12 member:\n");
const memberIds = toReverse.map((r) => Number(r.member_id));
const verify = await client.execute({
  sql: `SELECT
          m.id, m.name,
          COALESCE(SUM(CASE
            WHEN ft.reversal_of_id IS NOT NULL THEN 0
            WHEN ft.id IN (SELECT reversal_of_id FROM financial_transactions WHERE reversal_of_id IS NOT NULL AND member_id = m.id) THEN 0
            WHEN ft.type = 'fund_contribution' THEN ft.amount
            WHEN ft.type = 'fund_deduction' THEN -ft.amount
            WHEN ft.type = 'fund_refund' THEN -ft.amount
            ELSE 0
          END), 0) AS balance
        FROM members m
        LEFT JOIN financial_transactions ft ON ft.member_id = m.id
        WHERE m.id IN (${memberIds.map(() => "?").join(",")})
        GROUP BY m.id, m.name
        ORDER BY m.name`,
  args: memberIds,
});
for (const r of verify.rows) {
  console.log(`  ${String(r.name).padEnd(15)}  ${fmt(r.balance)}`);
}

process.exit(0);
