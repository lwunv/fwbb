/**
 * Backfill fund_deduction cho admin (Châu #1) ở 4 buổi có debt row, CHỈ tính
 * OWN play+dine (không tính admin guests). Đồng thời reverse "Hiệu chỉnh khớp
 * sổ -226K" cũ vì giờ đã có deductions tied to sessions, và bù 1 khoản nhỏ
 * -3K cho phần CSV làm tròn (29/4 và 27/4 chênh 1-2K).
 *
 * Kết quả: balance Châu vẫn = 274K (khớp CSV), LỖ giảm còn = chi phí khách
 * admin (by design).
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DRY = process.argv.includes("--dry");
const ADMIN_ID = 1; // Châu
const RUN_TAG = "2026-05-18-admin-backfill";

console.log(`\nMode: ${DRY ? "DRY RUN" : "EXECUTE"}\n`);

// 1. Find Châu's debt rows
const debts = await client.execute({
  sql: `SELECT sd.id AS debt_id, sd.session_id, s.date,
               sd.play_amount, sd.dine_amount, sd.total_amount
        FROM session_debts sd
        JOIN sessions s ON s.id = sd.session_id
        WHERE sd.member_id = ?
        ORDER BY s.date`,
  args: [ADMIN_ID],
});

const fmt = (n) => Number(n).toLocaleString("vi-VN") + " đ";

console.log("Châu debt rows (chỉ trừ play+dine, không tính guest):");
let totalOwnPlay = 0;
const toInsert = [];
for (const r of debts.rows) {
  const ownAmount = Number(r.play_amount) + Number(r.dine_amount);
  totalOwnPlay += ownAmount;
  console.log(
    `  ${r.date}  debt#${r.debt_id}  play=${fmt(r.play_amount)}  dine=${fmt(r.dine_amount)}  → trừ ${fmt(ownAmount)}`,
  );
  toInsert.push({
    sessionId: Number(r.session_id),
    debtId: Number(r.debt_id),
    amount: ownAmount,
    date: String(r.date),
  });
}
console.log(`Tổng sẽ trừ: ${fmt(totalOwnPlay)}\n`);

// 2. Find the previous Hiệu chỉnh khớp sổ for Châu (-226K)
const oldAdjust = await client.execute({
  sql: `SELECT id, amount, type
        FROM financial_transactions
        WHERE member_id = ?
          AND idempotency_key LIKE '2026-05-18-csv-sync%'
          AND reversal_of_id IS NULL`,
  args: [ADMIN_ID],
});
if (oldAdjust.rows.length !== 1) {
  console.log(`❌ Không tìm thấy đúng 1 Hiệu chỉnh khớp sổ cho Châu (found ${oldAdjust.rows.length})`);
  process.exit(1);
}
const old = oldAdjust.rows[0];
console.log(`Hiệu chỉnh cũ #${old.id}: ${old.type} ${fmt(old.amount)} → sẽ reverse`);

// 3. Compute remainder: balance hiện 274K. Sau khi reverse hiệu chỉnh cũ
// (+226K) + trừ ownPlay 223K = 274 + 226 - 223 = 277K. Cần thêm Hiệu chỉnh -3K
// để về 274K.
const oldAdjustAmount = Number(old.amount); // 226000
const remainderToAdjust = 274_000 - (500_000 - totalOwnPlay); // 274 - 277 = -3
console.log(
  `Sau khi reverse hiệu chỉnh cũ + trừ ${fmt(totalOwnPlay)}: balance sẽ = ${fmt(500_000 - totalOwnPlay)}`,
);
console.log(`Cần thêm Hiệu chỉnh: ${fmt(remainderToAdjust)} (do CSV làm tròn 29/4 + 27/4)\n`);

if (DRY) {
  console.log("DRY RUN — không thay đổi DB.");
  process.exit(0);
}

const now = new Date().toISOString().replace("T", " ").slice(0, 19);

// 4a. Reverse old hiệu chỉnh
console.log("Reversing Hiệu chỉnh khớp sổ cũ...");
await client.execute({
  sql: `INSERT INTO financial_transactions
        (type, direction, amount, member_id, reversal_of_id, description,
         idempotency_key, created_at)
        VALUES ('fund_contribution', 'in', ?, ?, ?, ?, ?, ?)`,
  args: [
    oldAdjustAmount,
    ADMIN_ID,
    Number(old.id),
    "Hoàn lại Hiệu chỉnh cũ — thay bằng backfill theo session",
    `${RUN_TAG}-reverse-old`,
    now,
  ],
});
console.log(`  ✓ Reversed #${old.id} (+${fmt(oldAdjustAmount)})`);

// 4b. Insert fund_deductions tied to sessions
console.log("\nInserting session-tied fund_deductions...");
for (const t of toInsert) {
  const idemp = `${RUN_TAG}-deduction-${t.sessionId}-${t.debtId}`;
  await client.execute({
    sql: `INSERT INTO financial_transactions
          (type, direction, amount, member_id, session_id, debt_id,
           description, idempotency_key, created_at)
          VALUES ('fund_deduction', 'out', ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      t.amount,
      ADMIN_ID,
      t.sessionId,
      t.debtId,
      `Trừ quỹ buổi ${t.date} (admin own play)`,
      idemp,
      now,
    ],
  });
  console.log(`  ✓ ${t.date}  -${fmt(t.amount)}`);
}

// 4c. Insert remainder adjust
if (remainderToAdjust !== 0) {
  const isContrib = remainderToAdjust > 0;
  await client.execute({
    sql: `INSERT INTO financial_transactions
          (type, direction, amount, member_id, description,
           idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      isContrib ? "fund_contribution" : "fund_deduction",
      isContrib ? "in" : "out",
      Math.abs(remainderToAdjust),
      ADMIN_ID,
      "Hiệu chỉnh do CSV làm tròn (29/4 55K vs DB 53K, 27/4 61K vs DB 60K)",
      `${RUN_TAG}-rounding`,
      now,
    ],
  });
  console.log(`\n  ✓ Hiệu chỉnh ${isContrib ? "+" : "-"}${fmt(Math.abs(remainderToAdjust))}`);
}

// 5. Verify Châu balance
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
  args: [ADMIN_ID, ADMIN_ID],
});
console.log(`\n✅ Châu balance mới: ${fmt(bal.rows[0].balance)} (target: 274.000 đ)`);

process.exit(0);
