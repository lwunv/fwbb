/**
 * Integration tests for member actions (HIGH+MEDIUM gaps per audit):
 *  - toggleMemberActive: locking a member = leaving the fund (roster derives
 *    from members.isActive). Balance is FROZEN — no auto fund_refund issued.
 *  - findDuplicateMembers: detects name collisions, computes balance per
 *    duplicate via computeBalanceFromTransactions (no double-count of
 *    bank_payment_received audit rows)
 *
 * NOTE: the `fund_members` table was dropped (migration 0013). Fund membership
 * is now derived: in-fund ⇔ members.isActive=true AND approvalStatus='approved'.
 * Members insert with those defaults, so a plain insert = in-fund. "Not in fund"
 * is now expressed via isActive=false (locked) or approvalStatus!='approved'.
 * The old addFundMember/removeFundMember actions were removed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { admins, members, financialTransactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { toggleMemberActive, findDuplicateMembers, updateMember, createMember } =
  await import("./members");
const { getFundBalance } = await import("@/lib/fund-calculator");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function seedMember(name: string, fid = `fb-${name}-${Date.now()}`) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fid })
    .returning({ id: members.id });
  return m.id;
}

async function seedAdmin() {
  await testDb
    .insert(admins)
    .values({ username: `a${Date.now()}`, passwordHash: "hash" });
}

describe("toggleMemberActive (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("new member is in-fund by default (isActive=true)", async () => {
    const memberId = await seedMember("Default");
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(true);
    expect(m?.approvalStatus).toBe("approved");
  });

  it("locks an in-fund member — flips isActive=false (leaves fund)", async () => {
    const memberId = await seedMember("Lockable");

    const r = await toggleMemberActive(memberId);
    expect(r).toEqual({ success: true });

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(false);
  });

  it("toggle is reversible — relock then unlock restores in-fund state", async () => {
    const memberId = await seedMember("Reversible");

    await toggleMemberActive(memberId); // → false
    let m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(false);

    await toggleMemberActive(memberId); // → true
    m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(true);
  });

  it("locking a member with positive balance does NOT issue a fund_refund (balance frozen)", async () => {
    const memberId = await seedMember("Positive");
    // Seed 100k contribution → balance = +100k
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `seed-contrib-${memberId}`,
    });

    const r = await toggleMemberActive(memberId);
    expect(r).toEqual({ success: true });

    // No auto-refund row inserted — balance is frozen in the ledger.
    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);

    // Balance unchanged (still readable for a locked member — frozen, not zeroed).
    const bal = await getFundBalance(memberId);
    expect(bal.balance).toBe(100_000);

    // Member is out of fund (isActive=false).
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, memberId),
    });
    expect(m?.isActive).toBe(false);
  });

  it("locking a member who owes the fund does NOT issue any refund either", async () => {
    const memberId = await seedMember("Negative");
    // Seed 50k deduction → balance = -50k
    await testDb.insert(financialTransactions).values({
      memberId,
      type: "fund_deduction",
      direction: "out",
      amount: 50_000,
      idempotencyKey: `seed-debt-${memberId}`,
    });

    const r = await toggleMemberActive(memberId);
    expect(r).toEqual({ success: true });

    const refunds = await testDb.query.financialTransactions.findMany({
      where: and(
        eq(financialTransactions.memberId, memberId),
        eq(financialTransactions.type, "fund_refund"),
      ),
    });
    expect(refunds).toHaveLength(0);

    const bal = await getFundBalance(memberId);
    expect(bal.balance).toBe(-50_000);
  });

  it("rejects when member does not exist", async () => {
    const r = await toggleMemberActive(999_999);
    expect("error" in r).toBe(true);
  });
});

describe("findDuplicateMembers (integration)", () => {
  beforeEach(async () => {
    await reset();
    await seedAdmin();
  });

  it("returns [] when no duplicates", async () => {
    await seedMember("A");
    await seedMember("B");
    await seedMember("C");

    const dups = await findDuplicateMembers();
    expect(dups).toEqual([]);
  });

  it("detects exact-name duplicates (case-insensitive, trimmed)", async () => {
    await seedMember("Nguyễn A");
    await seedMember("  nguyễn a  "); // same after trim+lower
    await seedMember("Different");

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(1);
    expect(dups[0].members).toHaveLength(2);
    const names = dups[0].members.map((m) => m.name).sort();
    expect(names[0].toLowerCase().trim()).toBe("nguyễn a");
  });

  it("groups multiple duplicate clusters separately", async () => {
    await seedMember("Anh", "fb-anh1");
    await seedMember("Anh", "fb-anh2");
    await seedMember("Bình", "fb-binh1");
    await seedMember("Bình", "fb-binh2");
    await seedMember("Solo", "fb-solo");

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(2);
    expect(dups.every((g) => g.members.length === 2)).toBe(true);
  });

  it("computes balance via canonical helper — bank audit rows excluded", async () => {
    const a1 = await seedMember("Dup", "fb-dup1");
    const a2 = await seedMember("Dup", "fb-dup2");
    // a1 has real contribution + paired audit row
    await testDb.insert(financialTransactions).values({
      memberId: a1,
      type: "fund_contribution",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `c1-${a1}`,
    });
    await testDb.insert(financialTransactions).values({
      memberId: a1,
      type: "bank_payment_received",
      direction: "in",
      amount: 100_000,
      idempotencyKey: `bank-${a1}`,
    });
    // a2 has only a deduction → owing
    await testDb.insert(financialTransactions).values({
      memberId: a2,
      type: "fund_deduction",
      direction: "out",
      amount: 30_000,
      idempotencyKey: `d1-${a2}`,
    });

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(1);
    const byId = new Map(dups[0].members.map((m) => [m.id, m]));
    // a1 balance = 100k (audit not double-counted)
    expect(byId.get(a1)?.balance).toBe(100_000);
    // a2 balance = -30k
    expect(byId.get(a2)?.balance).toBe(-30_000);
  });

  it("excludes reversal pairs from balance (reconcile invariant)", async () => {
    const a1 = await seedMember("Pair", "fb-p1");
    const a2 = await seedMember("Pair", "fb-p2");
    // a1: contribution then reversed
    const [orig] = await testDb
      .insert(financialTransactions)
      .values({
        memberId: a1,
        type: "fund_contribution",
        direction: "in",
        amount: 50_000,
        idempotencyKey: `orig-${a1}`,
      })
      .returning({ id: financialTransactions.id });
    await testDb.insert(financialTransactions).values({
      memberId: a1,
      type: "fund_refund",
      direction: "out",
      amount: 50_000,
      reversalOfId: orig.id,
      idempotencyKey: `rev-${a1}`,
    });

    const dups = await findDuplicateMembers();
    expect(dups).toHaveLength(1);
    const a1Data = dups[0].members.find((m) => m.id === a1);
    // Reversal pair cancels → balance = 0 (not 50k, not -50k)
    expect(a1Data?.balance).toBe(0);
  });

  it("records ledgerCount accurately", async () => {
    const a1 = await seedMember("Counts", "fb-c1");
    const a2 = await seedMember("Counts", "fb-c2");
    // a1 has 3 ledger rows
    for (let i = 0; i < 3; i++) {
      await testDb.insert(financialTransactions).values({
        memberId: a1,
        type: "fund_contribution",
        direction: "in",
        amount: 10_000,
        idempotencyKey: `c-${a1}-${i}`,
      });
    }
    // a2 has 1
    await testDb.insert(financialTransactions).values({
      memberId: a2,
      type: "fund_contribution",
      direction: "in",
      amount: 5_000,
      idempotencyKey: `c-${a2}-0`,
    });

    const dups = await findDuplicateMembers();
    const byId = new Map(dups[0].members.map((m) => [m.id, m]));
    expect(byId.get(a1)?.ledgerCount).toBe(3);
    expect(byId.get(a2)?.ledgerCount).toBe(1);
  });
});

describe("updateMember — dialog Sửa thông tin (2026-07-06)", () => {
  beforeEach(reset);

  function formData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("cập nhật email + sđt hợp lệ", async () => {
    const id = await seedMember("Cún");
    const result = await updateMember(
      id,
      formData({
        name: "Cún",
        nickname: "",
        email: "cun@example.com",
        phoneNumber: "0912345678",
      }),
    );
    expect(result).toEqual({ success: true });

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.email).toBe("cun@example.com");
    expect(m?.phoneNumber).toBe("0912345678");
  });

  it("email sai định dạng → error, không lưu", async () => {
    const id = await seedMember("Mèo");
    const result = await updateMember(
      id,
      formData({
        name: "Mèo",
        nickname: "",
        email: "khong-hop-le",
        phoneNumber: "",
      }),
    );
    expect(result).toHaveProperty("error");

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.email).toBeNull();
  });

  it("email đã bị member khác dùng → error, không lưu", async () => {
    await seedMember("A", "fb-a-dup");
    const idA = (await testDb.query.members.findFirst({
      where: eq(members.name, "A"),
    }))!.id;
    await updateMember(
      idA,
      formData({
        name: "A",
        nickname: "",
        email: "shared@example.com",
        phoneNumber: "",
      }),
    );
    const idB = await seedMember("B", "fb-b-dup");

    const result = await updateMember(
      idB,
      formData({
        name: "B",
        nickname: "",
        email: "shared@example.com",
        phoneNumber: "",
      }),
    );
    expect(result).toHaveProperty("error");

    const mB = await testDb.query.members.findFirst({
      where: eq(members.id, idB),
    });
    expect(mB?.email).toBeNull();
  });

  it("email đã dùng bởi CHÍNH member đó (không đổi) → vẫn cho lưu (không tự conflict với mình)", async () => {
    const id = await seedMember("Tự sửa");
    await updateMember(
      id,
      formData({
        name: "Tự sửa",
        nickname: "",
        email: "self@example.com",
        phoneNumber: "",
      }),
    );
    const result = await updateMember(
      id,
      formData({
        name: "Tự sửa",
        nickname: "Biệt danh mới",
        email: "self@example.com",
        phoneNumber: "0900000000",
      }),
    );
    expect(result).toEqual({ success: true });
  });

  it("email rỗng → xoá email hiện có (set null)", async () => {
    const id = await seedMember("Xoá email");
    await updateMember(
      id,
      formData({
        name: "Xoá email",
        nickname: "",
        email: "old@example.com",
        phoneNumber: "",
      }),
    );
    const result = await updateMember(
      id,
      formData({ name: "Xoá email", nickname: "", email: "", phoneNumber: "" }),
    );
    expect(result).toEqual({ success: true });
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.email).toBeNull();
  });

  it("form KHÔNG gửi field email/phoneNumber (vd flow cũ) → giữ nguyên giá trị hiện có", async () => {
    const id = await seedMember("Giữ nguyên");
    await updateMember(
      id,
      formData({
        name: "Giữ nguyên",
        nickname: "",
        email: "keep@example.com",
        phoneNumber: "0911",
      }),
    );
    // Form chỉ gửi name+nickname, KHÔNG có key "email"/"phoneNumber".
    const fd = new FormData();
    fd.set("name", "Giữ nguyên");
    fd.set("nickname", "Đổi biệt danh");
    const result = await updateMember(id, fd);
    expect(result).toEqual({ success: true });

    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.email).toBe("keep@example.com");
    expect(m?.phoneNumber).toBe("0911");
    expect(m?.nickname).toBe("Đổi biệt danh");
  });
});

describe("username khi admin tạo/sửa member (2026-07-13)", () => {
  beforeEach(reset);

  function fd(fields: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }
  function byName(name: string) {
    return testDb.query.members.findFirst({ where: eq(members.name, name) });
  }

  it("createMember: lưu username (chuẩn hoá lowercase)", async () => {
    const r = await createMember(fd({ name: "Cún", username: "CunCon" }));
    expect(r).toEqual({ success: true });
    expect((await byName("Cún"))?.username).toBe("cuncon");
  });

  it("createMember: không gửi username → null", async () => {
    await createMember(fd({ name: "Trống ĐN" }));
    expect((await byName("Trống ĐN"))?.username).toBeNull();
  });

  it("createMember: username sai định dạng → error, KHÔNG tạo", async () => {
    const r = await createMember(fd({ name: "Sai", username: "a b!" }));
    expect(r).toHaveProperty("error");
    expect(await byName("Sai")).toBeUndefined();
  });

  it("createMember: username trùng → error", async () => {
    await createMember(fd({ name: "Một", username: "trung" }));
    const r = await createMember(fd({ name: "Hai", username: "TRUNG" }));
    expect(r).toHaveProperty("error");
    expect(await byName("Hai")).toBeUndefined();
  });

  it("updateMember: set username", async () => {
    const id = await seedMember("Sửa ĐN");
    const r = await updateMember(
      id,
      fd({ name: "Sửa ĐN", username: "newname" }),
    );
    expect(r).toEqual({ success: true });
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.username).toBe("newname");
  });

  it("updateMember: username rỗng → xoá (null)", async () => {
    const id = await seedMember("Xoá ĐN");
    await updateMember(id, fd({ name: "Xoá ĐN", username: "willclear" }));
    const r = await updateMember(id, fd({ name: "Xoá ĐN", username: "" }));
    expect(r).toEqual({ success: true });
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.username).toBeNull();
  });

  it("updateMember: username trùng member khác → error, không lưu", async () => {
    const idA = await seedMember("AAA", "fb-aaa");
    await updateMember(idA, fd({ name: "AAA", username: "taken" }));
    const idB = await seedMember("BBB", "fb-bbb");
    const r = await updateMember(idB, fd({ name: "BBB", username: "TAKEN" }));
    expect(r).toHaveProperty("error");
    const mB = await testDb.query.members.findFirst({
      where: eq(members.id, idB),
    });
    expect(mB?.username).toBeNull();
  });

  it("updateMember: giữ username của CHÍNH mình → không tự conflict", async () => {
    const id = await seedMember("Tự giữ");
    await updateMember(id, fd({ name: "Tự giữ", username: "mine" }));
    const r = await updateMember(
      id,
      fd({ name: "Tự giữ", nickname: "x", username: "mine" }),
    );
    expect(r).toEqual({ success: true });
  });

  it("updateMember: form KHÔNG gửi username → giữ nguyên", async () => {
    const id = await seedMember("Giữ ĐN");
    await updateMember(id, fd({ name: "Giữ ĐN", username: "stay" }));
    const noUser = new FormData();
    noUser.set("name", "Giữ ĐN");
    noUser.set("nickname", "abc");
    await updateMember(id, noUser);
    const m = await testDb.query.members.findFirst({
      where: eq(members.id, id),
    });
    expect(m?.username).toBe("stay");
  });
});
