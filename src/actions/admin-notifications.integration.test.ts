/**
 * Chuông + trang thông báo admin (yêu cầu user 6/11/2026): danh sách đang âm
 * quỹ và lịch sử những lần âm quỹ, tính từ sổ cái.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members, financialTransactions, admins } from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getAdminDebtNotifications } = await import("./admin-notifications");

async function member(name: string, opts: { active?: boolean } = {}) {
  const [m] = await testDb
    .insert(members)
    .values({ name, facebookId: `fb-${name}`, isActive: opts.active ?? true })
    .returning({ id: members.id });
  return m.id;
}

async function ledger(
  memberId: number,
  type: "fund_contribution" | "fund_deduction",
  amount: number,
  createdAt: string,
  description = "",
) {
  await testDb.insert(financialTransactions).values({
    type,
    direction: type === "fund_contribution" ? "in" : "out",
    amount,
    memberId,
    createdAt,
    description,
  });
}

describe("getAdminDebtNotifications", () => {
  beforeEach(async () => {
    for (const t of [
      "financial_transactions",
      "admins",
      "members",
      "app_settings",
    ]) {
      await client.execute(`DELETE FROM ${t}`);
    }
  });

  it("liệt kê member đang âm, nợ nhiều nhất trước, đánh dấu quá hạn mức (100.000)", async () => {
    const thanh = await member("Thanh");
    const lan = await member("Lan");
    const ok = await member("Ok");
    await ledger(thanh, "fund_deduction", 188_000, "2026-11-02 21:00:00");
    await ledger(lan, "fund_deduction", 7_000, "2026-11-02 21:00:00");
    await ledger(ok, "fund_contribution", 50_000, "2026-11-01 10:00:00");

    const r = await getAdminDebtNotifications();
    if ("error" in r) throw new Error(r.error);
    expect(r.owing.map((o) => [o.name, o.balance, o.overLimit])).toEqual([
      ["Thanh", -188_000, true],
      ["Lan", -7_000, false],
    ]);
    expect(r.voteBlockDebtThreshold).toBe(100_000);
  });

  it("lịch sử: mỗi lần chuyển xuống âm, mới nhất trước, kèm tên", async () => {
    const thanh = await member("Thanh");
    await ledger(thanh, "fund_contribution", 10_000, "2026-10-01 10:00:00");
    await ledger(
      thanh,
      "fund_deduction",
      40_000,
      "2026-10-05 21:00:00",
      "Buổi 5/10",
    );
    await ledger(thanh, "fund_contribution", 50_000, "2026-10-10 10:00:00");
    await ledger(
      thanh,
      "fund_deduction",
      40_000,
      "2026-11-02 21:00:00",
      "Buổi 2/11",
    );

    const r = await getAdminDebtNotifications();
    if ("error" in r) throw new Error(r.error);
    expect(
      r.history.map((h) => [h.name, h.at, h.balanceAfter, h.description]),
    ).toEqual([
      ["Thanh", "2026-11-02 21:00:00", -20_000, "Buổi 2/11"],
      ["Thanh", "2026-10-05 21:00:00", -30_000, "Buổi 5/10"],
    ]);
  });

  it("member đã khoá (rời quỹ) không nằm trong danh sách", async () => {
    const gone = await member("Gone", { active: false });
    await ledger(gone, "fund_deduction", 50_000, "2026-11-02 21:00:00");
    const r = await getAdminDebtNotifications();
    if ("error" in r) throw new Error(r.error);
    expect(r.owing).toEqual([]);
  });

  it("không phải admin → error", async () => {
    const { requireAdmin } = await import("@/lib/auth");
    vi.mocked(requireAdmin).mockResolvedValueOnce({
      error: "unauthorized",
    } as never);
    expect(await getAdminDebtNotifications()).toHaveProperty("error");
  });

  it("báo số email admin nhận mail âm quỹ (0 → trang hiện cảnh báo)", async () => {
    let r = await getAdminDebtNotifications();
    if ("error" in r) throw new Error(r.error);
    expect(r.mailRecipientCount).toBe(0);
    await testDb
      .insert(admins)
      .values({ username: "Admin", passwordHash: "x", email: "a@fwbb.test" });
    r = await getAdminDebtNotifications();
    if ("error" in r) throw new Error(r.error);
    expect(r.mailRecipientCount).toBe(1);
  });
});
