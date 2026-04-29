import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const checks = [
  {
    name: "rate_limit_buckets table",
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limit_buckets'",
    expect: 1,
  },
  {
    name: "idempotency_key column on financial_transactions",
    sql: "SELECT name FROM pragma_table_info('financial_transactions') WHERE name='idempotency_key'",
    expect: 1,
  },
  {
    name: "pass_revenue column on sessions",
    sql: "SELECT name FROM pragma_table_info('sessions') WHERE name='pass_revenue'",
    expect: 1,
  },
  {
    name: "price_per_session_retail column on courts",
    sql: "SELECT name FROM pragma_table_info('courts') WHERE name='price_per_session_retail'",
    expect: 1,
  },
  {
    name: "idx_financial_transactions_idempotency_key UNIQUE INDEX",
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_financial_transactions_idempotency_key'",
    expect: 1,
  },
  {
    name: "idx_rate_limit_buckets_reset_at INDEX",
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rate_limit_buckets_reset_at'",
    expect: 1,
  },
];

let allOk = true;
for (const c of checks) {
  const r = await client.execute(c.sql);
  const got = r.rows.length;
  const ok = got === c.expect;
  console.log(`${ok ? "✓" : "✗"} ${c.name} (expected ${c.expect}, got ${got})`);
  if (!ok) allOk = false;
}

console.log(allOk ? "\nAll PROD schema checks passed." : "\nSOME CHECKS FAILED");
client.close();
process.exit(allOk ? 0 : 1);
