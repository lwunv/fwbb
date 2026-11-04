/**
 * Test tích hợp cho việc đồng bộ schema trước khi nạp (vá gốc 04/11/2026).
 *
 * Chạy ĐÚNG code đụng-DB (`introspectSchema` + `syncStandbySchema`) trên hai
 * database libsql FILE CỤC BỘ dựng tạm, KHÔNG chạm bản chính/dự phòng thật.
 * Mục tiêu: chứng minh rằng khi "bản chính" có cột/bảng mà "bản dự phòng" chưa
 * có, hàm tự thêm đúng, và sau đó lệnh INSERT kiểu restore chạy được (chính là
 * cái đã vỡ hôm 04/11 với `members.signup_intent`).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  introspectSchema,
  syncStandbySchema,
} from "./replicate-to-standby.mjs";

let dir;
let primary;
let standby;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fwbb-schema-sync-test-"));
  primary = createClient({ url: pathToFileURL(join(dir, "prod.db")).href });
  standby = createClient({ url: pathToFileURL(join(dir, "standby.db")).href });

  // Trạng thái ban đầu: hai bên có cùng một bảng members tối giản.
  for (const c of [primary, standby]) {
    await c.execute(
      `CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT)`,
    );
  }
  await primary.execute({
    sql: `INSERT INTO members (id, name) VALUES (?, ?)`,
    args: [1, "Châu"],
  });

  // Bản chính đi trước: thêm cột (giống migration 0027) và một bảng mới + index.
  await primary.execute(
    `ALTER TABLE members ADD COLUMN signup_intent TEXT DEFAULT 'group' NOT NULL`,
  );
  await primary.execute(
    `CREATE TABLE zalo_identities (id TEXT PRIMARY KEY, member_id INTEGER)`,
  );
  await primary.execute(
    `CREATE INDEX zi_member_idx ON zalo_identities (member_id)`,
  );

  // Bản dự phòng có một bảng nội bộ của drizzle: introspect PHẢI bỏ qua nó
  // (không được coi là "thừa" rồi cảnh báo nhầm).
  await standby.execute(
    `CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT)`,
  );
});

afterAll(async () => {
  primary?.close();
  standby?.close();
  // Windows có thể còn giữ handle file libsql một nhịp sau close(). Dọn thư mục
  // tạm là việc phụ, đừng để nó làm đỏ suite: thử lại vài lần rồi bỏ qua.
  for (let i = 0; i < 10 && dir; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

describe("đồng bộ schema thật trên libsql cục bộ", () => {
  it("introspect bỏ qua bảng nội bộ (__drizzle...)", async () => {
    const s = await introspectSchema(standby);
    expect(Object.keys(s.tables)).toEqual(["members"]);
  });

  it("sync thêm đúng cột thiếu + bảng mới, rồi INSERT kiểu restore chạy được", async () => {
    const changed = await syncStandbySchema(primary, standby);
    // 3 lệnh DDL: ALTER members ADD signup_intent + CREATE TABLE
    // zalo_identities + CREATE INDEX zi_member_idx (index là lệnh riêng).
    expect(changed).toBe(3);

    // Cột signup_intent đã có ở dự phòng, đúng kiểu/mặc định/NOT NULL.
    const info = await standby.execute(`PRAGMA table_info("members")`);
    const si = info.rows.find((r) => String(r.name) === "signup_intent");
    expect(si).toBeTruthy();
    expect(String(si.type)).toBe("TEXT");
    expect(Number(si.notnull)).toBe(1);
    expect(String(si.dflt_value)).toBe("'group'");

    // Bảng mới + index của nó đã dựng lại.
    const tbls = await standby.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='zalo_identities'`,
    );
    expect(tbls.rows).toHaveLength(1);
    const idx = await standby.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='zi_member_idx'`,
    );
    expect(idx.rows).toHaveLength(1);

    // Đây là thứ đã VỠ hôm 04/11: INSERT có cột signup_intent vào dự phòng.
    // Giờ phải chạy được.
    await expect(
      standby.execute({
        sql: `INSERT INTO members (id, name, signup_intent) VALUES (?, ?, ?)`,
        args: [1, "Châu", "group"],
      }),
    ).resolves.toBeTruthy();
  });

  it("chạy lại là no-op: không sinh lệnh nào, không lỗi", async () => {
    const changed = await syncStandbySchema(primary, standby);
    expect(changed).toBe(0);
  });
});
