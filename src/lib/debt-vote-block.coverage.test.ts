/**
 * Chống sót: mọi file nghiệp vụ ghi sổ cho member phải gọi
 * afterMemberMoneyChange, nếu không member có thể nợ quá hạn mức mà phiếu vẫn
 * còn (spec 2026-11-06-debt-vote-block-design.md mục 4.3).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** File ghi sổ nhưng KHÔNG cho member, hoặc không phải thao tác nghiệp vụ. */
const EXEMPT = new Set([
  "src/actions/court-rent.ts", // tiền thuê sân, không có memberId
  "src/actions/inventory.ts", // mua cầu, không có memberId
  "src/lib/ledger-restore.ts", // khôi phục sao lưu
  "src/lib/financial-ledger.ts", // chính hàm ghi sổ
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("debt vote block coverage", () => {
  it("mọi file gọi recordFinancialTransaction đều gọi afterMemberMoneyChange", () => {
    const missing = walk(join(ROOT, "src"))
      .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
      .map((p) => ({ rel: relative(ROOT, p).split(sep).join("/"), p }))
      .filter(({ rel }) => !EXEMPT.has(rel))
      .filter(({ p }) => {
        const src = readFileSync(p, "utf8");
        return (
          src.includes("recordFinancialTransaction(") &&
          !src.includes("afterMemberMoneyChange(")
        );
      })
      .map(({ rel }) => rel);
    expect(missing).toEqual([]);
  });
});
