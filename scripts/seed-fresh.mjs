/**
 * Wipe + seed lại DB từ snapshot bảng tính của user (xem hội thoại).
 *
 * - 19 members mới (placeholder facebook_id, FB login chưa dùng).
 * - 1 court: THCS Tây Mỗ 3 (200k/buổi tháng, 220k/buổi lẻ).
 * - 2 brand cầu: Bubadu (5 quả lẻ, no purchase) + Thành Công 77 (2 ống).
 * - 19 fund_contribution + 13 fund_deduction (1×60k 24/4, 12×61k 27/4).
 *
 * Idempotent về mặt nội dung: chạy lại sẽ wipe rồi seed lại từ đầu.
 *
 * Chạy: node scripts/seed-fresh.mjs
 *   - Mặc định DRY-RUN (chỉ in ra kế hoạch, không chạm DB).
 *   - Thêm flag --apply để thực sự ghi.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const APPLY = process.argv.includes("--apply");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing");
  process.exit(1);
}
const client = createClient({ url, authToken });

// ─── Source data ──────────────────────────────────────────────────────────

const MEMBERS = [
  { name: "Châu", contribution: 500_000 },
  { name: "Lưu", contribution: 500_000 },
  { name: "Cường", contribution: 500_000 },
  { name: "Xuân Trường", contribution: 500_000 },
  { name: "Tin Tin", contribution: 500_000 },
  { name: "Mạnh/Huyền", contribution: 500_000 },
  { name: "Phương", contribution: 500_000 },
  { name: "Ngọc Sơn", contribution: 500_000 },
  { name: "Hùng", contribution: 500_000 },
  { name: "Kỳ", contribution: 200_000 },
  { name: "Sơn", contribution: 200_000 },
  { name: "Quang", contribution: 500_000 },
  { name: "Hiếu", contribution: 500_000 },
  { name: "Phiêu", contribution: 500_000 },
  { name: "Tùng", contribution: 250_000 },
  { name: "Tuấn Anh", contribution: 250_000 },
  { name: "Hoàng Anh", contribution: 500_000 },
  { name: "Tuấn", contribution: 500_000 },
  { name: "Trung", contribution: 500_000 },
];

const DEDUCTION_24_4_NAME = "Cường";
const DEDUCTION_24_4_AMOUNT = 60_000;

const DEDUCTION_27_4_AMOUNT = 61_000;
const DEDUCTION_27_4_NAMES = [
  "Châu",
  "Lưu",
  "Xuân Trường",
  "Mạnh/Huyền",
  "Phương",
  "Hùng",
  "Quang",
  "Hiếu",
  "Phiêu",
  "Hoàng Anh",
  "Tuấn",
  "Trung",
];

const COURT = {
  name: "THCS Tây Mỗ 3",
  address: "Gần PZ3",
  mapLink: null,
  pricePerSession: 200_000, // Giá tháng (áp dụng từ tháng 5)
  pricePerSessionRetail: 220_000, // Giá lẻ (tháng 4 thuê lẻ)
};

const SHUTTLE_BRANDS = [
  { name: "Bubadu", pricePerTube: 350_000, stockAdjustQua: 5 },
  { name: "Thành Công 77", pricePerTube: 250_000, stockAdjustQua: 0 },
];

const PURCHASE_THANH_CONG_77 = {
  brandName: "Thành Công 77",
  tubes: 2,
  pricePerTube: 250_000,
  purchasedAt: "2026-04-20",
};

// Dùng để backdate các transaction (createdAt) cho timeline trông tự nhiên.
const TS_CONTRIB = "2026-04-23 12:00:00";
const TS_DEDUCT_24 = "2026-04-24 22:30:00";
const TS_DEDUCT_27 = "2026-04-27 22:30:00";

// ─── Helpers ──────────────────────────────────────────────────────────────

function slug(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function exec(sql, args) {
  if (!APPLY) {
    const preview = args
      ? `${sql.slice(0, 80)}…  args=${JSON.stringify(args).slice(0, 80)}`
      : sql.slice(0, 100);
    console.log(`  [dry] ${preview}`);
    return;
  }
  return client.execute(args ? { sql, args } : sql);
}

// ─── Validation ───────────────────────────────────────────────────────────

const memberByName = new Map(MEMBERS.map((m) => [m.name, m]));

if (!memberByName.has(DEDUCTION_24_4_NAME)) {
  throw new Error(`24/4 deduction member not in roster: ${DEDUCTION_24_4_NAME}`);
}
for (const n of DEDUCTION_27_4_NAMES) {
  if (!memberByName.has(n)) {
    throw new Error(`27/4 deduction member not in roster: ${n}`);
  }
}

// Cross-check final balances
const expectedBalances = new Map(
  MEMBERS.map((m) => [m.name, m.contribution]),
);
expectedBalances.set(
  DEDUCTION_24_4_NAME,
  expectedBalances.get(DEDUCTION_24_4_NAME) - DEDUCTION_24_4_AMOUNT,
);
for (const n of DEDUCTION_27_4_NAMES) {
  expectedBalances.set(n, expectedBalances.get(n) - DEDUCTION_27_4_AMOUNT);
}

// ─── Plan summary ─────────────────────────────────────────────────────────

console.log(
  `\n${APPLY ? "🟢 APPLY MODE" : "🟡 DRY-RUN MODE — no DB writes"}\n`,
);
console.log(`Database: ${url}`);
console.log(`Members:        ${MEMBERS.length}`);
console.log(`Contributions:  ${MEMBERS.length} × → tổng ${
  MEMBERS.reduce((s, m) => s + m.contribution, 0).toLocaleString("vi-VN")
}đ`);
console.log(
  `Deductions:     1 (24/4 ${DEDUCTION_24_4_AMOUNT.toLocaleString("vi-VN")}đ) + ${
    DEDUCTION_27_4_NAMES.length
  } (27/4 ${DEDUCTION_27_4_AMOUNT.toLocaleString("vi-VN")}đ)`,
);
console.log(`Court:          ${COURT.name}`);
console.log(
  `Brands:         ${SHUTTLE_BRANDS.map((b) => b.name).join(", ")}`,
);
console.log(`Purchase:       ${PURCHASE_THANH_CONG_77.brandName} × ${PURCHASE_THANH_CONG_77.tubes} ống`);
console.log(`\nExpected balances after seed:`);
for (const [name, bal] of expectedBalances) {
  console.log(`  ${name.padEnd(14)} ${bal.toLocaleString("vi-VN").padStart(10)}đ`);
}

// ─── Wipe ─────────────────────────────────────────────────────────────────

console.log(`\n=== WIPE (in FK-safe order) ===`);

// Disable FK enforcement during wipe so dangling refs trong payment_notifications
// (matchedDebtId, matchedTransactionId) không chặn DELETE từng bảng.
await exec(`PRAGMA foreign_keys = OFF`);

// admins có thể FK qua memberId (nullable). Set NULL trước khi xoá members.
await exec(`UPDATE admins SET member_id = NULL`);

// Bảng phụ thuộc xuống dưới cùng.
// ⚠️ KHÔNG wipe `courts` và `shuttlecock_brands` — đó là master data
// admin đã cấu hình, không phải dữ liệu phát sinh từ buổi chơi.
const WIPE_TABLES = [
  "financial_transactions",
  "session_debts",
  "session_attendees",
  "votes",
  "session_shuttlecocks",
  "sessions",
  "inventory_purchases",
  "fund_members",
  "payment_notifications",
  "rate_limit_buckets",
  "members",
];

for (const t of WIPE_TABLES) {
  await exec(`DELETE FROM ${t}`);
  // Reset autoincrement counter (sqlite_sequence may not exist if no AI rows).
  await exec(`DELETE FROM sqlite_sequence WHERE name = ?`, [t]);
}

await exec(`PRAGMA foreign_keys = ON`);

// ─── Insert: members ──────────────────────────────────────────────────────

console.log(`\n=== INSERT members + fund_members ===`);

const memberIdByName = new Map();
for (let i = 0; i < MEMBERS.length; i++) {
  const m = MEMBERS[i];
  const fbId = `seed-${slug(m.name)}-${i + 1}`;
  if (APPLY) {
    const r = await client.execute({
      sql: `INSERT INTO members (name, facebook_id, is_active) VALUES (?, ?, 1) RETURNING id`,
      args: [m.name, fbId],
    });
    memberIdByName.set(m.name, Number(r.rows[0].id));
  } else {
    console.log(`  [dry] INSERT member ${m.name} fb_id=${fbId}`);
    memberIdByName.set(m.name, i + 1); // dry-run pseudo id
  }
}

for (const m of MEMBERS) {
  const id = memberIdByName.get(m.name);
  await exec(
    `INSERT INTO fund_members (member_id, is_active) VALUES (?, 1)`,
    [id],
  );
}

// ─── Upsert: court (only if not exists by name) ──────────────────────────
//
// Master data — không wipe ở trên nên bảng này có thể đã có sẵn. Chỉ insert
// nếu chưa có court cùng tên.

console.log(`\n=== UPSERT court ===`);

if (APPLY) {
  const existing = await client.execute({
    sql: `SELECT id FROM courts WHERE name = ?`,
    args: [COURT.name],
  });
  if (existing.rows.length === 0) {
    await client.execute({
      sql: `INSERT INTO courts (name, address, map_link, price_per_session, price_per_session_retail, is_active)
            VALUES (?, ?, ?, ?, ?, 1)`,
      args: [
        COURT.name,
        COURT.address,
        COURT.mapLink,
        COURT.pricePerSession,
        COURT.pricePerSessionRetail,
      ],
    });
    console.log(`  ✓ inserted court ${COURT.name}`);
  } else {
    console.log(`  ↷ court ${COURT.name} already exists, skipped`);
  }
} else {
  console.log(`  [dry] upsert court ${COURT.name}`);
}

// ─── Upsert: shuttlecock brands + Thành Công 77 purchase ─────────────────
//
// Master data — chỉ insert nếu chưa có brand cùng tên.

console.log(`\n=== UPSERT shuttlecock brands + inventory ===`);

const brandIdByName = new Map();
for (const b of SHUTTLE_BRANDS) {
  if (APPLY) {
    const existing = await client.execute({
      sql: `SELECT id FROM shuttlecock_brands WHERE name = ?`,
      args: [b.name],
    });
    if (existing.rows.length === 0) {
      const r = await client.execute({
        sql: `INSERT INTO shuttlecock_brands (name, price_per_tube, is_active, stock_adjust_qua)
              VALUES (?, ?, 1, ?) RETURNING id`,
        args: [b.name, b.pricePerTube, b.stockAdjustQua],
      });
      brandIdByName.set(b.name, Number(r.rows[0].id));
      console.log(`  ✓ inserted brand ${b.name}`);
    } else {
      brandIdByName.set(b.name, Number(existing.rows[0].id));
      console.log(`  ↷ brand ${b.name} already exists, skipped`);
    }
  } else {
    console.log(
      `  [dry] upsert brand ${b.name} price=${b.pricePerTube} adjust=${b.stockAdjustQua}`,
    );
    brandIdByName.set(b.name, brandIdByName.size + 1);
  }
}

const purchaseBrandId = brandIdByName.get(PURCHASE_THANH_CONG_77.brandName);
await exec(
  `INSERT INTO inventory_purchases (brand_id, tubes, price_per_tube, total_price, purchased_at)
   VALUES (?, ?, ?, ?, ?)`,
  [
    purchaseBrandId,
    PURCHASE_THANH_CONG_77.tubes,
    PURCHASE_THANH_CONG_77.pricePerTube,
    PURCHASE_THANH_CONG_77.tubes * PURCHASE_THANH_CONG_77.pricePerTube,
    PURCHASE_THANH_CONG_77.purchasedAt,
  ],
);

// ─── Insert: financial transactions ───────────────────────────────────────

console.log(`\n=== INSERT financial_transactions ===`);

// 1) fund_contribution (initial deposit) for each member.
for (const m of MEMBERS) {
  const id = memberIdByName.get(m.name);
  await exec(
    `INSERT INTO financial_transactions
       (type, direction, amount, member_id, description, created_at)
     VALUES ('fund_contribution', 'in', ?, ?, 'Số tiền nộp ban đầu', ?)`,
    [m.contribution, id, TS_CONTRIB],
  );
}

// 2) Cường — 60k 24/4
{
  const id = memberIdByName.get(DEDUCTION_24_4_NAME);
  await exec(
    `INSERT INTO financial_transactions
       (type, direction, amount, member_id, description, created_at)
     VALUES ('fund_deduction', 'out', ?, ?, 'Tiền chơi cầu 24/4', ?)`,
    [DEDUCTION_24_4_AMOUNT, id, TS_DEDUCT_24],
  );
}

// 3) 12 người — 61k 27/4
for (const name of DEDUCTION_27_4_NAMES) {
  const id = memberIdByName.get(name);
  await exec(
    `INSERT INTO financial_transactions
       (type, direction, amount, member_id, description, created_at)
     VALUES ('fund_deduction', 'out', ?, ?, 'Tiền chơi cầu 27/4', ?)`,
    [DEDUCTION_27_4_AMOUNT, id, TS_DEDUCT_27],
  );
}

// ─── Verify (only when applied) ───────────────────────────────────────────

if (APPLY) {
  console.log(`\n=== VERIFY ===`);
  const rows = await client.execute(`
    SELECT m.name,
           COALESCE(SUM(CASE WHEN ft.type='fund_contribution' THEN ft.amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN ft.type='fund_deduction'    THEN ft.amount ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN ft.type='fund_refund'       THEN ft.amount ELSE 0 END), 0)
         AS balance
    FROM members m
    LEFT JOIN financial_transactions ft ON ft.member_id = m.id
    GROUP BY m.id, m.name
    ORDER BY m.id
  `);
  let ok = true;
  for (const r of rows.rows) {
    const expected = expectedBalances.get(r.name);
    const got = Number(r.balance);
    const match = got === expected;
    if (!match) ok = false;
    console.log(
      `  ${match ? "✓" : "✗"} ${String(r.name).padEnd(14)} ${got
        .toLocaleString("vi-VN")
        .padStart(10)}đ (expected ${expected.toLocaleString("vi-VN")}đ)`,
    );
  }
  console.log(ok ? "\n✅ Balances match expected." : "\n❌ Mismatch — review!");
  client.close();
  process.exit(ok ? 0 : 1);
} else {
  console.log(`\n🟡 Dry-run done. Re-run with --apply to write to DB.`);
  client.close();
}
