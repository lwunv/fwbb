/**
 * One-time data fix: NULL hoá facebook_id placeholder `admin_<ts>_<rand>` trên
 * member do admin tạo trực tiếp.
 *
 * Bối cảnh: createMember (cũ) chèn fake facebookId `admin_...` với comment
 * "will be replaced on first FB login" — logic đó không còn tồn tại. Hậu quả:
 * merge flow vô hiệu (getNameMatches lọc `!facebookId && !googleId`;
 * approveAndMergeMember chỉ graft OAuth vào placeholder rỗng-credential), nên
 * member admin-tạo KHÔNG bao giờ được gợi ý merge khi chính chủ signup.
 * createMember đã được sửa (commit ae9c312) để insert facebookId = NULL; script
 * này dọn các row cũ còn mang fake id.
 *
 * An toàn: fake id không trùng acc FB thật nào (FB id là số); facebook_id
 * nullable + unique-index cho phép nhiều NULL. CHỈ đụng cột facebook_id, không
 * đụng googleId/email/passwordHash. Idempotent — chạy lại match 0 row.
 *
 * Dùng escaped LIKE `'admin\_%' ESCAPE '\'` để `_` là ký tự literal (không phải
 * wildcard 1-ký-tự), chỉ khớp đúng prefix `admin_`.
 *
 * Chạy:
 *   node scripts/cleanup-admin-placeholder-fbid.mjs           → DRY-RUN (chỉ đếm)
 *   node scripts/cleanup-admin-placeholder-fbid.mjs --apply   → thực thi UPDATE
 *
 * KHÔNG in PII (tên/email/SĐT) — chỉ in id + cờ boolean.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL missing trong .env.local");
  process.exit(1);
}
const client = createClient({ url, authToken });

const APPLY = process.argv[2] === "--apply";
const LIKE = `facebook_id LIKE 'admin\\_%' ESCAPE '\\'`;

console.log(`\n🧹 CLEANUP admin placeholder facebookId`);
console.log(`Database: ${url}`);
console.log(`Mode:     ${APPLY ? "APPLY (write)" : "DRY-RUN (read-only)"}\n`);

// Pre-flight: đếm + soi credential khác (không in PII, chỉ id + cờ).
const { rows: matches } = await client.execute(
  `SELECT id,
          (google_id IS NOT NULL)    AS has_google,
          (email IS NOT NULL)        AS has_email,
          (password_hash IS NOT NULL) AS has_pw
   FROM members
   WHERE ${LIKE}
   ORDER BY id ASC`,
);

console.log(`Khớp ${matches.length} member mang fake facebook_id:`);
const ids = matches.map((r) => Number(r.id));
console.log(`  ids: [${ids.join(", ")}]`);
const withOtherCred = matches.filter(
  (r) => Number(r.has_google) || Number(r.has_email) || Number(r.has_pw),
);
console.log(
  `  trong đó có credential khác (google/email/pw): ${withOtherCred.length}` +
    (withOtherCred.length
      ? ` → ids [${withOtherCred.map((r) => Number(r.id)).join(", ")}] (vẫn an toàn: chỉ NULL facebook_id, credential khác giữ nguyên)`
      : ` (toàn bộ là placeholder thuần)`),
);

if (matches.length === 0) {
  console.log(`\n✅ Không còn row nào — đã sạch (idempotent).`);
  client.close();
  process.exit(0);
}

if (!APPLY) {
  console.log(`\n(DRY-RUN) Chạy lại với --apply để thực thi UPDATE.`);
  client.close();
  process.exit(0);
}

// Apply trong write transaction.
const tx = await client.transaction("write");
try {
  await tx.execute(`UPDATE members SET facebook_id = NULL WHERE ${LIKE}`);
  await tx.commit();
} catch (e) {
  await tx.rollback();
  console.error("Rollback:", e);
  process.exit(2);
}

// Verify: after-count phải = 0.
const { rows: after } = await client.execute(
  `SELECT COUNT(*) AS c FROM members WHERE ${LIKE}`,
);
const remaining = Number(after[0].c);
console.log(`\n✓ UPDATE xong. Row còn mang fake id: ${remaining}`);
if (remaining !== 0) {
  console.error(`❌ Vẫn còn ${remaining} row — kiểm tra lại!`);
  process.exit(3);
}

// Spot-check: các id vừa xử lý giờ có facebook_id NULL + đủ điều kiện merge
// (`!facebookId && !googleId`).
const { rows: check } = await client.execute({
  sql: `SELECT id,
               (facebook_id IS NULL) AS fb_null,
               (google_id IS NULL)   AS g_null
        FROM members WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
  args: ids,
});
const mergeable = check.filter(
  (r) => Number(r.fb_null) && Number(r.g_null),
).length;
console.log(
  `  ${ids.length} member đã xử lý → ${mergeable} đủ điều kiện merge (facebookId & googleId đều NULL).`,
);
console.log(`\n✅ Cleanup hoàn tất.`);
client.close();
