/**
 * Chống sót: mọi HÀM nghiệp vụ ghi sổ cho member phải gọi
 * afterMemberMoneyChange, nếu không member có thể nợ quá hạn mức mà phiếu vẫn
 * còn (spec 2026-11-06-debt-vote-block-design.md mục 4.3). Kiểm theo từng hàm,
 * không theo file: file đã có một hàm gọi thì hàm mới quên gọi vẫn phải đỏ
 * (review cuối 6/11/2026).
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

const LEDGER_WRITE =
  /recordFinancialTransaction\(|\.insert\(financialTransactions\)/;

/**
 * Tên các hàm cấp cao nhất có ghi sổ mà không gọi afterMemberMoneyChange.
 * Tách nguồn theo dòng bắt đầu bằng `async function` / `export async function`
 * (đúng kiểu viết action ở repo này).
 */
function findUnwiredLedgerWriters(src: string): string[] {
  const parts = src.split(/\n(?=(?:export )?async function )/);
  return parts
    .map((body) => ({
      name: /^(?:export )?async function (\w+)/.exec(body)?.[1],
      body,
    }))
    .filter(
      ({ name, body }) =>
        name !== undefined &&
        LEDGER_WRITE.test(body) &&
        !body.includes("afterMemberMoneyChange("),
    )
    .map(({ name }) => name as string);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("findUnwiredLedgerWriters (bộ quét)", () => {
  it("bắt hàm ghi sổ quên gọi afterMemberMoneyChange dù hàm khác cùng file có gọi", () => {
    const src = [
      "export async function good() {",
      "  await recordFinancialTransaction({}, tx);",
      "  await afterMemberMoneyChange(tx, changes);",
      "}",
      "async function forgot() {",
      "  await tx.insert(financialTransactions).values({});",
      "}",
      "export async function readOnly() {",
      "  return 1;",
      "}",
    ].join("\n");
    expect(findUnwiredLedgerWriters(src)).toEqual(["forgot"]);
  });
});

describe("debt vote block coverage", () => {
  it("mọi hàm ghi sổ đều gọi afterMemberMoneyChange", () => {
    const missing = walk(join(ROOT, "src"))
      .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
      .map((p) => ({ rel: relative(ROOT, p).split(sep).join("/"), p }))
      .filter(({ rel }) => !EXEMPT.has(rel))
      .flatMap(({ rel, p }) =>
        findUnwiredLedgerWriters(readFileSync(p, "utf8")).map(
          (fn) => `${rel}#${fn}`,
        ),
      );
    expect(missing).toEqual([]);
  });
});
