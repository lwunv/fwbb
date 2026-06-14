/**
 * RESET SỐ LIỆU TÀI CHÍNH về 0 để Admin nhập lại.
 *
 * Quyết định phạm vi (đã chốt với user 14/6/2026):
 *   1. Buổi chơi  → GIỮ sessions + votes + điểm danh. Chỉ đưa TIỀN về 0.
 *   2. Kho cầu    → RESET về 0 (xóa mua + dùng, stock_adjust_qua = 0). GIỮ brand (tên + giá).
 *   3. Roster quỹ → GIỮ fund_members; balance tự về 0 do xóa ledger.
 *
 * ─── XÓA SẠCH (transactional / money) ───────────────────────────────────
 *   - financial_transactions          (toàn bộ ledger → mọi balance = 0)
 *   - session_debts                   (nợ từng buổi)
 *   - payment_notifications           (log tiền vào TK; orphan sau khi xóa ledger)
 *   - session_shuttlecocks            (cầu đã dùng — kho + cost)
 *   - inventory_purchases             (mua cầu — tiền + kho)
 *   - session_min_deduction_exemptions(rule-state tài chính per-buổi)
 *
 * ─── UPDATE về 0/NULL ───────────────────────────────────────────────────
 *   - sessions: court_price=NULL, court_price_overridden=0, dining_bill=NULL, pass_revenue=NULL
 *   - shuttlecock_brands: stock_adjust_qua = 0
 *
 * ─── GIỮ NGUYÊN (không đụng) ─────────────────────────────────────────────
 *   members, admins, courts, shuttlecock_brands(tên+giá), fund_members,
 *   votes, session_attendees, sessions(status/ngày/giờ/court/guest counts),
 *   app_settings, rate_limit_buckets.
 *
 * An toàn:
 *   - DRY-RUN mặc định. Thêm --apply để thực sự ghi.
 *   - Mọi write bọc trong 1 batch atomic (all-or-nothing).
 *   - FK ON, chỉ xóa bảng con (không xóa parent có NO-ACTION child) → không vi phạm FK.
 *   - Verify sau --apply: counts = 0, mọi balance = 0, bảng GIỮ không đổi số lượng.
 *
 * Chạy: node scripts/reset-financials.mjs            (dry-run)
 *       node scripts/reset-financials.mjs --apply
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing trong .env.local");
  process.exit(1);
}
const client = createClient({ url, authToken });

const num = (n) => Number(n).toLocaleString("vi-VN");

// Bảng sẽ bị XÓA hết (theo thứ tự an toàn FK: con → ít phụ thuộc hơn).
const WIPE_TABLES = [
  "payment_notifications",
  "financial_transactions",
  "session_debts",
  "session_shuttlecocks",
  "inventory_purchases",
  "session_min_deduction_exemptions",
];

// Bảng GIỮ NGUYÊN — verify số lượng không đổi sau apply.
const KEEP_TABLES = [
  "members",
  "admins",
  "courts",
  "shuttlecock_brands",
  "fund_members",
  "votes",
  "session_attendees",
  "sessions",
  "app_settings",
  "rate_limit_buckets",
];

async function count(table) {
  try {
    const r = await client.execute(`SELECT COUNT(*) AS c FROM "${table}"`);
    return Number(r.rows[0].c);
  } catch {
    return -1; // bảng không tồn tại
  }
}

console.log(`\n${APPLY ? "🟢 APPLY MODE — SẼ GHI VÀO DB" : "🟡 DRY-RUN — không ghi gì"}`);
console.log(`Database: ${url}\n`);

// ─── BEFORE snapshot ────────────────────────────────────────────────────
console.log("=== TRƯỚC RESET ===");

const before = {};
for (const t of [...WIPE_TABLES, ...KEEP_TABLES]) before[t] = await count(t);

console.log("\nSẽ XÓA HẾT:");
for (const t of WIPE_TABLES) {
  console.log(`  ${t.padEnd(34)} ${String(before[t]).padStart(6)} rows  → 0`);
}

// sessions có tiền cần đưa về NULL
const sessFin = await client.execute(
  `SELECT
     COUNT(*) AS total,
     SUM(CASE WHEN court_price IS NOT NULL THEN 1 ELSE 0 END) AS withCourt,
     SUM(CASE WHEN dining_bill IS NOT NULL THEN 1 ELSE 0 END) AS withDine,
     SUM(CASE WHEN pass_revenue IS NOT NULL THEN 1 ELSE 0 END) AS withPass,
     SUM(CASE WHEN court_price_overridden = 1 THEN 1 ELSE 0 END) AS overridden
   FROM sessions`,
);
const sf = sessFin.rows[0];
console.log("\nUPDATE sessions (về NULL/0) — GIỮ status/ngày/giờ/court/vote/điểm danh:");
console.log(`  tổng sessions:          ${num(sf.total)} (giữ nguyên rows)`);
console.log(`  có court_price:         ${num(sf.withCourt)}  → NULL`);
console.log(`  có dining_bill:         ${num(sf.withDine)}  → NULL`);
console.log(`  có pass_revenue:        ${num(sf.withPass)}  → NULL`);
console.log(`  court_price_overridden: ${num(sf.overridden)}  → 0`);

const brandAdj = await client.execute(
  `SELECT COUNT(*) AS c FROM shuttlecock_brands WHERE stock_adjust_qua <> 0`,
);
console.log(`\nUPDATE shuttlecock_brands.stock_adjust_qua → 0 (${num(brandAdj.rows[0].c)} brand đang khác 0; GIỮ tên + giá)`);

console.log("\nGIỮ NGUYÊN:");
for (const t of KEEP_TABLES) {
  console.log(`  ${t.padEnd(34)} ${String(before[t]).padStart(6)} rows`);
}

// Balance hiện tại (để thấy nó sẽ về 0)
const balRes = await client.execute(`
  SELECT
    COALESCE(SUM(CASE WHEN type='fund_contribution' THEN amount ELSE 0 END),0)
  - COALESCE(SUM(CASE WHEN type='fund_deduction'    THEN amount ELSE 0 END),0)
  - COALESCE(SUM(CASE WHEN type='fund_refund'       THEN amount ELSE 0 END),0) AS net,
    COUNT(*) AS txCount
  FROM financial_transactions
`);
console.log(
  `\nLedger hiện tại: ${num(balRes.rows[0].txCount)} giao dịch, net = ${num(balRes.rows[0].net)}đ → toàn bộ về 0`,
);

if (!APPLY) {
  console.log(`\n🟡 Dry-run xong. Chạy lại với --apply để thực thi.\n`);
  client.close();
  process.exit(0);
}

// ─── APPLY (atomic batch) ───────────────────────────────────────────────
console.log("\n=== ĐANG APPLY (atomic batch) ===");

const stmts = [];
for (const t of WIPE_TABLES) stmts.push(`DELETE FROM "${t}"`);
stmts.push(
  `UPDATE sessions SET court_price = NULL, court_price_overridden = 0, dining_bill = NULL, pass_revenue = NULL`,
);
stmts.push(`UPDATE shuttlecock_brands SET stock_adjust_qua = 0`);
// Reset autoincrement của các bảng đã rỗng (id đếm lại từ 1). An toàn vì mọi
// row tham chiếu chúng cũng đã bị xóa.
for (const t of WIPE_TABLES) {
  stmts.push(`DELETE FROM sqlite_sequence WHERE name = '${t}'`);
}

await client.batch(stmts, "write");
console.log(`  ✓ Đã chạy ${stmts.length} statement trong 1 batch atomic.`);

// ─── VERIFY ─────────────────────────────────────────────────────────────
console.log("\n=== VERIFY ===");
let ok = true;

for (const t of WIPE_TABLES) {
  const c = await count(t);
  const pass = c === 0;
  if (!pass) ok = false;
  console.log(`  ${pass ? "✓" : "✗"} ${t.padEnd(34)} = ${c} (mong đợi 0)`);
}

for (const t of KEEP_TABLES) {
  const c = await count(t);
  const pass = c === before[t];
  if (!pass) ok = false;
  console.log(
    `  ${pass ? "✓" : "✗"} ${t.padEnd(34)} = ${c} (giữ nguyên ${before[t]})`,
  );
}

const sessAfter = await client.execute(
  `SELECT COUNT(*) AS c FROM sessions WHERE court_price IS NOT NULL OR dining_bill IS NOT NULL OR pass_revenue IS NOT NULL OR court_price_overridden = 1`,
);
const sessDirty = Number(sessAfter.rows[0].c);
console.log(
  `  ${sessDirty === 0 ? "✓" : "✗"} sessions còn field tiền: ${sessDirty} (mong đợi 0)`,
);
if (sessDirty !== 0) ok = false;

const brandAfter = await client.execute(
  `SELECT COUNT(*) AS c FROM shuttlecock_brands WHERE stock_adjust_qua <> 0`,
);
const brandDirty = Number(brandAfter.rows[0].c);
console.log(
  `  ${brandDirty === 0 ? "✓" : "✗"} brand còn stock_adjust ≠ 0: ${brandDirty} (mong đợi 0)`,
);
if (brandDirty !== 0) ok = false;

// Mọi balance phải = 0 (ledger rỗng → 0 cho mọi member)
const balAfter = await client.execute(`
  SELECT COUNT(*) AS nonZero FROM (
    SELECT m.id,
      COALESCE(SUM(CASE WHEN ft.type='fund_contribution' THEN ft.amount ELSE 0 END),0)
    - COALESCE(SUM(CASE WHEN ft.type='fund_deduction'    THEN ft.amount ELSE 0 END),0)
    - COALESCE(SUM(CASE WHEN ft.type='fund_refund'       THEN ft.amount ELSE 0 END),0) AS bal
    FROM members m LEFT JOIN financial_transactions ft ON ft.member_id = m.id
    GROUP BY m.id
  ) WHERE bal <> 0
`);
const nonZero = Number(balAfter.rows[0].nonZero);
console.log(
  `  ${nonZero === 0 ? "✓" : "✗"} member có balance ≠ 0: ${nonZero} (mong đợi 0)`,
);
if (nonZero !== 0) ok = false;

console.log(ok ? "\n✅ RESET THÀNH CÔNG — mọi số liệu tài chính = 0." : "\n❌ CÓ MISMATCH — kiểm tra lại + dùng backup nếu cần!");
client.close();
process.exit(ok ? 0 : 1);
