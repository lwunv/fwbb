import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Updated CSV (rows 18 Tổng / 19 Dư quỹ)
const expected = [
  { aliases: ["Châu"],          contrib: 500_000, spent: 226_000, balance: 274_000 },
  { aliases: ["Lưu"],           contrib: 500_000, spent: 435_000, balance:  65_000 },
  { aliases: ["Cường"],         contrib: 500_000, spent: 244_000, balance: 256_000 },
  { aliases: ["Xuân Trường"],   contrib: 500_000, spent: 116_000, balance: 384_000 },
  { aliases: ["Tin Tin"],       contrib: 500_000, spent:  86_000, balance: 414_000 },
  { aliases: ["Mạnh/Huyền"],    contrib: 500_000, spent: 303_000, balance: 197_000 },
  { aliases: ["Phương"],        contrib: 500_000, spent: 320_000, balance: 180_000 },
  { aliases: ["Ngọc Sơn"],      contrib: 500_000, spent: 118_000, balance: 382_000 },
  { aliases: ["Hùng"],          contrib: 500_000, spent: 119_000, balance: 381_000 },
  { aliases: ["Kỳ"],            contrib: 200_000, spent:  55_000, balance: 145_000 },
  { aliases: ["Sơn"],           contrib: 200_000, spent: 139_000, balance:  61_000 },
  { aliases: ["Quang"],         contrib: 500_000, spent: 119_000, balance: 381_000 },
  { aliases: ["Hiếu"],          contrib: 500_000, spent: 119_000, balance: 381_000 },
  { aliases: ["Phiêu"],         contrib: 500_000, spent: 119_000, balance: 381_000 },
  { aliases: ["Tùng"],          contrib: 250_000, spent: 125_000, balance: 125_000 },
  { aliases: ["Tuấn Anh"],      contrib: 250_000, spent: 170_000, balance:  80_000 },
  { aliases: ["Hoàng Anh"],     contrib: 500_000, spent: 352_000, balance: 148_000 },
  { aliases: ["Tuấn"],          contrib: 500_000, spent:  61_000, balance: 439_000 },
  { aliases: ["Trung"],         contrib: 500_000, spent: 220_000, balance: 280_000 },
  { aliases: ["Lâm"],           contrib: 500_000, spent:  87_000, balance: 413_000 },
  { aliases: ["Liên"],          contrib: 500_000, spent: 155_000, balance: 345_000 },
  { aliases: ["Hiệp"],          contrib: 300_000, spent:  90_000, balance: 210_000 },
  { aliases: ["Hoàng", "Minh Hoàng"], contrib: 200_000, spent: 104_000, balance:  96_000 },
  { aliases: ["MTP", "Sơn Tùng"], contrib: 500_000, spent: 142_000, balance: 358_000 },
  { aliases: ["Phong"],         contrib: 200_000, spent: 104_000, balance:  96_000 },
  { aliases: ["Vân"],           contrib: 200_000, spent:  97_000, balance: 103_000 },
  { aliases: ["Bắc"],           contrib: 500_000, spent:  91_000, balance: 409_000 },
  { aliases: ["Thanh"],         contrib: 500_000, spent:  45_000, balance: 455_000 },
];

const membersRes = await client.execute(
  "SELECT id, name, nickname, is_active FROM members ORDER BY id",
);
const members = membersRes.rows.map((r) => ({
  id: Number(r.id),
  name: String(r.name),
  nickname: r.nickname ? String(r.nickname) : null,
  isActive: Number(r.is_active) === 1,
}));

const txRes = await client.execute(
  `SELECT id, type, amount, member_id, reversal_of_id, session_id, created_at, description
   FROM financial_transactions WHERE member_id IS NOT NULL ORDER BY created_at`,
);
const txs = txRes.rows.map((r) => ({
  id: Number(r.id),
  type: String(r.type),
  amount: Number(r.amount),
  memberId: Number(r.member_id),
  reversalOfId: r.reversal_of_id == null ? null : Number(r.reversal_of_id),
  sessionId: r.session_id == null ? null : Number(r.session_id),
  createdAt: r.created_at ? String(r.created_at) : "",
  description: r.description ? String(r.description) : "",
}));

const sessionsRes = await client.execute("SELECT id, date FROM sessions");
const sessionDate = new Map(sessionsRes.rows.map((r) => [Number(r.id), String(r.date)]));

const voidedIds = new Set();
for (const tx of txs) if (tx.reversalOfId !== null) voidedIds.add(tx.reversalOfId);

const sums = new Map();
for (const m of members) sums.set(m.id, { contrib: 0, deduct: 0, refund: 0 });
const liveDeductsByMember = new Map();
for (const tx of txs) {
  if (tx.reversalOfId !== null) continue;
  if (voidedIds.has(tx.id)) continue;
  const s = sums.get(tx.memberId);
  if (!s) continue;
  if (tx.type === "fund_contribution") s.contrib += tx.amount;
  else if (tx.type === "fund_deduction") {
    s.deduct += tx.amount;
    if (!liveDeductsByMember.has(tx.memberId)) liveDeductsByMember.set(tx.memberId, []);
    liveDeductsByMember.get(tx.memberId).push(tx);
  } else if (tx.type === "fund_refund") s.refund += tx.amount;
}

function balOf(id) {
  const s = sums.get(id) ?? { contrib: 0, deduct: 0, refund: 0 };
  return s.contrib - s.deduct - s.refund;
}

function findMember(aliases) {
  const lc = aliases.map((a) => a.toLowerCase().trim());
  // exact
  let hit = members.find(
    (m) =>
      lc.includes(m.name.toLowerCase().trim()) ||
      (m.nickname && lc.includes(m.nickname.toLowerCase().trim())),
  );
  if (hit) return hit;
  // contains
  hit = members.find((m) =>
    lc.some(
      (a) =>
        m.name.toLowerCase().includes(a) ||
        (m.nickname && m.nickname.toLowerCase().includes(a)),
    ),
  );
  return hit;
}

const fmt = (n) =>
  (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("vi-VN") + " đ";

console.log("\n=== TỔNG QUAN — CSV vs DB ===\n");
const header =
  "Member".padEnd(15) +
  "│" + "Nộp CSV".padStart(12) +
  " │" + "Nộp DB".padStart(12) +
  " │" + "Chi CSV".padStart(12) +
  " │" + "Chi DB".padStart(12) +
  " │" + "Dư CSV".padStart(12) +
  " │" + "Dư DB".padStart(12) +
  " │" + "Δ Bal".padStart(12);
console.log(header);
console.log("─".repeat(header.length));

let mismatchCount = 0;
const csvMatched = new Set();
for (const e of expected) {
  const m = findMember(e.aliases);
  if (!m) {
    console.log(`${e.aliases[0].padEnd(15)} ❌ KHÔNG TÌM THẤY trong DB`);
    mismatchCount++;
    continue;
  }
  csvMatched.add(m.id);
  const s = sums.get(m.id);
  const bal = balOf(m.id);
  const diff = bal - e.balance;
  const mark = diff === 0 ? "✓" : fmt(diff);
  if (diff !== 0) mismatchCount++;
  console.log(
    e.aliases[0].padEnd(15) +
      "│" + fmt(e.contrib).padStart(12) +
      " │" + fmt(s.contrib).padStart(12) +
      " │" + fmt(e.spent).padStart(12) +
      " │" + fmt(s.deduct).padStart(12) +
      " │" + fmt(e.balance).padStart(12) +
      " │" + fmt(bal).padStart(12) +
      " │" + mark.padStart(12),
  );
}

console.log("\n=== CHI TIẾT LỆCH ===\n");
for (const e of expected) {
  const m = findMember(e.aliases);
  if (!m) continue;
  const s = sums.get(m.id);
  const bal = balOf(m.id);
  const dBal = bal - e.balance;
  const dContrib = s.contrib - e.contrib;
  const dSpent = s.deduct - e.spent;
  if (dBal === 0 && dContrib === 0 && dSpent === 0) continue;

  console.log(`▸ ${m.name}${m.nickname ? ` (${m.nickname})` : ""} #${m.id}`);
  if (dContrib !== 0) console.log(`    Nộp DB lệch CSV: ${fmt(dContrib)} (DB ${fmt(s.contrib)} vs CSV ${fmt(e.contrib)})`);
  if (dSpent !== 0) console.log(`    Chi DB lệch CSV: ${fmt(dSpent)} (DB ${fmt(s.deduct)} vs CSV ${fmt(e.spent)})`);
  if (dBal !== 0) console.log(`    Dư  DB lệch CSV: ${fmt(dBal)} (DB ${fmt(bal)} vs CSV ${fmt(e.balance)})`);
  // List DB deductions to help spot diff
  const list = (liveDeductsByMember.get(m.id) ?? []).sort((a, b) => {
    const da = a.sessionId != null ? sessionDate.get(a.sessionId) ?? "" : "";
    const db = b.sessionId != null ? sessionDate.get(b.sessionId) ?? "" : "";
    return da.localeCompare(db);
  });
  if (list.length > 0) {
    console.log("    DB deductions:");
    for (const tx of list) {
      const d = tx.sessionId != null ? sessionDate.get(tx.sessionId) ?? "?" : "(manual)";
      console.log(`      ${d}  ${fmt(tx.amount).padStart(11)}  ${tx.description || ""}`);
    }
  }
  console.log();
}

console.log("=== Member active trong DB nhưng KHÔNG có trong CSV ===\n");
for (const m of members) {
  if (csvMatched.has(m.id)) continue;
  if (!m.isActive) continue;
  const bal = balOf(m.id);
  const s = sums.get(m.id);
  if (s.contrib === 0 && s.deduct === 0) continue;
  console.log(`  ${m.name} #${m.id}  Nộp ${fmt(s.contrib)}  Chi ${fmt(s.deduct)}  Bal ${fmt(bal)}`);
}

console.log(`\nTổng: ${expected.length} dòng CSV, ${expected.length - mismatchCount} khớp, ${mismatchCount} lệch.`);
process.exit(0);
