import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { venues, exchangeEvents, hostBlocks, members } from "@/db/schema";

const flag = vi.hoisted(() => ({ isExchangeEnabled: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => flag);
vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: vi.fn(async () => "1.2.3.4"),
}));

const { db: testDb, client } = await createTestDb();
const [venue] = await testDb
  .insert(venues)
  .values({ name: "V", lat: 10, lng: 106 })
  .returning();
vi.mock("@/db", () => ({ db: testDb }));

const { exchangeGate, checkBotAndRate, loadHostedEvent, isBlockedByHost } =
  await import("./guards");
const { runSerial } = await import("./serial");

const NOW = "2026-11-05T00:00:00.000Z";

async function seedMember(name: string) {
  const [m] = await testDb
    .insert(members)
    .values({ name })
    .returning({ id: members.id });
  return m.id;
}
async function seedEvent(hostMemberId: number) {
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: `c${hostMemberId}${Math.random().toString(36).slice(2, 8)}`,
      hostMemberId,
      venueId: venue.id,
      title: "t",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T12:00:00.000Z",
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: "2026-12-01T08:00:00.000Z",
      cancelDeadline: "2026-12-01T08:00:00.000Z",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: exchangeEvents.id });
  return e.id;
}
async function bucketCount() {
  const r = await client.execute(
    "SELECT COUNT(*) AS n FROM rate_limit_buckets",
  );
  return Number(r.rows[0].n);
}

beforeEach(async () => {
  await client.execute("DELETE FROM rate_limit_buckets");
  flag.isExchangeEnabled.mockReset();
  vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fwbb.example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("exchangeGate", () => {
  it("exchangeGate errors when the flag is off", async () => {
    flag.isExchangeEnabled.mockResolvedValue(false);
    expect(await exchangeGate()).toEqual({ error: "notFound" });
    flag.isExchangeEnabled.mockResolvedValue(true);
    expect(await exchangeGate()).toEqual({ ok: true });
  });
});

describe("checkBotAndRate", () => {
  const opts = {
    token: "tok",
    action: "exchange_open",
    rateKey: "k",
    limit: 2,
    windowMs: 60_000,
  };

  it("passes Turnstile then counts the rate limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true })),
    );
    expect(await checkBotAndRate(opts)).toEqual({ ok: true });
    expect(await bucketCount()).toBe(1);
  });

  it("failed Turnstile never touches rate_limit_buckets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false })),
    );
    expect(await checkBotAndRate(opts)).toEqual({ error: "captcha" });
    expect(await bucketCount()).toBe(0);
  });

  it("Cloudflare unreachable is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await checkBotAndRate(opts)).toEqual({ error: "captcha" });
    expect(await bucketCount()).toBe(0);
  });

  it("returns rateLimited once the limit is exceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true })),
    );
    await checkBotAndRate(opts);
    await checkBotAndRate(opts);
    expect(await checkBotAndRate(opts)).toEqual({ error: "rateLimited" });
  });

  it("missing APP_URL is a config error before any network call", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await checkBotAndRate(opts)).toEqual({ error: "config" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("host helpers", () => {
  it("loadHostedEvent returns null for another member's event", async () => {
    const host = await seedMember("host");
    const other = await seedMember("other");
    const id = await seedEvent(host);
    expect((await loadHostedEvent(testDb, id, host))?.id).toBe(id);
    expect(await loadHostedEvent(testDb, id, other)).toBeNull();
    expect(await loadHostedEvent(testDb, 99999, host)).toBeNull();
  });

  it("isBlockedByHost is directional", async () => {
    const host = await seedMember("h2");
    const m = await seedMember("m2");
    expect(await isBlockedByHost(testDb, host, m)).toBe(false);
    await testDb
      .insert(hostBlocks)
      .values({ hostMemberId: host, blockedMemberId: m, createdAt: NOW });
    expect(await isBlockedByHost(testDb, host, m)).toBe(true);
    expect(await isBlockedByHost(testDb, m, host)).toBe(false);
  });
});

describe("runSerial", () => {
  it("runs tasks one at a time and survives a rejection", async () => {
    const order: string[] = [];
    const a = runSerial(async () => {
      order.push("a1");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a2");
      throw new Error("boom");
    });
    const b = runSerial(async () => {
      order.push("b");
      return 7;
    });
    await expect(a).rejects.toThrow("boom");
    expect(await b).toBe(7);
    expect(order).toEqual(["a1", "a2", "b"]);
  });
});
