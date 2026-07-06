// Backfill `member_oauth_identities` từ cột legacy members.google_id/facebook_id.
// Idempotent: INSERT OR IGNORE dựa trên UNIQUE(provider, provider_uid).
// Data migration đứng NGOÀI chuỗi migration (migration file chỉ DDL — AGENTS.md).
//
// Chạy: node scripts/backfill-oauth-identities.mjs   (mặc định .env.local = PROD)
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const members = await client.execute(
  "SELECT id, google_id, facebook_id, email FROM members WHERE google_id IS NOT NULL OR facebook_id IS NOT NULL",
);

let google = 0;
let facebook = 0;
let skipped = 0;
for (const m of members.rows) {
  if (m.google_id) {
    const r = await client.execute({
      sql: `INSERT OR IGNORE INTO member_oauth_identities (member_id, provider, provider_uid, email)
            VALUES (?, 'google', ?, ?)`,
      args: [m.id, m.google_id, m.email ?? null],
    });
    if (r.rowsAffected > 0) google++;
    else skipped++;
  }
  if (m.facebook_id) {
    const r = await client.execute({
      sql: `INSERT OR IGNORE INTO member_oauth_identities (member_id, provider, provider_uid, email)
            VALUES (?, 'facebook', ?, NULL)`,
      args: [m.id, m.facebook_id],
    });
    if (r.rowsAffected > 0) facebook++;
    else skipped++;
  }
}

const total = await client.execute(
  "SELECT provider, COUNT(*) c FROM member_oauth_identities GROUP BY provider",
);
console.log(
  `Backfill xong: +${google} google, +${facebook} facebook, ${skipped} đã có (skip).`,
);
console.log("Tổng identity hiện tại:");
for (const r of total.rows) console.log(`  ${r.provider}: ${r.c}`);
