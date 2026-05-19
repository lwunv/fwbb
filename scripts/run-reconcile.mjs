// Reconcile invariant runner — bypass auth, run all checks directly against DB.
// Mirrors src/actions/reconcile-fund.ts logic but exits with code != 0 if errors.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const FUND_TYPES = new Set([
  "fund_contribution",
  "fund_deduction",
  "fund_refund",
]);

async function main() {
  const issues = [];
  const push = (severity, code, message) =>
    issues.push({ severity, code, message });

  const { rows: allFundTxs } = await client.execute({
    sql: `SELECT id, type, direction, amount, member_id as memberId, idempotency_key as idempotencyKey, payment_notification_id as paymentNotificationId, reversal_of_id as reversalOfId, debt_id as debtId
          FROM financial_transactions WHERE type IN ('fund_contribution','fund_deduction','fund_refund')`,
  });
  const { rows: allNotifs } = await client.execute({
    sql: `SELECT id, status, matched_transaction_id as matchedTransactionId FROM payment_notifications`,
  });
  const { rows: txWithNotif } = await client.execute({
    sql: `SELECT id, payment_notification_id as paymentNotificationId FROM financial_transactions WHERE payment_notification_id IS NOT NULL`,
  });
  const { rows: fmRows } = await client.execute({
    sql: `SELECT member_id as memberId FROM fund_members WHERE is_active = 1`,
  });
  const { rows: debtScopedTxs } = await client.execute({
    sql: `SELECT id, type, debt_id as debtId FROM financial_transactions
          WHERE debt_id IS NOT NULL AND type IN ('bank_payment_received','debt_member_confirmed','debt_admin_confirmed','debt_undo','debt_created')`,
  });
  const { rows: reversals } = await client.execute({
    sql: `SELECT id, reversal_of_id as reversalOfId FROM financial_transactions WHERE reversal_of_id IS NOT NULL`,
  });
  const { rows: allMembers } = await client.execute({
    sql: `SELECT id, name FROM members`,
  });
  const nameById = new Map(allMembers.map((m) => [Number(m.id), m.name]));

  // I5: amount sanity
  for (const tx of allFundTxs) {
    const amt = Number(tx.amount);
    if (!Number.isInteger(amt) || amt < 0) {
      push("error", "I5_invalid_amount", `Tx #${tx.id} amount=${amt}`);
    }
  }

  // Reversal pair filter
  const voidedIds = new Set();
  for (const tx of allFundTxs) {
    if (tx.reversalOfId != null) voidedIds.add(Number(tx.reversalOfId));
  }

  // I1: aggregate sums
  let totalIn = 0,
    totalOut = 0,
    totalRefund = 0;
  for (const tx of allFundTxs) {
    if (tx.reversalOfId != null) continue;
    if (voidedIds.has(Number(tx.id))) continue;
    const amt = Number(tx.amount);
    if (tx.type === "fund_contribution") totalIn += amt;
    else if (tx.type === "fund_deduction") totalOut += amt;
    else if (tx.type === "fund_refund") totalRefund += amt;
  }
  const netInternal = totalIn - totalOut - totalRefund;

  // Per-member balances
  const balancesByMember = new Map();
  for (const tx of allFundTxs) {
    if (tx.reversalOfId != null) continue;
    if (voidedIds.has(Number(tx.id))) continue;
    if (!tx.memberId) continue;
    const mid = Number(tx.memberId);
    const amt = Number(tx.amount);
    const prev = balancesByMember.get(mid) ?? 0;
    if (tx.type === "fund_contribution") balancesByMember.set(mid, prev + amt);
    else if (tx.type === "fund_deduction")
      balancesByMember.set(mid, prev - amt);
    else if (tx.type === "fund_refund") balancesByMember.set(mid, prev - amt);
  }
  let sumPositive = 0,
    sumNegative = 0;
  for (const b of balancesByMember.values()) {
    if (b > 0) sumPositive += b;
    else if (b < 0) sumNegative += b;
  }
  const netByMembers = sumPositive + sumNegative;
  if (netInternal !== netByMembers) {
    push(
      "error",
      "I1_imbalance",
      `Tổng internal ${netInternal} != Σ(per-member) ${netByMembers}, lệch ${netInternal - netByMembers}`,
    );
  }

  // I3: matched notif without tx
  const txByNotifId = new Map();
  for (const tx of txWithNotif) {
    if (tx.paymentNotificationId)
      txByNotifId.set(Number(tx.paymentNotificationId), Number(tx.id));
  }
  let matched = 0,
    pending = 0,
    matchedWithoutTx = 0;
  for (const n of allNotifs) {
    if (n.status === "matched") {
      matched++;
      if (!txByNotifId.has(Number(n.id))) {
        matchedWithoutTx++;
        push(
          "warn",
          "I3_matched_without_tx",
          `paymentNotifications #${n.id} matched nhưng không có tx`,
        );
      }
    } else if (n.status === "pending") pending++;
  }

  // I4: tx referencing missing notif
  const notifIds = new Set(allNotifs.map((n) => Number(n.id)));
  let txMissingNotif = 0;
  for (const tx of txWithNotif) {
    if (
      tx.paymentNotificationId &&
      !notifIds.has(Number(tx.paymentNotificationId))
    ) {
      txMissingNotif++;
      push(
        "error",
        "I4_missing_notif",
        `Tx #${tx.id} ref notif #${tx.paymentNotificationId} không tồn tại`,
      );
    }
  }

  // I6: duplicate idempotency keys
  const seenKeys = new Map();
  for (const tx of allFundTxs) {
    if (!tx.idempotencyKey) continue;
    const prev = seenKeys.get(tx.idempotencyKey);
    if (prev !== undefined) {
      push(
        "error",
        "I6_duplicate_idempotency_key",
        `Key "${tx.idempotencyKey}" ở tx #${prev} và #${tx.id}`,
      );
    } else seenKeys.set(tx.idempotencyKey, Number(tx.id));
  }

  // I7: orphan debt refs
  const debtIdSet = new Set();
  for (const t of debtScopedTxs)
    if (t.debtId) debtIdSet.add(Number(t.debtId));
  let debtRows = [];
  if (debtIdSet.size > 0) {
    const ids = [...debtIdSet].join(",");
    const { rows } = await client.execute({
      sql: `SELECT id, member_confirmed as memberConfirmed, admin_confirmed as adminConfirmed FROM session_debts WHERE id IN (${ids})`,
    });
    debtRows = rows;
  }
  const debtById = new Map(debtRows.map((d) => [Number(d.id), d]));
  let orphanDebtRefs = 0;
  for (const t of debtScopedTxs) {
    if (!t.debtId) continue;
    if (!debtById.has(Number(t.debtId))) {
      orphanDebtRefs++;
      push(
        "warn",
        "I7_orphan_debt_ref",
        `Tx #${t.id} (${t.type}) -> debt #${t.debtId} không tồn tại`,
      );
    }
  }

  // I8: bank_payment_received -> must have both confirmed
  const bankPaidDebtIds = new Set(
    debtScopedTxs
      .filter((t) => t.type === "bank_payment_received")
      .map((t) => Number(t.debtId))
      .filter((id) => id),
  );
  let bankPaidPartial = 0;
  for (const did of bankPaidDebtIds) {
    const d = debtById.get(did);
    if (!d) continue;
    if (!d.memberConfirmed || !d.adminConfirmed) {
      bankPaidPartial++;
      push(
        "error",
        "I8_bank_paid_partial_flags",
        `Debt #${did} bank_payment_received nhưng member=${d.memberConfirmed} admin=${d.adminConfirmed}`,
      );
    }
  }

  // I9: orphan reversals
  const reversedIds = reversals
    .map((r) => Number(r.reversalOfId))
    .filter((x) => x);
  let orphanRev = 0;
  if (reversedIds.length > 0) {
    const ids = reversedIds.join(",");
    const { rows: originals } = await client.execute({
      sql: `SELECT id FROM financial_transactions WHERE id IN (${ids})`,
    });
    const origSet = new Set(originals.map((r) => Number(r.id)));
    for (const rev of reversals) {
      if (rev.reversalOfId && !origSet.has(Number(rev.reversalOfId))) {
        orphanRev++;
        push(
          "warn",
          "I9_orphan_reversal",
          `Tx #${rev.id} ref reversalOfId=${rev.reversalOfId} không tồn tại`,
        );
      }
    }
  }

  // Print report
  console.log("\n=== Reconcile Report ===");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log("\n--- Totals (excluding reversal pairs) ---");
  console.log(`  totalIn      = ${totalIn.toLocaleString("vi-VN")}`);
  console.log(`  totalOut     = ${totalOut.toLocaleString("vi-VN")}`);
  console.log(`  totalRefund  = ${totalRefund.toLocaleString("vi-VN")}`);
  console.log(`  netInternal  = ${netInternal.toLocaleString("vi-VN")}`);
  console.log(`  Σ(positive)  = ${sumPositive.toLocaleString("vi-VN")}`);
  console.log(`  Σ(negative)  = ${sumNegative.toLocaleString("vi-VN")}`);
  console.log(`  netByMembers = ${netByMembers.toLocaleString("vi-VN")}`);

  console.log("\n--- Notifications ---");
  console.log(`  matched: ${matched}, pending: ${pending}`);
  console.log(`  matchedWithoutTx: ${matchedWithoutTx}`);
  console.log(`  txMissingNotif:   ${txMissingNotif}`);

  console.log("\n--- Debt ledger ---");
  console.log(`  orphanDebtRefs:    ${orphanDebtRefs}`);
  console.log(`  bankPaidPartial:   ${bankPaidPartial}`);
  console.log(`  orphanReversals:   ${orphanRev}`);

  console.log("\n--- Per-member balances ---");
  const sorted = [...balancesByMember.entries()].sort((a, b) => a[1] - b[1]);
  for (const [mid, bal] of sorted) {
    const name = nameById.get(mid) ?? `#${mid}`;
    const sign = bal < 0 ? "" : "+";
    console.log(
      `  ${name.padEnd(20)} ${sign}${bal.toLocaleString("vi-VN").padStart(12)}`,
    );
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  console.log(
    `\n=== ${errors.length} ERROR(s), ${warns.length} WARN(s) ===`,
  );
  for (const i of issues) {
    console.log(`  [${i.severity.toUpperCase()}] ${i.code}: ${i.message}`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
