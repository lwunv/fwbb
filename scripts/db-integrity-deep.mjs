// Deep DB integrity check — orphans, dangling FKs, weird states.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const findings = [];
const push = (sev, msg, detail) => findings.push({ sev, msg, detail });

async function q(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}

// 1. session_attendees → members FK
const orphanAttendees = await q(`
  SELECT sa.id, sa.session_id, sa.member_id
  FROM session_attendees sa
  WHERE sa.member_id IS NOT NULL
    AND sa.member_id NOT IN (SELECT id FROM members)
`);
if (orphanAttendees.length)
  push("ERROR", "session_attendees ref missing member", orphanAttendees);

// 2. session_attendees → invitedBy FK
const orphanInvited = await q(`
  SELECT sa.id, sa.session_id, sa.invited_by_id
  FROM session_attendees sa
  WHERE sa.invited_by_id IS NOT NULL
    AND sa.invited_by_id NOT IN (SELECT id FROM members)
`);
if (orphanInvited.length)
  push("ERROR", "session_attendees ref missing invitedBy", orphanInvited);

// 3. session_debts → session FK
const orphanDebts = await q(`
  SELECT sd.id, sd.session_id, sd.member_id
  FROM session_debts sd
  WHERE sd.session_id NOT IN (SELECT id FROM sessions)
`);
if (orphanDebts.length)
  push("ERROR", "session_debts ref missing session", orphanDebts);

// 4. session_shuttlecocks → session FK
const orphanShuttles = await q(`
  SELECT ss.id, ss.session_id
  FROM session_shuttlecocks ss
  WHERE ss.session_id NOT IN (SELECT id FROM sessions)
`);
if (orphanShuttles.length)
  push("ERROR", "session_shuttlecocks ref missing session", orphanShuttles);

// 5. financial_transactions → session FK (when session_id set)
const orphanTxSession = await q(`
  SELECT ft.id, ft.session_id, ft.type
  FROM financial_transactions ft
  WHERE ft.session_id IS NOT NULL
    AND ft.session_id NOT IN (SELECT id FROM sessions)
`);
if (orphanTxSession.length)
  push(
    "WARN",
    "financial_transactions ref missing session (expected after deleteSession with NULL out)",
    orphanTxSession.slice(0, 5),
  );

// 6. session attendees where member is also explicit guest (data ambiguity)
const ambiguousAttendees = await q(`
  SELECT id, session_id, member_id, is_guest, invited_by_id
  FROM session_attendees
  WHERE is_guest = 1 AND member_id IS NOT NULL
`);
if (ambiguousAttendees.length)
  push(
    "WARN",
    "session_attendees: is_guest=1 BUT member_id set (ambiguous)",
    ambiguousAttendees.slice(0, 5),
  );

// 7. session_attendees: is_guest=0 but invitedBy set (data ambiguity)
const ambiguousAttendees2 = await q(`
  SELECT id, session_id, member_id, is_guest, invited_by_id
  FROM session_attendees
  WHERE is_guest = 0 AND invited_by_id IS NOT NULL
`);
if (ambiguousAttendees2.length)
  push(
    "WARN",
    "session_attendees: is_guest=0 BUT invited_by_id set",
    ambiguousAttendees2.slice(0, 5),
  );

// 8. session_attendees: is_guest=1 but invitedBy NULL (orphan guest)
const orphanGuests = await q(`
  SELECT id, session_id, is_guest, member_id, invited_by_id
  FROM session_attendees
  WHERE is_guest = 1 AND invited_by_id IS NULL
`);
if (orphanGuests.length)
  push("ERROR", "guest attendees without inviter", orphanGuests.slice(0, 5));

// 9. session_debts with NULL session_id (should never happen after schema)
const nullSessionDebts = await q(`
  SELECT id, member_id FROM session_debts WHERE session_id IS NULL
`);
if (nullSessionDebts.length)
  push("ERROR", "session_debts with NULL session_id", nullSessionDebts);

// 10. Sessions in "completed" status without any session_debts
const completedNoDebts = await q(`
  SELECT s.id, s.session_date, s.status
  FROM sessions s
  WHERE s.status = 'completed'
    AND NOT EXISTS (SELECT 1 FROM session_debts WHERE session_id = s.id)
`);
if (completedNoDebts.length)
  push(
    "WARN",
    "completed sessions without any session_debts (no one charged?)",
    completedNoDebts,
  );

// 11. Sessions with status='completed' but no fund_deductions
const completedNoDeductions = await q(`
  SELECT s.id, s.session_date, s.status
  FROM sessions s
  WHERE s.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM financial_transactions
      WHERE session_id = s.id AND type='fund_deduction' AND reversal_of_id IS NULL
    )
`);
if (completedNoDeductions.length)
  push(
    "ERROR",
    "completed sessions without any fund_deduction (broken finalizeSession?)",
    completedNoDeductions,
  );

// 12. Fund deductions referencing missing sessionDebt (when debtId set)
const orphanFundDeductionDebt = await q(`
  SELECT ft.id, ft.debt_id, ft.type
  FROM financial_transactions ft
  WHERE ft.debt_id IS NOT NULL
    AND ft.debt_id NOT IN (SELECT id FROM session_debts)
`);
if (orphanFundDeductionDebt.length)
  push(
    "WARN",
    "financial_transactions debt_id refs missing debt",
    orphanFundDeductionDebt.slice(0, 5),
  );

// 13. Members marked is_admin but no admins row?
const adminInconsistent = await q(`
  SELECT m.id, m.name FROM members m
  WHERE m.id NOT IN (SELECT member_id FROM admins WHERE member_id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM admins WHERE member_id = m.id)
`);
if (adminInconsistent.length)
  push("WARN", "admin inconsistency", adminInconsistent);

// 14. shuttlecock_brands with negative stockAdjustQua
const weirdAdjust = await q(`
  SELECT id, name, stock_adjust_qua FROM shuttlecock_brands WHERE stock_adjust_qua < -100
`);
if (weirdAdjust.length)
  push(
    "NOTE",
    "shuttlecock_brand large negative stockAdjustQua",
    weirdAdjust,
  );

// 15. session_shuttlecocks with non-positive quantity_used or pricePerTube
const badShuttles = await q(`
  SELECT id, session_id, quantity_used, price_per_tube
  FROM session_shuttlecocks
  WHERE quantity_used <= 0 OR price_per_tube <= 0
`);
if (badShuttles.length)
  push("ERROR", "session_shuttlecocks invalid quantity/price", badShuttles);

// 16. Sessions with admin_guest_play_count > 0 but no Châu debt row
const adminGuestNoChauDebt = await q(`
  SELECT s.id, s.session_date, s.admin_guest_play_count
  FROM sessions s
  WHERE COALESCE(s.admin_guest_play_count, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM session_debts WHERE session_id = s.id AND member_id = 1
    )
`);
if (adminGuestNoChauDebt.length)
  push(
    "WARN",
    "sessions with admin guests but no Châu (member_id=1) debt row",
    adminGuestNoChauDebt,
  );

// 17. Total fund balance check — Σ contribution − Σ deduction − Σ refund (excl pairs)
const totalRows = await q(`
  SELECT type, SUM(amount) as total
  FROM financial_transactions
  WHERE reversal_of_id IS NULL
    AND id NOT IN (SELECT reversal_of_id FROM financial_transactions WHERE reversal_of_id IS NOT NULL)
    AND type IN ('fund_contribution','fund_deduction','fund_refund')
  GROUP BY type
`);
console.log("\n=== Fund total by type (excluding reversal pairs) ===");
for (const r of totalRows) {
  console.log(`  ${r.type.padEnd(20)} ${Number(r.total).toLocaleString("vi-VN")}đ`);
}

// 18. Sessions with no court_id (should be allowed only for legacy)
const sessionsNoCourt = await q(`
  SELECT id, session_date FROM sessions WHERE court_id IS NULL
`);
if (sessionsNoCourt.length)
  push("NOTE", "sessions with no court_id", sessionsNoCourt.slice(0, 5));

// 19. court_rent_payments with negative amount or zero
const badRentPayments = await q(`
  SELECT id, amount, month, year, metadata FROM court_rent_payments WHERE amount <= 0
`);
if (badRentPayments.length)
  push("ERROR", "court_rent_payments with non-positive amount", badRentPayments);

// 20. court_rent_payments missing bucket metadata (legacy)
const noBucketRent = await q(`
  SELECT id, amount, month, year, metadata FROM court_rent_payments
  WHERE metadata IS NULL OR metadata NOT LIKE '%bucket%'
`);
if (noBucketRent.length)
  push(
    "NOTE",
    "court_rent_payments with no bucket meta (legacy → treated as 'fixed')",
    noBucketRent.slice(0, 5),
  );

// Print
console.log("\n=== DB Integrity Findings ===");
if (findings.length === 0) {
  console.log("✅ No issues found.");
} else {
  for (const f of findings) {
    console.log(`\n[${f.sev}] ${f.msg}`);
    if (f.detail && Array.isArray(f.detail) && f.detail.length > 0) {
      for (const row of f.detail) console.log("    ", row);
    }
  }
}
