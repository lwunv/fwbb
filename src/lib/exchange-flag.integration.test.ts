/**
 * Cờ `exchangeEnabled` quyết định mọi URL giao lưu có tồn tại hay không. Hai
 * điều phải khoá: mặc định TẮT (deploy xong chưa ai bật thì app y như cũ) và
 * helper đọc đúng giá trị admin đã lưu, qua cùng đường đọc settings của app.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { role: "admin" } })),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { isExchangeEnabled } = await import("./exchange-flag");
const { getSettings, updateSetting } = await import("@/actions/settings");

describe("isExchangeEnabled", () => {
  beforeEach(async () => {
    await client.execute("DELETE FROM app_settings");
  });

  it("chưa ai lưu gì thì tắt", async () => {
    expect(await isExchangeEnabled()).toBe(false);
  });

  it("phản ánh giá trị đã lưu, bật rồi tắt", async () => {
    await updateSetting("exchangeEnabled", true);
    expect(await isExchangeEnabled()).toBe(true);

    await updateSetting("exchangeEnabled", false);
    expect(await isExchangeEnabled()).toBe(false);
  });

  it("lưu setting khác không làm đổi cờ", async () => {
    await updateSetting("exchangeEnabled", true);
    await updateSetting("appName", "Nhóm cầu lông");
    await updateSetting("lowFundThreshold", 250_000);

    expect(await isExchangeEnabled()).toBe(true);
    expect((await getSettings()).exchangeEnabled).toBe(true);
  });

  it("từ chối giá trị không phải boolean và giữ nguyên cờ", async () => {
    const r = await updateSetting(
      "exchangeEnabled",
      "yes" as unknown as boolean,
    );
    expect("error" in r).toBe(true);
    expect(await isExchangeEnabled()).toBe(false);
  });
});
