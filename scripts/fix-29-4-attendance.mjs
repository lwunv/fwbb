/**
 * Fix sai sót session 29/4 (id=2): DB ghi Cường, Quang, Phiêu, Tuấn có chơi
 * nhưng thực tế KHÔNG. Cleanup:
 *
 *   a) Reverse fund_deduction 29/4 cho 4 người (cặp original + reversal nhau
 *      → cả 2 bị exclude khỏi tổng).
 *   b) Reverse "Hiệu chỉnh khớp sổ" mà tôi insert để bù trừ trước đây.
 *   c) Xoá session_debts + session_attendees của 4 người cho session 2.
 *
 * Idempotent: skip nếu đã reverse trước đó.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DRY = process.argv.includes("--dry");
const SESSION_29_4 = 2;
const TARGETS = [
  { name: "Cường", id: 3 },
  { name: "Quang", id: 12 },
  { name: "Phiêu", id: 14 },
  { name: "Tuấn", id: 18 },
];
const RUN_TAG = "2026-05-18-fix-29-4";

const fmt = (n) => Number(n).toLocaleString("vi-VN") + " đ";

console.log(`\nMode: ${DRY ? "DRY RUN" : "EXECUTE"}\n`);

const now = new Date().toISOString().replace("T", " ").slice(0, 19);

for (const m of TARGETS) {
  console.log(`▸ ${m.name} #${m.id}`);

  // 1) Find live fund_deduction for 29/4
  const ded = await client.execute({
    sql: `SELECT id, amount
          FROM financial_transactions
          WHERE member_id = ? AND session_id = ? AND type = 'fund_deduction'
            AND reversal_of_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM financial_transactions r WHERE r.reversal_of_id = financial_transactions.id)`,
    args: [m.id, SESSION_29_4],
  });

  // 2) Find live "Hiệu chỉnh khớp sổ" (csv-sync) contribution for this member
  const adj = await client.execute({
    sql: `SELECT id, amount, type
          FROM financial_transactions
          WHERE member_id = ?
            AND idempotency_key LIKE '2026-05-18-csv-sync%'
            AND reversal_of_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM financial_transactions r WHERE r.reversal_of_id = financial_transactions.id)`,
    args: [m.id],
  });

  if (ded.rows.length === 0) {
    console.log(`  ✓ Không có fund_deduction live cho 29/4 — skip`);
  } else {
    const d = ded.rows[0];
    console.log(`  → Reverse fund_deduction #${d.id} ${fmt(d.amount)}`);
    if (!DRY) {
      await client.execute({
        sql: `INSERT INTO financial_transactions
              (type, direction, amount, member_id, session_id, reversal_of_id,
               description, idempotency_key, created_at)
              VALUES ('fund_contribution', 'in', ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          Number(d.amount),
          m.id,
          SESSION_29_4,
          Number(d.id),
          `Hoàn lại trừ quỹ 29/4 — ${m.name} không chơi buổi này`,
          `${RUN_TAG}-revert-deduction-${m.id}`,
          now,
        ],
      });
    }
  }

  if (adj.rows.length === 0) {
    console.log(`  ✓ Không có Hiệu chỉnh khớp sổ live — skip`);
  } else {
    const a = adj.rows[0];
    const inverseType = a.type === "fund_contribution" ? "fund_deduction" : "fund_contribution";
    const inverseDir = inverseType === "fund_contribution" ? "in" : "out";
    console.log(`  → Reverse hiệu chỉnh #${a.id} ${a.type} ${fmt(a.amount)}`);
    if (!DRY) {
      await client.execute({
        sql: `INSERT INTO financial_transactions
              (type, direction, amount, member_id, reversal_of_id,
               description, idempotency_key, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          inverseType,
          inverseDir,
          Number(a.amount),
          m.id,
          Number(a.id),
          `Hoàn lại Hiệu chỉnh — kèm với fix 29/4 attendance`,
          `${RUN_TAG}-revert-adjust-${m.id}`,
          now,
        ],
      });
    }
  }

  // 3) Delete session_debts + session_attendees for this member at session 2.
  //    Trước khi xoá debt, NULL out debtId trên các ledger rows trỏ về (audit
  //    rows giữ lại, FK ref clean).
  if (!DRY) {
    const debtRows = await client.execute({
      sql: `SELECT id FROM session_debts WHERE session_id = ? AND member_id = ?`,
      args: [SESSION_29_4, m.id],
    });
    for (const dr of debtRows.rows) {
      await client.execute({
        sql: `UPDATE financial_transactions SET debt_id = NULL WHERE debt_id = ?`,
        args: [Number(dr.id)],
      });
    }
    const delDebt = await client.execute({
      sql: `DELETE FROM session_debts WHERE session_id = ? AND member_id = ?`,
      args: [SESSION_29_4, m.id],
    });
    const delAtt = await client.execute({
      sql: `DELETE FROM session_attendees WHERE session_id = ? AND member_id = ?`,
      args: [SESSION_29_4, m.id],
    });
    console.log(`  → Deleted ${delDebt.rowsAffected} debt + ${delAtt.rowsAffected} attendee rows`);
  } else {
    console.log(`  → (would delete debt + attendee for session ${SESSION_29_4})`);
  }
  console.log();
}

if (DRY) {
  console.log("DRY RUN — không thay đổi DB.");
  process.exit(0);
}

// Verify final balances + tổng nộp/chi
console.log("Verify số dư + tổng nộp/chi sau fix:\n");
for (const m of TARGETS) {
  const txRes = await client.execute({
    sql: `SELECT id, type, amount, reversal_of_id FROM financial_transactions WHERE member_id = ?`,
    args: [m.id],
  });
  const txs = txRes.rows;
  const voided = new Set();
  for (const tx of txs) if (tx.reversal_of_id !== null) voided.add(Number(tx.reversal_of_id));
  let contrib = 0, deduct = 0;
  for (const tx of txs) {
    if (tx.reversal_of_id !== null) continue;
    if (voided.has(Number(tx.id))) continue;
    if (tx.type === "fund_contribution") contrib += Number(tx.amount);
    else if (tx.type === "fund_deduction") deduct += Number(tx.amount);
    else if (tx.type === "fund_refund") deduct += Number(tx.amount);
  }
  console.log(`  ${m.name.padEnd(10)}  Nộp ${fmt(contrib).padStart(11)}  Chi ${fmt(deduct).padStart(11)}  Bal ${fmt(contrib - deduct).padStart(11)}`);
}

// Session 29/4 lãi/lỗ
const td = await client.execute({
  sql: `SELECT COALESCE(SUM(total_amount),0) AS t FROM session_debts WHERE session_id = ?`,
  args: [SESSION_29_4],
});
const cost = 420_000 + 319_000; // sân + cầu cho 29/4
console.log(`\nSession 29/4 totalDebt mới: ${fmt(td.rows[0].t)}, cost ${fmt(cost)}, lãi ${fmt(Number(td.rows[0].t) - cost)}`);

process.exit(0);
