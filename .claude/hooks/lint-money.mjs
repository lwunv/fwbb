#!/usr/bin/env node
// PostToolUse hook: lint-money.mjs (FWBB)
//
// WHY: AGENTS.md defines hard "Forbidden in financial code" rules (float math on
// VND, Math.round on money, raw DELETE FROM sessions, `any`, console.log, and
// flipping memberConfirmed/adminConfirmed without a balancing ledger entry — see
// invariant I8 in src/actions/reconcile-fund.ts). A human reviewer can miss these
// in a diff. This hook scans the single file Claude just Edit/Write'd and feeds a
// NON-BLOCKING warning back into the conversation so Claude self-corrects.
//
// PostToolUse runs AFTER the tool already executed, so it CANNOT block. It only
// emits additionalContext. On any failure it stays silent and exits 0 — a buggy
// hook must never break the edit flow.
//
// Node ESM, built-ins only (no jq: not guaranteed on Windows; node is).

import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Each rule: regex + a short reminder shown once if it fires at least once.
// `regex` MUST be global (g) so we can collect every line match.
const RULES = [
  {
    id: "parseFloat",
    regex: /parseFloat\s*\(/g,
    note: "parseFloat() / floating-point math on VND is forbidden. All money is integer VND.",
  },
  {
    id: "Math.round",
    regex: /Math\.round\s*\(/g,
    note: "Math.round() on money is forbidden. Use roundToThousand() (rounds UP to 1K) from src/lib/utils.ts.",
  },
  {
    id: "DELETE FROM sessions",
    regex: /DELETE\s+FROM\s+sessions/gi,
    note: "Raw DELETE FROM sessions is forbidden. Go through deleteSession (AGENTS.md rule 11), which reverses fund_deductions first — otherwise members silently lose fund balance.",
  },
  {
    id: ": any",
    regex: /:\s*any\b/g,
    note: "`any` type is forbidden (TypeScript must be strict).",
  },
  {
    id: "console.log",
    regex: /\bconsole\.log\s*\(/g,
    note: "console.log is forbidden in app code. Use toast for user-facing messages or structured server-side logging.",
  },
  {
    id: "confirm-flag",
    regex: /(memberConfirmed|adminConfirmed)\s*[:=]\s*true/g,
    note: "Setting memberConfirmed/adminConfirmed = true REQUIRES inserting a balancing ledger entry in the same flow (e.g. a fund_deduction / fund_contribution). Breaking this breaks invariant I8 in src/actions/reconcile-fund.ts (severity: error). The flags now only mean 'written to ledger', not 'paid'.",
  },
];

const MAX_MATCHES = 12;

function shouldSkip(normPath) {
  // Skip scripts, seed, and test files — they legitimately use console.log etc.
  if (normPath.includes("/scripts/")) return true;
  if (normPath.includes("/db/seed")) return true;
  if (/\.test\./.test(normPath)) return true; // covers *.test.* and *.integration.test.*
  return false;
}

function main() {
  const raw = readStdin();
  if (!raw) return;

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return; // can't parse hook input → stay silent
  }

  const filePath = obj?.tool_input?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return;

  // Only TypeScript / TSX source files.
  if (!/\.(ts|tsx)$/i.test(filePath)) return;

  const normPath = filePath.replace(/\\/g, "/");
  if (shouldSkip(normPath)) return;

  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return; // file gone / unreadable → silent
  }

  const lines = content.split(/\r?\n/);
  const hits = []; // { line, ruleId, text }
  const firedRules = new Set();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const text = lines[i];
    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(text)) {
        firedRules.add(rule.id);
        if (hits.length < MAX_MATCHES) {
          hits.push({ line: lineNo, ruleId: rule.id, text: text.trim() });
        }
      }
    }
  }

  if (hits.length === 0) return; // nothing to warn about

  // Build the warning text. Use file:line so Claude can jump straight there.
  const displayPath = normPath;
  const matchLines = hits
    .map((h) => {
      const snippet = h.text.length > 100 ? h.text.slice(0, 100) + "…" : h.text;
      return `  - ${displayPath}:${h.line}  [${h.ruleId}]  ${snippet}`;
    })
    .join("\n");

  const reminders = RULES.filter((r) => firedRules.has(r.id))
    .map((r) => `  • ${r.note}`)
    .join("\n");

  const truncatedNote =
    hits.length >= MAX_MATCHES
      ? `\n(Showing first ${MAX_MATCHES} matches; there may be more.)`
      : "";

  const additionalContext =
    `⚠️ FWBB money/code lint flagged patterns in the file you just edited.\n` +
    `These are listed under AGENTS.md "⛔ Forbidden in financial code" / "⛔ Forbidden Actions". ` +
    `Review each one — if it is in financial/app code, fix it; if it is a deliberate exception, confirm why.\n\n` +
    `Matches:\n${matchLines}${truncatedNote}\n\n` +
    `Why these matter:\n${reminders}`;

  const out = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  };

  process.stdout.write(JSON.stringify(out));
}

try {
  main();
} catch {
  // Never block on hook failure.
}
process.exit(0);
