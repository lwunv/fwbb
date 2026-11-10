/**
 * Test tích hợp cho restore-db.mjs: chạy CHÍNH script thật qua subprocess, nạp
 * vào một database libsql FILE cục bộ. Mục tiêu là khoá chặt tính đúng trước
 * khi đổi vòng INSERT từng-dòng sang INSERT theo lô (gộp nhiều dòng một lệnh để
 * cắt round-trip mạng, nguyên nhân restore 4418 dòng mất ~8 phút và chạm timeout
 * CI ngày 05/11/2026).
 *
 * Phải giữ nguyên: một giao dịch duy nhất, hoãn khoá ngoại cho VÒNG
 * payment_notifications <-> financial_transactions, xoá sạch rồi ghi lại, và
 * đếm lại số dòng từng bảng sau khi ghi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let dir;
let targetPath;
let targetUrl;
let dumpPath;

// Một bảng "wide" nhiều cột + nhiều dòng để chắc chắn vượt một lô và ép chia
// nhỏ theo trần số biến của SQLite.
const WIDE_COLS = 12;
const WIDE_ROWS = 1000;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fwbb-restore-test-"));
  targetPath = join(dir, "target.db");
  targetUrl = pathToFileURL(targetPath).href;
  dumpPath = join(dir, "dump.json");

  // Dựng schema đích. restore-db từ chối nếu thiếu bảng, nên phải tạo trước.
  const c = createClient({ url: targetUrl });
  await c.execute(`CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT)`);
  await c.execute(`CREATE TABLE empty_table (id INTEGER PRIMARY KEY)`);
  const wideCols = Array.from({ length: WIDE_COLS }, (_, i) => `c${i}`);
  await c.execute(
    `CREATE TABLE wide (id INTEGER PRIMARY KEY, ${wideCols.map((x) => `${x} TEXT`).join(", ")})`,
  );
  // Vòng khoá ngoại thật của dự án.
  await c.execute(
    `CREATE TABLE financial_transactions (id INTEGER PRIMARY KEY, payment_notification_id INTEGER REFERENCES payment_notifications(id))`,
  );
  await c.execute(
    `CREATE TABLE payment_notifications (id INTEGER PRIMARY KEY, matched_transaction_id INTEGER REFERENCES financial_transactions(id))`,
  );
  // Có sẵn dữ liệu cũ để chắc restore XOÁ SẠCH rồi ghi lại, không cộng dồn.
  await c.execute(`INSERT INTO members (id, name) VALUES (99, 'cũ')`);
  c.close();

  // Dựng dump: members 3 dòng, wide 1000 dòng, 2 bảng vòng tham chiếu chéo,
  // empty_table rỗng.
  const wide = [];
  for (let i = 1; i <= WIDE_ROWS; i++) {
    const row = { id: i };
    for (const col of wideCols) row[col] = `${col}-v${i}`;
    wide.push(row);
  }
  const dump = {
    meta: { takenAt: new Date().toISOString() },
    tables: {
      members: [
        { id: 1, name: "Châu" },
        { id: 2, name: "An" },
        { id: 3, name: "Bình" },
      ],
      wide,
      empty_table: [],
      financial_transactions: [{ id: 10, payment_notification_id: 20 }],
      payment_notifications: [{ id: 20, matched_transaction_id: 10 }],
    },
  };
  writeFileSync(dumpPath, JSON.stringify(dump), "utf8");
});

afterAll(async () => {
  for (let i = 0; i < 10 && dir; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

describe("restore-db nạp đúng vào libsql file cục bộ", () => {
  it("ghi đúng số dòng mọi bảng, xử lý vòng khoá ngoại, xoá dữ liệu cũ", async () => {
    const res = spawnSync(
      process.execPath,
      ["scripts/restore-db.mjs", dumpPath, `--target=${targetUrl}`, "--apply"],
      { encoding: "utf8", cwd: process.cwd() },
    );
    // In stderr ra để dễ soi khi đỏ.
    if (res.status !== 0) console.error(res.stdout, res.stderr);
    expect(res.status).toBe(0);

    const c = createClient({ url: targetUrl });
    try {
      const count = async (t) =>
        Number((await c.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
      expect(await count("members")).toBe(3);
      expect(await count("wide")).toBe(WIDE_ROWS);
      expect(await count("empty_table")).toBe(0);
      expect(await count("financial_transactions")).toBe(1);
      expect(await count("payment_notifications")).toBe(1);

      // Dữ liệu cũ (member id=99) đã bị xoá.
      const old = await c.execute(`SELECT id FROM members WHERE id = 99`);
      expect(old.rows).toHaveLength(0);

      // Nội dung một dòng ở cuối bảng wide đúng (chắc chắn lô cuối ghi đủ).
      const last = await c.execute(
        `SELECT c0, c11 FROM wide WHERE id = ${WIDE_ROWS}`,
      );
      expect(String(last.rows[0].c0)).toBe(`c0-v${WIDE_ROWS}`);
      expect(String(last.rows[0].c11)).toBe(`c11-v${WIDE_ROWS}`);
    } finally {
      c.close();
    }
  }, 30000);
});
