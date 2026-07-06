/**
 * Cron /api/cron/create-session — trước đây KHÔNG có test. Quyết định
 * 2026-07-06: vào Thứ Bảy, mở sẵn CẢ 3 buổi (T2/4/6) của tuần KẾ TIẾP cùng
 * lúc, thay vì mỗi ngày chỉ tạo buổi "ngày mai" như trước. Các ngày khác giữ
 * nguyên hành vi cũ (tạo buổi ngày mai nếu là ngày chơi).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/db/test-db";
import { sessions, sessionShuttlecocks, courts } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

process.env.CRON_SECRET = "test-secret";
const { GET } = await import("./route");

function makeRequest() {
  return new NextRequest("http://localhost/api/cron/create-session", {
    headers: { authorization: "Bearer test-secret" },
  });
}

async function reset() {
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM shuttlecock_brands");
  await client.execute("DELETE FROM app_settings");
}

async function sessionDates() {
  const rows = await testDb.query.sessions.findMany({
    columns: { date: true },
  });
  return rows.map((r) => r.date).sort();
}

describe("GET /api/cron/create-session", () => {
  beforeEach(async () => {
    await reset();
    await testDb
      .insert(courts)
      .values({ name: "Sân test", pricePerSession: 200000, isActive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Thứ Bảy (2026-07-11): mở sẵn cả 3 buổi T2/4/6 tuần kế tiếp cùng lúc", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00+07:00"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(await sessionDates()).toEqual([
      "2026-07-13",
      "2026-07-15",
      "2026-07-17",
    ]);
    expect(body.message).toContain("2026-07-13");
    expect(body.message).toContain("2026-07-15");
    expect(body.message).toContain("2026-07-17");
  });

  it("Thứ Bảy chạy lần 2 (đã có sẵn 3 buổi): không tạo trùng, báo đã tồn tại", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00+07:00"));
    await GET(makeRequest());

    const res2 = await GET(makeRequest());
    const body2 = await res2.json();

    expect(await sessionDates()).toEqual([
      "2026-07-13",
      "2026-07-15",
      "2026-07-17",
    ]);
    expect(body2.message).toBe("Next week's sessions already existed");
  });

  it("Ngày thường (Thứ Hai 2026-07-06): chỉ tạo buổi NGÀY MAI như cũ", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00+07:00"));

    const res = await GET(makeRequest());
    const body = await res.json();

    // Thứ Ba (07-07) không phải ngày chơi (mặc định T2/4/6) → không tạo gì.
    expect(await sessionDates()).toEqual([]);
    expect(body.message).toBe("Not a session day");
  });

  it("Ngày thường (Thứ Ba 2026-07-07): tạo đúng 1 buổi ngày mai (Thứ Tư)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T10:00:00+07:00"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(await sessionDates()).toEqual(["2026-07-08"]);
    expect(body.message).toBe("Session created for 2026-07-08");
  });

  it("Thiếu/sai CRON_SECRET → 401, không tạo gì", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00+07:00"));

    const badReq = new NextRequest("http://localhost/api/cron/create-session", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await GET(badReq);
    expect(res.status).toBe(401);
    expect(await sessionDates()).toEqual([]);
  });

  it("Buổi mở theo Thứ Bảy có kèm shuttlecock brand mặc định", async () => {
    await testDb
      .insert((await import("@/db/schema")).shuttlecockBrands)
      .values({ name: "Brand test", pricePerTube: 300000, isActive: true });
    const brandRow = await testDb.query.shuttlecockBrands.findFirst();
    await testDb.insert((await import("@/db/schema")).appSettings).values({
      key: "defaultBrandId",
      value: String(brandRow!.id),
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00+07:00"));
    await GET(makeRequest());

    const created = await testDb.query.sessions.findFirst({
      where: eq(sessions.date, "2026-07-13"),
    });
    const sc = await testDb.query.sessionShuttlecocks.findFirst({
      where: eq(sessionShuttlecocks.sessionId, created!.id),
    });
    expect(sc?.brandId).toBe(brandRow!.id);
  });
});
