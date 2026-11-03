/**
 * Khoá hai điều kiện Drizzle của tài khoản giao lưu với dữ liệu thật: cả 2x2
 * tổ hợp (approvalStatus x signupIntent) cộng một dòng rejected. Nếu `ne` dính
 * bẫy NULL hay ai đó sửa một nửa điều kiện thì test này đỏ trước khi admin
 * thấy hàng chờ lệch.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";
import {
  exchangeAccountWhere,
  notExchangeAccountWhere,
} from "./exchange-account";
import { isExchangeAccount } from "./exchange-account";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const COMBOS = [
  { name: "pending-group", approvalStatus: "pending", signupIntent: "group" },
  {
    name: "pending-exchange",
    approvalStatus: "pending",
    signupIntent: "exchange",
  },
  { name: "approved-group", approvalStatus: "approved", signupIntent: "group" },
  {
    name: "approved-exchange",
    approvalStatus: "approved",
    signupIntent: "exchange",
  },
  { name: "rejected-group", approvalStatus: "rejected", signupIntent: "group" },
] as const;

describe("exchangeAccountWhere / notExchangeAccountWhere", () => {
  beforeEach(async () => {
    await client.execute("DELETE FROM members");
    await testDb.insert(members).values(COMBOS.map((c) => ({ ...c })));
  });

  it("exchangeAccountWhere chỉ trả pending + exchange", async () => {
    const rows = await testDb
      .select({ name: members.name })
      .from(members)
      .where(exchangeAccountWhere);
    expect(rows.map((r) => r.name)).toEqual(["pending-exchange"]);
  });

  it("notExchangeAccountWhere trả đúng phần bù, không rớt dòng nào", async () => {
    const rows = await testDb
      .select({ name: members.name })
      .from(members)
      .where(notExchangeAccountWhere);
    expect(rows.map((r) => r.name).sort()).toEqual(
      COMBOS.filter((c) => c.name !== "pending-exchange")
        .map((c) => c.name)
        .sort(),
    );
  });

  it("isExchangeAccount khớp với điều kiện SQL trên từng tổ hợp", () => {
    for (const c of COMBOS) {
      expect(isExchangeAccount(c)).toBe(c.name === "pending-exchange");
    }
  });
});
