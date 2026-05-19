// Cleanup Phong (id=33) ledger để khớp business reality "nộp tổng 400K".
//
// Trước cleanup:
//   tx #111  contrib +260K  "Đã trả nợ"
//   tx #303  contrib +200K  "Đóng quỹ"
//   tx #613  deduct  -60K   "Hiệu chỉnh khớp sổ kế toán 2026-05-18-csv-sync"
//   Net balance = 460 - 104 - 60 = 296K ✓
//
// Vấn đề: total contrib 460K không khớp "Phong nộp tổng 400K"; -60K deduct
// thừa từ đợt sync CSV cũ (KT lúc đó còn ghi 200K, sau update lên 400K).
//
// Sau cleanup (reverse tx #613 ↔ insert balancing fund_refund -60K cùng amount):
//   tx #111  contrib +260K  (giữ — phản ánh khoản trả nợ thật)
//   tx #303  contrib +200K  (giữ — phản ánh đóng quỹ thật)
//   tx #613  deduct  -60K   (sẽ VOID qua reversal)
//   + tx mới fund_contribution +60K reversalOfId=613 (huỷ -60K deduct)
//   + tx mới fund_refund -60K (giảm contrib thừa, mô tả "Điều chỉnh ghi nhận đóng quỹ thừa")
//   Net balance = 460 - 104 + 60 - 60 = 296K ✓ (không đổi)
//   Total contrib excluding refund = 460K, refund 60K → net contrib 400K ✓
//
// Idempotent: 2 idempotency keys cố định, chạy lại safe.

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const PHONG_ID = 33;
const TX_613 = 613; // -60K deduct cần reverse
const AMOUNT = 60_000;
const REVERSAL_KEY = "phong-cleanup-2026-05-19-reverse-tx-613";
const REFUND_KEY = "phong-cleanup-2026-05-19-refund-60k-excess-contrib";
const now = new Date().toISOString();

// Verify tx #613 exists & is deduct
const { rows: orig } = await client.execute({
  sql: `SELECT id, type, amount, member_id FROM financial_transactions WHERE id = ?`,
  args: [TX_613],
});
if (orig.length === 0) {
  console.error(`Tx #${TX_613} không tồn tại`);
  process.exit(1);
}
const o = orig[0];
if (
  o.type !== "fund_deduction" ||
  Number(o.amount) !== AMOUNT ||
  Number(o.member_id) !== PHONG_ID
) {
  console.error(`Tx #${TX_613} không khớp expected:`, o);
  process.exit(1);
}

// Check idempotency
const { rows: existing } = await client.execute({
  sql: `SELECT id, idempotency_key FROM financial_transactions
        WHERE idempotency_key IN (?, ?)`,
  args: [REVERSAL_KEY, REFUND_KEY],
});
if (existing.length === 2) {
  console.log("Đã chạy trước đó, idempotent skip. Cleanup hoàn tất.");
  process.exit(0);
}

const tx = await client.transaction("write");
try {
  // Tx A: reversal of #613
  if (!existing.some((r) => r.idempotency_key === REVERSAL_KEY)) {
    await tx.execute({
      sql: `INSERT INTO financial_transactions
        (type, direction, amount, member_id, session_id, debt_id,
         description, idempotency_key, reversal_of_id,
         created_at)
        VALUES ('fund_contribution', 'in', ?, ?, NULL, NULL,
                'Huỷ điều chỉnh khớp sổ 60K (CSV đã cập nhật Phong = 400K)',
                ?, ?, ?)`,
      args: [AMOUNT, PHONG_ID, REVERSAL_KEY, TX_613, now],
    });
    console.log(`✓ Inserted reversal of #${TX_613} (+${AMOUNT}đ)`);
  }

  // Tx B: refund 60K (giảm contrib thừa)
  if (!existing.some((r) => r.idempotency_key === REFUND_KEY)) {
    await tx.execute({
      sql: `INSERT INTO financial_transactions
        (type, direction, amount, member_id, session_id, debt_id,
         description, idempotency_key,
         created_at)
        VALUES ('fund_refund', 'out', ?, ?, NULL, NULL,
                'Điều chỉnh: chuyển 60K từ "Đã trả nợ" thành đóng quỹ trực tiếp (audit cleanup 2026-05-19)',
                ?, ?)`,
      args: [AMOUNT, PHONG_ID, REFUND_KEY, now],
    });
    console.log(`✓ Inserted refund -${AMOUNT}đ`);
  }

  await tx.commit();
} catch (e) {
  await tx.rollback();
  console.error("Rollback:", e);
  process.exit(2);
}

// Verify
const { rows: final } = await client.execute({
  sql: `SELECT id, type, amount, description, reversal_of_id
        FROM financial_transactions
        WHERE member_id = ?
          AND type IN ('fund_contribution','fund_deduction','fund_refund')
        ORDER BY id ASC`,
  args: [PHONG_ID],
});

const voided = new Set(
  final.filter((r) => r.reversal_of_id).map((r) => Number(r.reversal_of_id)),
);
let bal = 0,
  contribGross = 0,
  refundTotal = 0;
for (const r of final) {
  if (r.reversal_of_id) continue;
  if (voided.has(Number(r.id))) continue;
  const a = Number(r.amount);
  if (r.type === "fund_contribution") {
    bal += a;
    contribGross += a;
  } else if (r.type === "fund_deduction") bal -= a;
  else if (r.type === "fund_refund") {
    bal -= a;
    refundTotal += a;
  }
}
console.log(`\nPhong final: balance=${bal.toLocaleString("vi-VN")}đ`);
console.log(
  `  contrib gross=${contribGross.toLocaleString("vi-VN")}, refund=${refundTotal.toLocaleString("vi-VN")}, net contrib=${(contribGross - refundTotal).toLocaleString("vi-VN")}`,
);
console.log(`  Expected: balance 296.000đ, net contrib 400.000đ`);
