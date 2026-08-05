import { describe, expect, it, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { appSettings } from "@/db/schema";
import { defaultSettings } from "@/lib/settings-registry";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { role: "admin" } })),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getSettings, updateSetting } = await import("./settings");

describe("getSettings / updateSetting", () => {
  beforeEach(async () => {
    await client.execute("DELETE FROM app_settings");
  });

  it("bảng rỗng trả về default", async () => {
    expect(await getSettings()).toEqual(defaultSettings());
  });

  it("đọc lại đúng giá trị vừa ghi", async () => {
    await updateSetting("lowFundThreshold", 250_000);
    expect((await getSettings()).lowFundThreshold).toBe(250_000);
  });

  it("ghi hai lần cùng key thì cập nhật chứ không nhân đôi dòng", async () => {
    await updateSetting("lowFundThreshold", 250_000);
    await updateSetting("lowFundThreshold", 300_000);
    const rows = await testDb.select().from(appSettings);
    expect(rows.filter((r) => r.key === "lowFundThreshold")).toHaveLength(1);
    expect((await getSettings()).lowFundThreshold).toBe(300_000);
  });

  it("từ chối giá trị sai schema và không ghi gì", async () => {
    const r = await updateSetting("lowFundThreshold", -1 as number);
    expect("error" in r).toBe(true);
    expect((await getSettings()).lowFundThreshold).toBe(100_000);
  });
});
