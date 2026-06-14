import fs from "node:fs";
const vi = JSON.parse(fs.readFileSync("src/i18n/messages/vi.json", "utf8"));
const get = (o, p) => p.split(".").reduce((x, k) => (x ? x[k] : undefined), o);

const files = [
  "src/components/layout/admin-mobile-nav.tsx",
  "src/components/sessions/min-deduction-toggle.tsx",
  "src/components/sessions/court-selector.tsx",
  "src/components/sessions/guest-form.tsx",
  "src/components/fund/fund-adjust-dialog.tsx",
  "src/app/(admin)/admin/sessions/session-list.tsx",
];

let misses = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const map = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\("([^"]+)"\)/g))
    map[m[1]] = m[2];
  const vars = Object.keys(map);
  if (!vars.length) {
    console.log(`  (${f.split("/").pop()}: no useTranslations)`);
    continue;
  }
  const re = new RegExp(`\\b(${vars.join("|")})(?:\\.rich)?\\(\\s*["']([^"']+)["']`, "g");
  let used = 0;
  const bad = [];
  for (const m of src.matchAll(re)) {
    used++;
    const ns = map[m[1]], key = m[2];
    if (get(vi, ns + "." + key) === undefined) bad.push(`${m[1]}("${key}") → ${ns}.${key}`);
  }
  console.log(
    `${bad.length ? "✗" : "✓"} ${f.split("/").pop()}  (${used} calls, ${vars.map((v) => v + "=" + map[v]).join(", ")})` +
      (bad.length ? "\n    MISSING: " + bad.join("; ") : ""),
  );
  misses += bad.length;
}
console.log(misses === 0 ? "\nALL i18n keys resolve ✓" : `\n${misses} MISSING KEYS ✗`);
process.exit(misses === 0 ? 0 : 1);
