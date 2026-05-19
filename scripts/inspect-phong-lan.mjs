// Inspect Phong (id=33) and Lân (id=38) full ledger history.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function dump(memberId, name) {
  console.log(`\n========== ${name} (member_id=${memberId}) ==========`);
  const { rows } = await client.execute({
    sql: `SELECT id, type, direction, amount, description, session_id as sessionId,
                 idempotency_key as idempotencyKey, reversal_of_id as reversalOfId,
                 datetime(created_at, 'unixepoch', '+7 hours') as createdLocal
          FROM financial_transactions
          WHERE member_id = ?
          ORDER BY id ASC`,
    args: [memberId],
  });

  let bal = 0;
  const voided = new Set(
    rows.filter((r) => r.reversalOfId).map((r) => Number(r.reversalOfId)),
  );

  console.log(
    "ID    TYPE                  AMT       DESC                                     REV/VOID",
  );
  for (const r of rows) {
    const isReversal = r.reversalOfId != null ? "REV→" + r.reversalOfId : "";
    const isVoided = voided.has(Number(r.id)) ? "VOIDED" : "";
    const tag = [isReversal, isVoided].filter(Boolean).join(" ");

    let delta = 0;
    if (r.reversalOfId == null && !voided.has(Number(r.id))) {
      if (r.type === "fund_contribution") delta = Number(r.amount);
      else if (r.type === "fund_deduction") delta = -Number(r.amount);
      else if (r.type === "fund_refund") delta = -Number(r.amount);
    }
    bal += delta;
    const deltaStr =
      delta === 0
        ? "       ·"
        : (delta > 0 ? "+" : "") + delta.toLocaleString("vi-VN");

    console.log(
      `${String(r.id).padStart(5)} ${r.type.padEnd(20)} ${deltaStr.padStart(10)} ${(r.description ?? "").padEnd(40).slice(0, 40)} ${tag}`,
    );
  }
  console.log(`Final balance: ${bal.toLocaleString("vi-VN")}đ`);
}

await dump(33, "Phong");
await dump(38, "Lân");

// Also check if Lân in fund_members
const { rows: fm } = await client.execute({
  sql: `SELECT member_id, is_active FROM fund_members WHERE member_id IN (33,38)`,
});
console.log("\nfund_members:", fm);
