/**
 * One-off generator: turns the API-security-audit workflow JSON into
 * docs/SECURITY-API-CHECKLIST.md. Run with the audit output path as argv[2].
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = process.argv[2];
const data = JSON.parse(readFileSync(src, "utf8")).result;
const rows = data.checklist;

const mark = (v) => (v === "yes" ? "✅" : v === "no" ? "❌" : v === "partial" ? "◑" : "—");
const piiMark = (b) => (b ? "⚠️" : "—");
const order = { admin: 0, member: 1, owner: 2, webhook: 3, public: 4 };
const groupTitle = {
  admin: "🔐 Admin-only (requireAdmin)",
  member: "👤 Member / owner-scoped (cookie)",
  owner: "👤 Member / owner-scoped (cookie)",
  webhook: "🤖 Webhook / cron (shared secret)",
  public: "🌐 Public-by-design (read / auth entry)",
};

const groups = {};
for (const r of rows) {
  const k = r.authNeeded === "owner" ? "member" : r.authNeeded;
  (groups[k] ||= []).push(r);
}

let md = `# FWBB — API Security Checklist

> Tự sinh từ đợt audit per-endpoint (adversarial + skeptic-verify). **${data.totalEndpoints} endpoint** (server actions + API routes + inline action).
> **Kết quả: ${data.confirmedRisks.length} risk còn mở.** Mọi endpoint đổi-state đều có auth gate; money write có idempotencyKey + Zod + recompute server-side; public read whitelist cột (không lộ PII).

**Cột:** Gate = auth thực thi trước khi đọc/ghi · Valid = validate input (Zod/guard) · IDOR = chặn truy cập chéo (id từ cookie/owner-check) · RL = rate-limit · PII = trả PII ra client.
**Ký hiệu:** ✅ có · ❌ thiếu · ◑ một phần · — không áp dụng · ⚠️ có PII (đã gate admin).

`;

for (const k of Object.keys(groups).sort((a, b) => order[a] - order[b])) {
  md += `\n## ${groupTitle[k]} — ${groups[k].length}\n\n`;
  md += `| Endpoint | Gate | Valid | IDOR | RL | PII | Verdict |\n|---|:--:|:--:|:--:|:--:|:--:|:--:|\n`;
  for (const r of groups[k]) {
    md += `| \`${r.endpoint}\` | ${mark(r.authEnforced)} | ${mark(r.validated)} | ${mark(r.idor)} | ${mark(r.rateLimited)} | ${piiMark(r.pii)} | ${r.verdict === "OK" ? "✅ OK" : "🔴 " + r.verdict} |\n`;
  }
}

md += `\n## ⚠️ Rủi ro còn lại (đã chấp nhận — không phải lỗ khai thác trong code)
- **DDoS thể tích (L3/4):** việc của hạ tầng — đặt **Cloudflare** trước domain (Vercel chỉ chống cơ bản). Code không tự chống được.
- **CSP** chưa bật — cần chạy Report-Only tune cho Google Identity + Facebook SDK rồi mới enforce.
- **Admin pages** dựa vào proxy gate (\`src/proxy.ts\`, đã verify fail-closed) thay vì requireAdmin từng page — thêm redirect ở layout sẽ loop /admin/login.
- **payment-status** dùng \`LIKE '%memo%'\` (bảng nhỏ; left-anchor rủi ro vỡ match memo ngân hàng).

_Sinh tự động — chạy lại: \`node scripts/gen-security-checklist.mjs <audit.json>\`._
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/SECURITY-API-CHECKLIST.md", md);
console.log(`Wrote docs/SECURITY-API-CHECKLIST.md (${rows.length} endpoints)`);
