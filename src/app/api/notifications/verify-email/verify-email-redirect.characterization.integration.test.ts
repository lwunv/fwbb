import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";

const { db: testDb } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { GET } = await import("./route");
const { sealVerifyToken } = await import("@/lib/notifications/tokens");

describe("verify-email redirect", () => {
  it("verify-email link redirects to /me?email=verified for an approved member", async () => {
    const [m] = await testDb
      .insert(members)
      .values({
        name: "M",
        facebookId: "fb-characterization",
        isActive: true,
        approvalStatus: "approved",
        email: "who@example.com",
      })
      .returning({ id: members.id });
    const token = sealVerifyToken(m.id, "who@example.com");
    const res = await GET(
      new NextRequest(
        `http://localhost:3101/api/notifications/verify-email?token=${encodeURIComponent(token)}`,
      ),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3101/me?email=verified",
    );
  });
});
