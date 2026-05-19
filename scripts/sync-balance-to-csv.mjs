/**
 * Chỉnh balance từng member để khớp với CSV kế toán (Quỹ FWBB 2026-05-18).
 * Insert 1 transaction điều chỉnh / member (fund_contribution nếu cần tăng,
 * fund_deduction nếu cần giảm). Idempotent qua idempotencyKey.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DRY_RUN = process.argv.includes("--dry");
const RUN_TAG = "2026-05-18-csv-sync";

// Target balance: theo CSV, trừ Phong (user xác nhận 400K nộp − 104K chi = 296K)
const targets = [
  { aliases: ["Châu"],            target: 274_000 },
  { aliases: ["Lưu"],             target:  65_000 },
  { aliases: ["Cường"],           target: 256_000 },
  { aliases: ["Xuân Trường"],     target: 384_000 },
  { aliases: ["Tin Tin"],         target: 414_000 },
  { aliases: ["Mạnh/Huyền"],      target: 197_000 },
  { aliases: ["Phương"],          target: 180_000 },
  { aliases: ["Ngọc Sơn"],        target: 382_000 },
  { aliases: ["Hùng"],            target: 381_000 },
  { aliases: ["Kỳ"],              target: 145_000 },
  { aliases: ["Sơn"],             target:  61_000 },
  { aliases: ["Quang"],           target: 381_000 },
  { aliases: ["Hiếu"],            target: 381_000 },
  { aliases: ["Phiêu"],           target: 381_000 },
  { aliases: ["Tùng"],            target: 125_000 },
  { aliases: ["Tuấn Anh"],        target:  80_000 },
  { aliases: ["Hoàng Anh"],       target: 148_000 },
  { aliases: ["Tuấn"],            target: 439_000 },
  { aliases: ["Trung"],           target: 280_000 },
  { aliases: ["Lâm"],             target: 413_000 },
  { aliases: ["Liên"],            target: 345_000 },
  { aliases: ["Hiệp"],            target: 210_000 },
  { aliases: ["Minh Hoàng", "Hoàng"], target:  96_000 },
  { aliases: ["Sơn Tùng", "MTP"], target: 358_000 },
  { aliases: ["Phong"],           target: 296_000 }, // override: 400K nộp − 104K chi
  { aliases: ["Vân"],             target: 103_000 },
  { aliases: ["Bắc"],             target: 409_000 },
  { aliases: ["Thanh"],           target: 455_000 },
];

const membersRes = await client.execute(
  "SELECT id, name, nickname FROM members ORDER BY id",
);
const members = membersRes.rows.map((r) => ({
  id: Number(r.id),
  name: String(r.name),
  nickname: r.nickname ? String(r.nickname) : null,
}));

function findMember(aliases) {
  const lc = aliases.map((a) => a.toLowerCase().trim());
  let hit = members.find(
    (m) =>
      lc.includes(m.name.toLowerCase().trim()) ||
      (m.nickname && lc.includes(m.nickname.toLowerCase().trim())),
  );
  if (hit) return hit;
  return members.find((m) =>
    lc.some(
      (a) =>
        m.name.toLowerCase().includes(a) ||
        (m.nickname && m.nickname.toLowerCase().includes(a)),
    ),
  );
}

// Read all transactions once
const txRes = await client.execute(
  `SELECT id, type, amount, member_id, reversal_of_id
   FROM financial_transactions WHERE member_id IS NOT NULL`,
);
const txs = txRes.rows.map((r) => ({
  id: Number(r.id),
  type: String(r.type),
  amount: Number(r.amount),
  memberId: Number(r.member_id),
  reversalOfId: r.reversal_of_id == null ? null : Number(r.reversal_of_id),
}));

const voidedIds = new Set();
for (const tx of txs) if (tx.reversalOfId !== null) voidedIds.add(tx.reversalOfId);

function balOf(memberId) {
  let bal = 0;
  for (const tx of txs) {
    if (tx.memberId !== memberId) continue;
    if (tx.reversalOfId !== null) continue;
    if (voidedIds.has(tx.id)) continue;
    if (tx.type === "fund_contribution") bal += tx.amount;
    else if (tx.type === "fund_deduction") bal -= tx.amount;
    else if (tx.type === "fund_refund") bal -= tx.amount;
  }
  return bal;
}

const fmt = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("vi-VN") + " đ";

console.log(`\nMode: ${DRY_RUN ? "DRY RUN" : "EXECUTE"}\n`);
console.log(
  "Member".padEnd(15) +
    "│" + "DB hiện tại".padStart(14) +
    " │" + "Target CSV".padStart(14) +
    " │" + "Delta".padStart(14) +
    " │" + "Action".padStart(20),
);
console.log("─".repeat(82));

const plan = [];
for (const t of targets) {
  const m = findMember(t.aliases);
  if (!m) {
    console.log(`${t.aliases[0].padEnd(15)} ❌ KHÔNG TÌM THẤY`);
    continue;
  }
  const cur = balOf(m.id);
  const delta = t.target - cur;
  let action = "✓ khớp";
  if (delta > 0) action = `+contribution ${fmt(delta)}`;
  else if (delta < 0) action = `+deduction ${fmt(-delta)}`;
  console.log(
    m.name.padEnd(15) +
      "│" + fmt(cur).padStart(14) +
      " │" + fmt(t.target).padStart(14) +
      " │" + fmt(delta).padStart(14) +
      " │" + action.padStart(20),
  );
  if (delta !== 0) plan.push({ member: m, delta });
}

const totalContribAdj = plan.filter((p) => p.delta > 0).reduce((a, b) => a + b.delta, 0);
const totalDeductAdj = plan.filter((p) => p.delta < 0).reduce((a, b) => a - b.delta, 0);
console.log(`\nTổng sẽ insert: +${fmt(totalContribAdj)} contribution, -${fmt(totalDeductAdj)} deduction`);
console.log(`Số member cần chỉnh: ${plan.length}`);

if (DRY_RUN || plan.length === 0) {
  if (DRY_RUN) console.log("\nDRY RUN — không thay đổi DB.");
  process.exit(0);
}

const now = new Date().toISOString().replace("T", " ").slice(0, 19);

for (const p of plan) {
  const isContrib = p.delta > 0;
  const amount = Math.abs(p.delta);
  const idempKey = `${RUN_TAG}-${p.member.id}`;
  await client.execute({
    sql: `INSERT INTO financial_transactions
          (type, direction, amount, member_id, description, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      isContrib ? "fund_contribution" : "fund_deduction",
      isContrib ? "in" : "out",
      amount,
      p.member.id,
      `Hiệu chỉnh khớp sổ kế toán ${RUN_TAG}`,
      idempKey,
      now,
    ],
  });
  console.log(`  ✓ ${p.member.name.padEnd(15)} ${isContrib ? "+" : "-"}${fmt(amount)}`);
}

console.log(`\n✅ Đã chỉnh ${plan.length} member.\n`);

// Verify
console.log("Verify số dư sau chỉnh:\n");
const txRes2 = await client.execute(
  `SELECT id, type, amount, member_id, reversal_of_id
   FROM financial_transactions WHERE member_id IS NOT NULL`,
);
const txs2 = txRes2.rows.map((r) => ({
  id: Number(r.id),
  type: String(r.type),
  amount: Number(r.amount),
  memberId: Number(r.member_id),
  reversalOfId: r.reversal_of_id == null ? null : Number(r.reversal_of_id),
}));
const voided2 = new Set();
for (const tx of txs2) if (tx.reversalOfId !== null) voided2.add(tx.reversalOfId);
function bal2(id) {
  let b = 0;
  for (const tx of txs2) {
    if (tx.memberId !== id) continue;
    if (tx.reversalOfId !== null) continue;
    if (voided2.has(tx.id)) continue;
    if (tx.type === "fund_contribution") b += tx.amount;
    else if (tx.type === "fund_deduction") b -= tx.amount;
    else if (tx.type === "fund_refund") b -= tx.amount;
  }
  return b;
}

let totalFund = 0;
let allMatch = true;
for (const t of targets) {
  const m = findMember(t.aliases);
  if (!m) continue;
  const cur = bal2(m.id);
  const ok = cur === t.target;
  if (!ok) allMatch = false;
  totalFund += cur;
  console.log(
    `  ${m.name.padEnd(15)} ${fmt(cur).padStart(12)}  ${ok ? "✓" : `❌ expected ${fmt(t.target)}`}`,
  );
}
console.log(`\nTổng quỹ (28 member CSV): ${fmt(totalFund)}`);
console.log(allMatch ? "✅ Tất cả khớp CSV." : "❌ Còn lệch — check lại.");
process.exit(0);
