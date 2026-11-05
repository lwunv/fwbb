import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";

const mocks = vi.hoisted(() => ({ flag: vi.fn() }));
vi.mock("@/lib/exchange-flag", () => ({ isExchangeEnabled: mocks.flag }));

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { GET } = await import("./route");
const { sealVerifyToken } = await import("@/lib/notifications/tokens");

let n = 0;
async function verifyAs(o: Partial<typeof members.$inferInsert>) {
  n += 1;
  const email = `who${n}@example.com`;
  const [m] = await testDb
    .insert(members)
    .values({
      name: "M",
      facebookId: `fb-${Math.random()}`,
      isActive: true,
      email,
      ...o,
    })
    .returning({ id: members.id });
  const token = sealVerifyToken(m.id, email);
  const res = await GET(
    new NextRequest(
      `http://localhost:3101/api/notifications/verify-email?token=${encodeURIComponent(token)}`,
    ),
  );
  return res.headers.get("location");
}

describe("verify-email redirect for exchange accounts", () => {
  it("verify-email sends an exchange account back to /giao-luu/cua-toi when the flag is on", async () => {
    mocks.flag.mockResolvedValue(true);
    expect(
      await verifyAs({ approvalStatus: "pending", signupIntent: "exchange" }),
    ).toBe("http://localhost:3101/giao-luu/cua-toi?email=verified");
  });

  it("verify-email keeps /me for an exchange account when the flag is off and for group members", async () => {
    mocks.flag.mockResolvedValue(false);
    expect(
      await verifyAs({ approvalStatus: "pending", signupIntent: "exchange" }),
    ).toBe("http://localhost:3101/me?email=verified");
    mocks.flag.mockResolvedValue(true);
    expect(await verifyAs({ approvalStatus: "approved" })).toBe(
      "http://localhost:3101/me?email=verified",
    );
  });
});
