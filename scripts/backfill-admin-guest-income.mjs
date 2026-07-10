/**
 * Backfill `session_guest_income` cho các buổi ĐÃ chốt trước khi có tính năng
 * "thu tiền khách của admin vào quỹ" (2026-07-10).
 *
 * Với mỗi completed session (date >= 2026-06-01, sau mốc reset court-rent):
 *   - Tìm debt row của ADMIN (member_id = admin) có guest_play_amount +
 *     guest_dine_amount > 0.
 *   - Nếu CHƯA có `session_guest_income` còn sống cho buổi đó → chèn 1 row
 *     (direction=in, member_id=NULL, session_id, debt_id, amount = guest total).
 *
 * Idempotent: idempotency_key `backfill-guestincome-<sessionId>-<debtId>` +
 * bỏ qua buổi đã có income sống. Chạy `--dry` để xem trước, không có cờ = EXECUTE.
 *
 * KHÔNG đụng balance member nào (memberId=NULL). Không thuộc nhóm fund_* nên
 * không ảnh hưởng invariant I1.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DRY = process.argv.includes("--dry");
const SINCE = "2026-06-01"; // mốc reset court-rent; KHÔNG đụng tháng <6 (đã tất toán)
const fmt = (n) => Number(n).toLocaleString("vi-VN");

console.log(`\nMode: ${DRY ? "DRY RUN" : "EXECUTE"}  (sessions date >= ${SINCE})\n`);

// 1. Admin member id(s)
const admins = await client.execute(`SELECT member_id AS mid FROM admins`);
const adminIds = admins.rows.map((r) => Number(r.mid)).filter((x) => x > 0);
if (adminIds.length === 0) {
  console.log("❌ Không tìm thấy admin member — dừng.");
  process.exit(1);
}
console.log("Admin memberIds:", adminIds);

// 2. Completed sessions since SINCE
const sessions = await client.execute({
  sql: `SELECT id, date FROM sessions WHERE status = 'completed' AND date >= ? ORDER BY date`,
  args: [SINCE],
});

// 3. Existing live session_guest_income by session
const incomeRows = await client.execute(
  `SELECT id, session_id AS sid, amount, reversal_of_id AS rev FROM financial_transactions WHERE type = 'session_guest_income'`,
);
const voided = new Set();
for (const r of incomeRows.rows) if (r.rev != null) voided.add(Number(r.rev));
const liveIncomeBySession = new Map();
for (const r of incomeRows.rows) {
  if (r.rev != null) continue;
  if (voided.has(Number(r.id))) continue;
  const sid = Number(r.sid);
  liveIncomeBySession.set(sid, (liveIncomeBySession.get(sid) ?? 0) + Number(r.amount));
}

// 4. Admin debt rows (guest amounts) by session
const placeholders = adminIds.map(() => "?").join(",");
const debts = await client.execute({
  sql: `SELECT id, session_id AS sid, member_id AS mid,
               guest_play_amount AS gplay, guest_dine_amount AS gdine
        FROM session_debts WHERE member_id IN (${placeholders})`,
  args: adminIds,
});
const adminGuestBySession = new Map(); // sid -> { debtId, amount }
for (const d of debts.rows) {
  const amt = Number(d.gplay) + Number(d.gdine);
  if (amt <= 0) continue;
  adminGuestBySession.set(Number(d.sid), { debtId: Number(d.id), amount: amt });
}

const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const toInsert = [];
for (const s of sessions.rows) {
  const sid = Number(s.id);
  const ag = adminGuestBySession.get(sid);
  if (!ag) continue; // buổi này admin không mời khách
  const live = liveIncomeBySession.get(sid) ?? 0;
  if (live > 0) {
    console.log(`  #${sid} ${s.date}: đã có income ${fmt(live)} → bỏ qua`);
    continue;
  }
  toInsert.push({ sid, date: String(s.date), debtId: ag.debtId, amount: ag.amount });
  console.log(`  #${sid} ${s.date}: SẼ CHÈN session_guest_income +${fmt(ag.amount)} (debt#${ag.debtId})`);
}

const total = toInsert.reduce((s, r) => s + r.amount, 0);
console.log(`\nTổng sẽ cộng vào quỹ: +${fmt(total)}  (${toInsert.length} buổi)\n`);

if (DRY) {
  console.log("DRY RUN — không ghi gì.");
  process.exit(0);
}
if (toInsert.length === 0) {
  console.log("Không có gì để backfill.");
  process.exit(0);
}

for (const r of toInsert) {
  await client.execute({
    sql: `INSERT INTO financial_transactions
          (type, direction, amount, member_id, session_id, debt_id,
           description, idempotency_key, created_at)
          VALUES ('session_guest_income', 'in', ?, NULL, ?, ?, ?, ?, ?)`,
    args: [
      r.amount,
      r.sid,
      r.debtId,
      `Thu tiền khách của admin buổi ${r.date} (backfill)`,
      `backfill-guestincome-${r.sid}-${r.debtId}`,
      now,
    ],
  });
  console.log(`  ✓ #${r.sid} ${r.date}  +${fmt(r.amount)}`);
}
console.log(`\n✅ Xong. Quỹ +${fmt(total)}.`);
process.exit(0);
