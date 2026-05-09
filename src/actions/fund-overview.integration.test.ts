/**
 * Integration tests cho `getFundOverview` — đặc biệt cho 2 field MỚI:
 *  - `cashOnHand` (= contribution − refund − chi quỹ chung)
 *  - `totalGroupExpenses` (court_rent_payment + inventory_purchase, đã loại
 *    cặp original+reversal)
 *
 * Invariant CRITICAL được verify ở đây:
 *  - cashOnHand KHÔNG bị giảm bởi per-member `fund_deduction` (deduction từ
 *    finalizeSession là member-allocation, không phải cash movement).
 *  - cashOnHand giảm CHÍNH XÁC bằng amount khi admin trả sân tháng / mua cầu.
 *  - Reversal cặp (original direction=out + reversal direction=in với
 *    reversalOfId trỏ về original) phải bị loại khỏi tổng → cashOnHand restore.
 *  - `totalBalance` (sum of member balances) KHÔNG đổi khi admin chi quỹ chung.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  fundMembers,
  financialTransactions,
  inventoryPurchases,
  shuttlecockBrands,
} from "@/db/schema";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getFundOverview } = await import("./fund");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM inventory_purchases");
  await client.execute("DELETE FROM shuttlecock_brands");
  await client.execute("DELETE FROM fund_members");
  await client.execute("DELETE FROM members");
}

async function seedMember(name: string, fbId: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: fbId })
    .returning({ id: members.id });
  await testDb.insert(fundMembers).values({ memberId: m.id, isActive: true });
  return m.id;
}

async function contribute(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_contribution",
    direction: "in",
    amount,
    memberId,
  });
}

async function deductFromSession(memberId: number, amount: number) {
  // Mô phỏng `finalizeSession` charge member theo từng buổi (member-allocation,
  // không phải cash movement).
  await testDb.insert(financialTransactions).values({
    type: "fund_deduction",
    direction: "out",
    amount,
    memberId,
  });
}

async function refund(memberId: number, amount: number) {
  await testDb.insert(financialTransactions).values({
    type: "fund_refund",
    direction: "out",
    amount,
    memberId,
  });
}

async function payCourtRent(amount: number, targetMonth = "2026-05") {
  const [row] = await testDb
    .insert(financialTransactions)
    .values({
      type: "court_rent_payment",
      direction: "out",
      amount,
      memberId: null,
      metadataJson: JSON.stringify({ targetMonth }),
    })
    .returning({ id: financialTransactions.id });
  return row.id;
}

async function reverseCourtRent(originalId: number, amount: number) {
  // deleteCourtRentPayment ghi 1 row direction=in trỏ về original.
  await testDb.insert(financialTransactions).values({
    type: "court_rent_payment",
    direction: "in",
    amount,
    memberId: null,
    reversalOfId: originalId,
  });
}

async function buyShuttlecock(amount: number) {
  const [brand] = await testDb
    .insert(shuttlecockBrands)
    .values({ name: `Brand-${Math.random()}`, pricePerTube: 100_000 })
    .returning({ id: shuttlecockBrands.id });
  const [purchase] = await testDb
    .insert(inventoryPurchases)
    .values({
      brandId: brand.id,
      tubes: 1,
      pricePerTube: amount,
      totalPrice: amount,
      purchasedAt: "2026-05-01",
    })
    .returning({ id: inventoryPurchases.id });
  const [row] = await testDb
    .insert(financialTransactions)
    .values({
      type: "inventory_purchase",
      direction: "out",
      amount,
      memberId: null,
      inventoryPurchaseId: purchase.id,
    })
    .returning({ id: financialTransactions.id });
  return row.id;
}

describe("getFundOverview — cashOnHand math", () => {
  beforeEach(reset);

  it("returns zeros when no transactions exist", async () => {
    const o = await getFundOverview();
    expect(o.cashOnHand).toBe(0);
    expect(o.totalGroupExpenses).toBe(0);
    expect(o.groupExpenseCourtRent).toBe(0);
    expect(o.groupExpenseInventory).toBe(0);
    expect(o.totalBalance).toBe(0);
  });

  it("cashOnHand = contributions when only contributions exist", async () => {
    const a = await seedMember("Alice", "fb-a");
    const b = await seedMember("Bob", "fb-b");
    await contribute(a, 500_000);
    await contribute(b, 300_000);

    const o = await getFundOverview();
    expect(o.totalContributions).toBe(800_000);
    expect(o.cashOnHand).toBe(800_000);
    expect(o.totalBalance).toBe(800_000);
    expect(o.totalGroupExpenses).toBe(0);
  });

  it("cashOnHand drops by exact amount on court_rent_payment", async () => {
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 1_000_000);
    await payCourtRent(400_000);

    const o = await getFundOverview();
    expect(o.cashOnHand).toBe(600_000); // 1M − 400K
    expect(o.totalGroupExpenses).toBe(400_000);
    expect(o.groupExpenseCourtRent).toBe(400_000);
    expect(o.groupExpenseInventory).toBe(0);
    // Member balance KHÔNG bị ảnh hưởng — chi quỹ chung không trừ ai cụ thể.
    expect(o.totalBalance).toBe(1_000_000);
  });

  it("cashOnHand drops by exact amount on inventory_purchase", async () => {
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 2_000_000);
    await buyShuttlecock(550_000);

    const o = await getFundOverview();
    expect(o.cashOnHand).toBe(1_450_000); // 2M − 550K
    expect(o.totalGroupExpenses).toBe(550_000);
    expect(o.groupExpenseInventory).toBe(550_000);
    expect(o.groupExpenseCourtRent).toBe(0);
    expect(o.totalBalance).toBe(2_000_000); // không đổi
  });

  it("cashOnHand UNCHANGED by per-member fund_deduction (session finalize)", async () => {
    // Đây là invariant quan trọng nhất: finalizeSession trừ member balance
    // (allocation), NHƯNG không phải cash movement — admin đã ứng tiền sân/cầu
    // qua court_rent_payment / inventory_purchase rồi.
    const a = await seedMember("Alice", "fb-a");
    const b = await seedMember("Bob", "fb-b");
    await contribute(a, 500_000);
    await contribute(b, 500_000);
    // Mỗi member bị trừ 100K cho buổi chơi
    await deductFromSession(a, 100_000);
    await deductFromSession(b, 100_000);

    const o = await getFundOverview();
    // Cash KHÔNG đổi — không có court_rent / inventory_purchase
    expect(o.cashOnHand).toBe(1_000_000);
    expect(o.totalGroupExpenses).toBe(0);
    // Member balance phản ánh deduction
    expect(o.totalBalance).toBe(800_000); // 1M − 200K
    expect(o.totalDeductions).toBe(200_000);
  });

  it("cashOnHand drops by refund amount", async () => {
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 1_000_000);
    await refund(a, 200_000);

    const o = await getFundOverview();
    expect(o.cashOnHand).toBe(800_000); // 1M − 200K
    expect(o.totalRefunds).toBe(200_000);
    expect(o.totalBalance).toBe(800_000);
  });

  it("excludes reversed court_rent_payment pairs from cashOnHand", async () => {
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 1_000_000);
    const orig = await payCourtRent(300_000);
    // Trước khi reverse: cash = 700K
    let o = await getFundOverview();
    expect(o.cashOnHand).toBe(700_000);

    // Sau khi reverse (admin xóa payment): cash phải về 1M
    await reverseCourtRent(orig, 300_000);
    o = await getFundOverview();
    expect(o.cashOnHand).toBe(1_000_000);
    expect(o.totalGroupExpenses).toBe(0);
    expect(o.groupExpenseCourtRent).toBe(0);
  });

  it("combines court_rent + inventory + reversal correctly", async () => {
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 5_000_000);
    await payCourtRent(1_000_000);
    const orig2 = await payCourtRent(800_000);
    await reverseCourtRent(orig2, 800_000); // bỏ
    await buyShuttlecock(450_000);
    await buyShuttlecock(250_000);

    const o = await getFundOverview();
    // Active: court_rent 1M + inventory 700K = 1.7M
    expect(o.groupExpenseCourtRent).toBe(1_000_000);
    expect(o.groupExpenseInventory).toBe(700_000);
    expect(o.totalGroupExpenses).toBe(1_700_000);
    expect(o.cashOnHand).toBe(3_300_000); // 5M − 1.7M
    expect(o.totalBalance).toBe(5_000_000); // member balance không đổi
  });

  it("cashOnHand can be negative when expenses exceed contributions", async () => {
    // Kịch bản: admin ứng trước rất nhiều tiền sân tháng nhưng members chưa
    // đóng quỹ kịp → cash âm là hợp lệ (admin đang ứng cho nhóm).
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 500_000);
    await payCourtRent(1_500_000);

    const o = await getFundOverview();
    expect(o.cashOnHand).toBe(-1_000_000);
    expect(o.totalBalance).toBe(500_000);
  });

  it("formula: cashOnHand = contributions − refunds − totalGroupExpenses", async () => {
    // Random combination + verify công thức.
    const a = await seedMember("Alice", "fb-a");
    const b = await seedMember("Bob", "fb-b");
    await contribute(a, 1_200_000);
    await contribute(b, 800_000);
    await refund(a, 100_000);
    await payCourtRent(600_000);
    await buyShuttlecock(400_000);
    // Kèm 1 deduction-buổi để chứng tỏ nó KHÔNG ảnh hưởng cash.
    await deductFromSession(b, 50_000);

    const o = await getFundOverview();
    const expected =
      o.totalContributions - o.totalRefunds - o.totalGroupExpenses;
    expect(o.cashOnHand).toBe(expected);
    // Sanity: 2M − 100K − 1M = 900K
    expect(o.cashOnHand).toBe(900_000);
  });
});

describe("getFundOverview — totalBalance independence", () => {
  beforeEach(reset);

  it("group expenses do not affect totalBalance", async () => {
    const a = await seedMember("Alice", "fb-a");
    await contribute(a, 1_000_000);
    const before = await getFundOverview();
    expect(before.totalBalance).toBe(1_000_000);

    await payCourtRent(500_000);
    await buyShuttlecock(200_000);

    const after = await getFundOverview();
    // totalBalance KHÔNG đổi — 2 chi quỹ chung không gắn với member.
    expect(after.totalBalance).toBe(1_000_000);
    // cashOnHand giảm đúng 700K
    expect(after.cashOnHand).toBe(300_000);
  });

  it("totalBalance and cashOnHand diverge when admin pre-pays sessions", async () => {
    // Realistic scenario:
    //  - 2 members đóng 500K mỗi người → cash 1M, equity 1M
    //  - Admin trả sân tháng 600K → cash 400K, equity 1M (diverge -600K)
    //  - finalizeSession trừ 300K mỗi member → cash 400K, equity 400K (cân)
    const a = await seedMember("Alice", "fb-a");
    const b = await seedMember("Bob", "fb-b");
    await contribute(a, 500_000);
    await contribute(b, 500_000);
    await payCourtRent(600_000);
    await deductFromSession(a, 300_000);
    await deductFromSession(b, 300_000);

    const o = await getFundOverview();
    expect(o.cashOnHand).toBe(400_000);
    expect(o.totalBalance).toBe(400_000);
    // Tại điểm cân bằng, 2 số phải trùng.
  });
});
