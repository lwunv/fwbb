/**
 * Recompute completed sessions under the admin-guest-vs-member-guest rule.
 * Mirrors finalizeSession's transaction EXACTLY but uses the (now fixed)
 * calculateSessionCosts + applyMinDeductionFloor + computeBalanceFromTransactions.
 *
 * Idempotent: reverses prior fund_deductions + min-deduction penalties, nulls
 * debt FK refs, deletes stale session_debts, re-inserts debts + ledger.
 * Does NOT touch session_attendees (unchanged) or session status.
 *
 * Usage:
 *   npx tsx scripts/recompute-guest-sessions.ts local           # → file:./e2e/local.db
 *   npx tsx scripts/recompute-guest-sessions.ts prod            # → TURSO_* from .env.local
 *   npx tsx scripts/recompute-guest-sessions.ts local 29 32     # explicit session ids
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";
import {
  calculateSessionCosts,
  applyMinDeductionFloor,
  type AttendeeInput,
  type MemberDebt,
} from "../src/lib/cost-calculator";
import { computeBalanceFromTransactions } from "../src/lib/fund-core";

const target = process.argv[2];
const sessionIds = process.argv
  .slice(3)
  .map(Number)
  .filter(Boolean) as number[];
const SIDS = sessionIds.length ? sessionIds : [29, 32];

if (target !== "local" && target !== "prod") {
  console.error(
    "Target required: 'local' (e2e/local.db) or 'prod' (.env.local TURSO_*)",
  );
  process.exit(1);
}

const client =
  target === "local"
    ? createClient({ url: "file:./e2e/local.db" })
    : createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });

console.log(
  `\n🎯 TARGET = ${target.toUpperCase()}  sessions = ${SIDS.join(", ")}\n`,
);

const now = new Date().toISOString();

async function main() {
  // admin member id
  const { rows: adminRows } = await client.execute({
    sql: `SELECT member_id as mid FROM admins WHERE member_id IS NOT NULL LIMIT 1`,
  });
  const adminMemberId = adminRows.length ? Number(adminRows[0].mid) : null;
  console.log(`adminMemberId = ${adminMemberId}`);

  for (const sid of SIDS) {
    const { rows: srows } = await client.execute({
      sql: `SELECT id, status, court_price as courtPrice, dining_bill as diningBill,
                 use_min_deduction as umd FROM sessions WHERE id = ?`,
      args: [sid],
    });
    if (!srows.length) {
      console.log(`\n#${sid}: NOT FOUND — skip`);
      continue;
    }
    const s = srows[0];
    if (s.status !== "completed") {
      console.log(`\n#${sid}: status=${s.status} (not completed) — skip`);
      continue;
    }
    const courtPrice = Number(s.courtPrice ?? 0);
    const diningBill = Number(s.diningBill ?? 0);
    const useMinDeduction = Number(s.umd) === 1;

    const { rows: att } = await client.execute({
      sql: `SELECT member_id as memberId, invited_by_id as invitedById,
                 is_guest as isGuest, attends_play as attendsPlay,
                 attends_dine as attendsDine, headcount FROM session_attendees
          WHERE session_id = ?`,
      args: [sid],
    });
    const attendees: AttendeeInput[] = att.map((a) => ({
      memberId: a.memberId === null ? null : Number(a.memberId),
      invitedById: a.invitedById === null ? null : Number(a.invitedById),
      isGuest: Number(a.isGuest) === 1,
      attendsPlay: Number(a.attendsPlay) === 1,
      attendsDine: Number(a.attendsDine) === 1,
      headcount: Number(a.headcount) || 1,
    }));

    const { rows: shut } = await client.execute({
      sql: `SELECT quantity_used as quantityUsed, price_per_tube as pricePerTube
          FROM session_shuttlecocks WHERE session_id = ?`,
      args: [sid],
    });
    const shuttlecocks = shut.map((r) => ({
      quantityUsed: Number(r.quantityUsed),
      pricePerTube: Number(r.pricePerTube),
    }));

    const breakdown = calculateSessionCosts(
      { courtPrice, diningBill },
      attendees,
      shuttlecocks,
      { adminMemberId },
    );

    console.log(`\n=== #${sid} (umd=${useMinDeduction}) ===`);
    console.log(
      `  splitRate=${breakdown.playCostPerHead}  adminGuestRate=${breakdown.adminGuestPlayCostPerHead}  dineRate=${breakdown.dineCostPerHead}`,
    );

    const tx = await client.transaction("write");
    try {
      // 1. Reverse prior non-reversed fund_deductions (skip if already reversed).
      const prior = await tx.execute({
        sql: `SELECT id, amount, member_id as memberId, session_id as sessionId
            FROM financial_transactions
            WHERE session_id = ? AND type = 'fund_deduction' AND reversal_of_id IS NULL`,
        args: [sid],
      });
      for (const d of prior.rows) {
        const already = await tx.execute({
          sql: `SELECT id FROM financial_transactions WHERE reversal_of_id = ? LIMIT 1`,
          args: [Number(d.id)],
        });
        if (already.rows.length) continue;
        await tx.execute({
          sql: `INSERT INTO financial_transactions
              (type, direction, amount, member_id, session_id, reversal_of_id, description, idempotency_key, created_at)
              VALUES ('fund_contribution','in',?,?,?,?,?,?,?)`,
          args: [
            Number(d.amount),
            d.memberId,
            d.sessionId,
            Number(d.id),
            `Hoàn lại khoản trừ quỹ khi tính lại buổi ${sid}`,
            `finalize-reverse-${Number(d.id)}`,
            now,
          ],
        });
      }

      // 2. Reverse prior non-reversed min-deduction penalties.
      const pen = await tx.execute({
        sql: `SELECT id, amount, member_id as memberId, session_id as sessionId
            FROM financial_transactions
            WHERE session_id = ? AND type = 'fund_contribution' AND reversal_of_id IS NULL
                  AND idempotency_key LIKE 'min-deduction-penalty-%'`,
        args: [sid],
      });
      for (const p of pen.rows) {
        const already = await tx.execute({
          sql: `SELECT id FROM financial_transactions WHERE reversal_of_id = ? LIMIT 1`,
          args: [Number(p.id)],
        });
        if (already.rows.length) continue;
        await tx.execute({
          sql: `INSERT INTO financial_transactions
              (type, direction, amount, member_id, session_id, reversal_of_id, description, idempotency_key, created_at)
              VALUES ('fund_refund','out',?,?,?,?,?,?,?)`,
          args: [
            Number(p.amount),
            p.memberId,
            p.sessionId,
            Number(p.id),
            `Hoàn lại phần dư min-60K khi tính lại buổi ${sid}`,
            `finalize-reverse-penalty-${Number(p.id)}`,
            now,
          ],
        });
      }

      // 3. NULL debt_id refs + delete stale session_debts.
      await tx.execute({
        sql: `UPDATE financial_transactions SET debt_id = NULL WHERE session_id = ?`,
        args: [sid],
      });
      await tx.execute({
        sql: `DELETE FROM session_debts WHERE session_id = ?`,
        args: [sid],
      });

      // 4. Member-poverty floor (if useMinDeduction), per member, post-reversal balance.
      let memberDebts: MemberDebt[] = breakdown.memberDebts;
      let exemptIds = new Set<number>();
      if (useMinDeduction) {
        const ex = await tx.execute({
          sql: `SELECT member_id as mid FROM session_min_deduction_exemptions WHERE session_id = ?`,
          args: [sid],
        });
        exemptIds = new Set(ex.rows.map((r) => Number(r.mid)));
        memberDebts = [];
        for (const d of breakdown.memberDebts) {
          if (d.memberId === adminMemberId || exemptIds.has(d.memberId)) {
            memberDebts.push(d);
            continue;
          }
          const mtx = await tx.execute({
            sql: `SELECT id, type, amount, reversal_of_id as reversalOfId
                FROM financial_transactions WHERE member_id = ?`,
            args: [d.memberId],
          });
          const balance = computeBalanceFromTransactions(
            d.memberId,
            mtx.rows.map((r) => ({
              id: Number(r.id),
              type: String(r.type),
              amount: Number(r.amount),
              reversalOfId:
                r.reversalOfId === null ? null : Number(r.reversalOfId),
            })),
          ).balance;
          memberDebts.push(applyMinDeductionFloor(d, balance));
        }
      }

      // 5. Insert debts + ledger.
      for (const debt of memberDebts) {
        const isAdmin = debt.memberId === adminMemberId;
        const fundDeductionAmount = isAdmin
          ? debt.playAmount + debt.dineAmount
          : debt.totalAmount;

        const ins = await tx.execute({
          sql: `INSERT INTO session_debts
              (session_id, member_id, play_amount, dine_amount, guest_play_amount, guest_dine_amount, total_amount,
               member_confirmed, member_confirmed_at, admin_confirmed, admin_confirmed_at)
              VALUES (?,?,?,?,?,?,?,1,?,1,?) RETURNING id`,
          args: [
            sid,
            debt.memberId,
            debt.playAmount,
            debt.dineAmount,
            debt.guestPlayAmount,
            debt.guestDineAmount,
            debt.totalAmount,
            now,
            now,
          ],
        });
        const debtId = Number(ins.rows[0].id);

        await tx.execute({
          sql: `INSERT INTO financial_transactions
              (type, direction, amount, member_id, session_id, debt_id, description, metadata_json, idempotency_key, created_at)
              VALUES ('debt_created','neutral',?,?,?,?,?,?,?,?)`,
          args: [
            debt.totalAmount,
            debt.memberId,
            sid,
            debtId,
            `Phát sinh công nợ buổi (tính lại) ${sid}`,
            JSON.stringify({
              playAmount: debt.playAmount,
              dineAmount: debt.dineAmount,
              guestPlayAmount: debt.guestPlayAmount,
              guestDineAmount: debt.guestDineAmount,
            }),
            `finalize-debt-${sid}-${debt.memberId}-${debtId}`,
            now,
          ],
        });

        if (fundDeductionAmount > 0) {
          await tx.execute({
            sql: `INSERT INTO financial_transactions
                (type, direction, amount, member_id, session_id, debt_id, description, idempotency_key, created_at)
                VALUES ('fund_deduction','out',?,?,?,?,?,?,?)`,
            args: [
              fundDeductionAmount,
              debt.memberId,
              sid,
              debtId,
              `Trừ quỹ buổi (tính lại) ${sid}`,
              `finalize-deduction-${sid}-${debt.memberId}-${debtId}`,
              now,
            ],
          });
        }

        if (useMinDeduction && adminMemberId !== null && !isAdmin) {
          const original = breakdown.memberDebts.find(
            (o) => o.memberId === debt.memberId,
          );
          const penalty =
            debt.totalAmount - (original?.totalAmount ?? debt.totalAmount);
          if (penalty > 0) {
            await tx.execute({
              sql: `INSERT INTO financial_transactions
                  (type, direction, amount, member_id, session_id, debt_id, description, idempotency_key, created_at)
                  VALUES ('fund_contribution','in',?,?,?,?,?,?,?)`,
              args: [
                penalty,
                adminMemberId,
                sid,
                debtId,
                `Phần dư min-60K buổi (tính lại) ${sid} (member ${debt.memberId})`,
                `min-deduction-penalty-${sid}-${debt.memberId}-${debtId}`,
                now,
              ],
            });
          }
        }

        console.log(
          `  m${debt.memberId}${isAdmin ? "*" : " "} play=${debt.playAmount} guest=${debt.guestPlayAmount} dine=${debt.dineAmount} total=${debt.totalAmount} ded=${fundDeductionAmount}`,
        );
      }

      await tx.execute({
        sql: `UPDATE sessions SET updated_at = ? WHERE id = ?`,
        args: [now, sid],
      });
      await tx.commit();
      console.log(`  ✅ #${sid} recomputed`);
    } catch (err) {
      await tx.rollback();
      console.error(
        `  ❌ #${sid} failed, rolled back:`,
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
