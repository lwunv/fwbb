import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code tooling dir: holds ephemeral git worktrees + their build
    // output (`.claude/worktrees/*/.next`). Never source to lint; the pattern
    // above only matches `.next` at the repo root, not nested ones.
    ".claude/**",
  ]),
]);

export default eslintConfig;
