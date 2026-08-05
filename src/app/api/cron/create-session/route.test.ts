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

  it("Admin tắt tự động tạo buổi (autoCreateSessions=false) → không tạo gì", async () => {
    await testDb.insert((await import("@/db/schema")).appSettings).values({
      key: "autoCreateSessions",
      value: "false",
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00+07:00"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(await sessionDates()).toEqual([]);
    expect(body.skipped).toBe("autoCreateSessions is off");
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

  // courtPrice PHẢI khớp courtQuantity: buổi cron dùng đúng sân mặc định vào
  // ngày chơi (isRegular) → giá = monthly + retail*(qty-1). Bug đã sửa: trước
  // đây lấy pricePerSession trần nên buổi khai N sân mà giá chỉ 1 sân →
  // finalize (dùng thẳng courtPrice) thu thiếu khi defaultCourtQuantity > 1.
  describe("courtPrice khớp courtQuantity (computeCourtTotal)", () => {
    async function setDefaultCourt(opts: {
      monthly: number;
      retail: number | null;
      qty?: number;
    }) {
      const schema = await import("@/db/schema");
      await testDb.insert(courts).values({
        name: "Sân mặc định",
        pricePerSession: opts.monthly,
        pricePerSessionRetail: opts.retail,
        isActive: true,
      });
      const court = await testDb.query.courts.findFirst({
        where: eq(courts.name, "Sân mặc định"),
      });
      const rows = [{ key: "defaultCourtId", value: String(court!.id) }];
      if (opts.qty !== undefined) {
        rows.push({ key: "defaultCourtQuantity", value: String(opts.qty) });
      }
      await testDb.insert(schema.appSettings).values(rows);
    }

    async function runSaturdayThenGetMonday() {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-11T10:00:00+07:00"));
      await GET(makeRequest());
      // 2026-07-13 = Thứ Hai, ngày chơi mặc định (M/W/F).
      return testDb.query.sessions.findFirst({
        where: eq(sessions.date, "2026-07-13"),
      });
    }

    it("qty mặc định (1): courtPrice == pricePerSession, không đổi hành vi cũ", async () => {
      await setDefaultCourt({ monthly: 200_000, retail: 250_000 });
      const s = await runSaturdayThenGetMonday();
      expect(s?.courtQuantity).toBe(1);
      expect(s?.courtPrice).toBe(200_000);
    });

    it("qty=2 có giá lẻ: courtPrice = monthly + retail*(qty-1), KHÔNG phải giá 1 sân", async () => {
      await setDefaultCourt({ monthly: 200_000, retail: 250_000, qty: 2 });
      const s = await runSaturdayThenGetMonday();
      expect(s?.courtQuantity).toBe(2);
      expect(s?.courtPrice).toBe(450_000);
      expect(s?.courtPrice).not.toBe(200_000);
    });

    it("qty=2 không có giá lẻ (retail null): fallback monthly*qty", async () => {
      await setDefaultCourt({ monthly: 200_000, retail: null, qty: 2 });
      const s = await runSaturdayThenGetMonday();
      expect(s?.courtPrice).toBe(400_000);
    });
  });
});
