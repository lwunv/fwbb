/**
 * Khôi phục master data (sân + brand cầu) bị wipe nhầm bởi seed-fresh.mjs
 * trước đó. Lấy nguồn từ src/db/seed.ts (giữ trong git).
 *
 * Idempotent: insert chỉ khi name chưa tồn tại; brand price được update
 * về giá gốc nếu đang khác.
 *
 * KHÔNG đụng đến: members, fund_members, financial_transactions, sessions.
 *
 * Chạy: node scripts/restore-master.mjs        (dry-run)
 *       node scripts/restore-master.mjs --apply
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

// ─── Source of truth: src/db/seed.ts ─────────────────────────────────────

const COURTS = [
  {
    name: "Trường Tiểu học Tây Mỗ 3",
    address: "Gần S106",
    pricePerSession: 220_000,
    pricePerSessionRetail: null,
    mapLink: "https://maps.app.goo.gl/rS19wd9Ufy9FLgHs8",
  },
  {
    name: "Trường THCS Tây Mỗ 3",
    address: "Gần PZ3",
    pricePerSession: 200_000, // Giá tháng (user updated 29/4: thuê tháng từ tháng 5)
    pricePerSessionRetail: 220_000, // Giá lẻ (tháng 4)
    mapLink: "https://maps.app.goo.gl/Rnz2EKnH3xKxm9Fk8",
  },
  {
    name: "Atus",
    address: "",
    pricePerSession: 220_000,
    pricePerSessionRetail: null,
    mapLink: "https://maps.app.goo.gl/u94Uf9AnTeUamtrD6",
  },
  {
    name: "HP SPORT Coma5",
    address: "Coma5",
    pricePerSession: 220_000,
    pricePerSessionRetail: null,
    mapLink: "https://maps.app.goo.gl/LmcPnBBEzJK3Z4zE8",
  },
  {
    name: "TN Coma5",
    address: "Coma5",
    pricePerSession: 220_000,
    pricePerSessionRetail: null,
    mapLink: "https://maps.app.goo.gl/HTQjr5uwYgycKnpx9",
  },
];

const BRANDS = [
  { name: "Bubadu", pricePerTube: 310_000 },
  { name: "Thành Công 77", pricePerTube: 325_000 },
  { name: "Hải Yến S70", pricePerTube: 285_000 },
  { name: "Prox", pricePerTube: 315_000 },
];

console.log(`\n${APPLY ? "🟢 APPLY MODE" : "🟡 DRY-RUN MODE"}`);
console.log(`Database: ${url}\n`);

// ─── COURTS ──────────────────────────────────────────────────────────────

console.log(`=== COURTS ===`);

// Sửa lại: court "THCS Tây Mỗ 3" t insert sai name (thiếu "Trường" prefix)
// trong seed-fresh.mjs → rename về tên canonical từ seed gốc, giữ giá tháng/lẻ
// 200k/220k user đã set.
const stale = await client.execute({
  sql: `SELECT id FROM courts WHERE name = ? AND NOT EXISTS (SELECT 1 FROM courts WHERE name = ?)`,
  args: ["THCS Tây Mỗ 3", "Trường THCS Tây Mỗ 3"],
});
if (stale.rows.length > 0) {
  if (APPLY) {
    await client.execute({
      sql: `UPDATE courts SET name = ? WHERE id = ?`,
      args: ["Trường THCS Tây Mỗ 3", stale.rows[0].id],
    });
  }
  console.log(`  ${APPLY ? "✓" : "[dry] ~"} RENAME court "THCS Tây Mỗ 3" → "Trường THCS Tây Mỗ 3"`);
}

for (const c of COURTS) {
  const existing = await client.execute({
    sql: `SELECT id, price_per_session, price_per_session_retail FROM courts WHERE name = ?`,
    args: [c.name],
  });
  if (existing.rows.length === 0) {
    if (APPLY) {
      await client.execute({
        sql: `INSERT INTO courts (name, address, map_link, price_per_session, price_per_session_retail, is_active)
              VALUES (?, ?, ?, ?, ?, 1)`,
        args: [
          c.name,
          c.address,
          c.mapLink,
          c.pricePerSession,
          c.pricePerSessionRetail,
        ],
      });
    }
    console.log(`  ${APPLY ? "✓" : "[dry] +"} INSERT ${c.name}`);
  } else {
    console.log(`  ↷ ${c.name} đã tồn tại — bỏ qua`);
  }
}

// ─── BRANDS ──────────────────────────────────────────────────────────────

console.log(`\n=== SHUTTLECOCK BRANDS ===`);
for (const b of BRANDS) {
  const existing = await client.execute({
    sql: `SELECT id, price_per_tube FROM shuttlecock_brands WHERE name = ?`,
    args: [b.name],
  });
  if (existing.rows.length === 0) {
    if (APPLY) {
      await client.execute({
        sql: `INSERT INTO shuttlecock_brands (name, price_per_tube, is_active, stock_adjust_qua)
              VALUES (?, ?, 1, 0)`,
        args: [b.name, b.pricePerTube],
      });
    }
    console.log(`  ${APPLY ? "✓" : "[dry] +"} INSERT ${b.name} ${b.pricePerTube.toLocaleString("vi-VN")}đ/ống`);
  } else {
    const currentPrice = Number(existing.rows[0].price_per_tube);
    if (currentPrice !== b.pricePerTube) {
      if (APPLY) {
        await client.execute({
          sql: `UPDATE shuttlecock_brands SET price_per_tube = ? WHERE name = ?`,
          args: [b.pricePerTube, b.name],
        });
      }
      console.log(
        `  ${APPLY ? "✓" : "[dry] ~"} UPDATE ${b.name} price ${currentPrice.toLocaleString("vi-VN")} → ${b.pricePerTube.toLocaleString("vi-VN")}đ/ống`,
      );
    } else {
      console.log(`  ↷ ${b.name} đã đúng giá ${b.pricePerTube.toLocaleString("vi-VN")}đ`);
    }
  }
}

// ─── inventory_purchase rows: sync price snapshot với brand ──────────────

console.log(`\n=== INVENTORY PURCHASE PRICES ===`);
// Bất kỳ inventory_purchase nào có pricePerTube khác giá hiện tại của brand
// → cập nhật cho đúng (vì giá brand vừa được sửa từ giá sai lúc seed-fresh).
const purchaseRows = await client.execute(`
  SELECT ip.id, ip.brand_id, ip.tubes, ip.price_per_tube, ip.total_price, sb.name AS brand_name, sb.price_per_tube AS brand_price
  FROM inventory_purchases ip
  JOIN shuttlecock_brands sb ON sb.id = ip.brand_id
`);
for (const row of purchaseRows.rows) {
  const oldPrice = Number(row.price_per_tube);
  const newPrice = Number(row.brand_price);
  const tubes = Number(row.tubes);
  if (oldPrice !== newPrice) {
    if (APPLY) {
      await client.execute({
        sql: `UPDATE inventory_purchases SET price_per_tube = ?, total_price = ? WHERE id = ?`,
        args: [newPrice, newPrice * tubes, row.id],
      });
    }
    console.log(
      `  ${APPLY ? "✓" : "[dry] ~"} purchase #${row.id} (${row.brand_name}): ${oldPrice.toLocaleString("vi-VN")} → ${newPrice.toLocaleString("vi-VN")}đ/ống`,
    );
  } else {
    console.log(`  ↷ purchase #${row.id} (${row.brand_name}) đã đúng giá`);
  }
}

// ─── Verify ──────────────────────────────────────────────────────────────

if (APPLY) {
  console.log(`\n=== VERIFY ===`);
  const courts = await client.execute(`SELECT name, price_per_session, price_per_session_retail FROM courts ORDER BY id`);
  console.log(`Courts (${courts.rows.length}):`);
  for (const r of courts.rows) {
    const monthly = Number(r.price_per_session);
    const retail = r.price_per_session_retail != null ? Number(r.price_per_session_retail) : null;
    console.log(`  ${r.name.padEnd(28)} tháng ${monthly.toLocaleString("vi-VN")}đ${retail ? ` / lẻ ${retail.toLocaleString("vi-VN")}đ` : ""}`);
  }
  const brands = await client.execute(`SELECT name, price_per_tube FROM shuttlecock_brands ORDER BY id`);
  console.log(`\nBrands (${brands.rows.length}):`);
  for (const r of brands.rows) {
    console.log(`  ${r.name.padEnd(20)} ${Number(r.price_per_tube).toLocaleString("vi-VN")}đ/ống`);
  }
}

client.close();

if (!APPLY) {
  console.log(`\n🟡 Dry-run done. Re-run với --apply để ghi vào DB.`);
}
