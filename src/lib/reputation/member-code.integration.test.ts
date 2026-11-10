import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";

const mocks = vi.hoisted(() => ({ newCode: vi.fn() }));
vi.mock("@/lib/exchange/public-code", async (orig) => {
  const real = await orig<typeof import("@/lib/exchange/public-code")>();
  mocks.newCode.mockImplementation(real.newPublicCode);
  return { newPublicCode: mocks.newCode };
});

const { db: testDb } = await createTestDb();
const { ensureMemberPublicCode } = await import("./member-code");

const CODE = /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/;

async function seedMember(publicCode: string | null = null) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "m", approvalStatus: "approved", publicCode })
    .returning({ id: members.id });
  return m.id;
}
async function storedCode(id: number) {
  const [row] = await testDb
    .select({ code: members.publicCode })
    .from(members)
    .where(eq(members.id, id));
  return row.code;
}

describe("ensureMemberPublicCode", () => {
  it("ensure assigns a 10-character code once and returns the same code next time", async () => {
    const id = await seedMember();
    const first = await ensureMemberPublicCode(testDb, id);
    expect(first).toMatch(CODE);
    expect(await storedCode(id)).toBe(first);
    const calls = mocks.newCode.mock.calls.length;
    expect(await ensureMemberPublicCode(testDb, id)).toBe(first);
    // An existing code is returned as is, no new code is drawn.
    expect(mocks.newCode.mock.calls.length).toBe(calls);
  });

  it("two concurrent ensures end with one stored code", async () => {
    const id = await seedMember();
    const [a, b] = await Promise.all([
      ensureMemberPublicCode(testDb, id),
      ensureMemberPublicCode(testDb, id),
    ]);
    expect(a).toBe(b);
    expect(await storedCode(id)).toBe(a);
  });

  it("a taken code is retried with a new one", async () => {
    await seedMember("takencode2");
    const id = await seedMember();
    mocks.newCode.mockReturnValueOnce("takencode2");
    const code = await ensureMemberPublicCode(testDb, id);
    expect(code).not.toBe("takencode2");
    expect(code).toMatch(CODE);
    expect(await storedCode(id)).toBe(code);
  });

  it("gives up after 5 taken codes and leaves the member without a code", async () => {
    await seedMember("takencode3");
    const id = await seedMember();
    for (let i = 0; i < 5; i++) mocks.newCode.mockReturnValueOnce("takencode3");
    await expect(ensureMemberPublicCode(testDb, id)).rejects.toThrow();
    expect(await storedCode(id)).toBeNull();
  });

  it("an unknown member is an error, not a silent empty code", async () => {
    await expect(ensureMemberPublicCode(testDb, 999_999)).rejects.toThrow();
  });
});
