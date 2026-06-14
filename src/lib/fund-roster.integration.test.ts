/**
 * Integration test: roster quỹ mới derive từ members.isActive + approvalStatus,
 * KHÔNG còn bảng fund_members.
 *
 * Hành vi MỚI:
 *  - member isActive=true + approvalStatus='approved'  → trong quỹ (dù KHÔNG có fund_members row).
 *  - member isActive=false (bị khóa)                   → KHÔNG trong quỹ (balance đóng băng).
 *  - member approvalStatus='pending'/'rejected'        → KHÔNG trong quỹ.
 *  - getAllFundBalances chỉ trả balance cho member eligible, tính từ ledger.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, financialTransactions } from "@/db/schema";

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { isFundMember, getAllFundBalances } = await import("./fund-calculator");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM members");
}

async function addMember(opts: {
  name: string;
  fbId: string;
  isActive?: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
}) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: opts.name,
      facebookId: opts.fbId,
      isActive: opts.isActive ?? true,
      approvalStatus: opts.approvalStatus ?? "approved",
    })
    .returning({ id: members.id });
  return m.id;
}

async function contribute(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
    idempotencyKey: `seed-contrib-${memberId}-${amount}`,
  });
}

describe("fund roster derive từ members.isActive + approvalStatus", () => {
  beforeEach(reset);

  it("member active + approved là fund member dù KHÔNG có fund_members row", async () => {
    const id = await addMember({ name: "Active", fbId: "fb-active" });
    expect(await isFundMember(id)).toBe(true);
  });

  it("member bị khóa (isActive=false) KHÔNG phải fund member", async () => {
    const id = await addMember({
      name: "Locked",
      fbId: "fb-locked",
      isActive: false,
    });
    expect(await isFundMember(id)).toBe(false);
  });

  it("member chưa duyệt (pending) KHÔNG phải fund member", async () => {
    const id = await addMember({
      name: "Pending",
      fbId: "fb-pending",
      approvalStatus: "pending",
    });
    expect(await isFundMember(id)).toBe(false);
  });

  it("member bị từ chối (rejected) KHÔNG phải fund member", async () => {
    const id = await addMember({
      name: "Rejected",
      fbId: "fb-rejected",
      approvalStatus: "rejected",
    });
    expect(await isFundMember(id)).toBe(false);
  });

  it("getAllFundBalances chỉ gồm member eligible, tính balance từ ledger", async () => {
    const active = await addMember({ name: "A", fbId: "fb-a" });
    const locked = await addMember({
      name: "B",
      fbId: "fb-b",
      isActive: false,
    });
    const pending = await addMember({
      name: "C",
      fbId: "fb-c",
      approvalStatus: "pending",
    });
    await contribute(active, 500_000);
    await contribute(locked, 300_000); // đóng băng — không nằm trong roster
    await contribute(pending, 100_000);

    const balances = await getAllFundBalances();
    const ids = balances.map((b) => b.memberId).sort((a, b) => a - b);

    expect(ids).toEqual([active]);
    expect(balances.find((b) => b.memberId === active)?.balance).toBe(500_000);
  });
});
