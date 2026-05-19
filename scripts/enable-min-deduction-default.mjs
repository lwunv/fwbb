// Flip useMinDeduction = true cho các session voting/confirmed (chưa
// finalize) — chúng đang dùng default cũ (false). Completed/cancelled
// sessions giữ nguyên vì đã chốt sổ với behavior tại thời điểm đó.
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const { rows: before } = await client.execute({
  sql: `SELECT id, date, status, use_min_deduction
        FROM sessions
        WHERE status IN ('voting','confirmed')
        ORDER BY date`,
});
console.log(`Sessions chưa finalize: ${before.length}`);
for (const r of before) {
  console.log(
    `  #${r.id} ${r.date} ${r.status} use_min_deduction=${r.use_min_deduction}`,
  );
}

const r = await client.execute({
  sql: `UPDATE sessions
        SET use_min_deduction = 1
        WHERE status IN ('voting','confirmed') AND COALESCE(use_min_deduction, 0) = 0`,
});
console.log(`\nUpdated ${r.rowsAffected} sessions → use_min_deduction = 1`);
