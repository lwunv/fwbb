/**
 * Integration test cho approveAndMergeMember + getNameMatches — trước đây
 * KHÔNG có test. Quyết định 2026-07-06: KHÔNG chặn merge khi target đã có
 * mật khẩu riêng nữa (trước đó chặn hẳn) — cho merge NHƯNG reset mật khẩu cũ
 * (set null) để tránh 2 người cùng truy cập 1 tài khoản (chống chiếm tài
 * khoản theo cách khác: đảm bảo chỉ còn 1 đường đăng nhập sau merge).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { approveAndMergeMember, getNameMatches } =
  await import("./member-approval");

async function reset() {
  await client.execute("DELETE FROM members");
}

async function memberById(id: number) {
  return testDb.query.members.findFirst({ where: eq(members.id, id) });
}

describe("approveAndMergeMember", () => {
  beforeEach(reset);

  it("target CÓ mật khẩu riêng: merge vẫn thành công, passwordHash bị reset về null", async () => {
    const [target] = await testDb
      .insert(members)
      .values({
        name: "Tuấn Béo",
        nickname: "Tuấn Béo",
        approvalStatus: "approved",
        passwordHash: "$2a$10$realbcrypthashforexistinguser",
        email: "old@example.com",
      })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "Tuấn Phạm",
        approvalStatus: "pending",
        googleId: "google-sub-123",
      })
      .returning({ id: members.id });

    const result = await approveAndMergeMember(pending.id, target.id);
    expect(result).toEqual({ success: true });

    const merged = await memberById(target.id);
    expect(merged?.passwordHash).toBeNull();
    expect(merged?.googleId).toBe("google-sub-123");
    expect(merged?.approvalStatus).toBe("approved");

    const pendingRow = await memberById(pending.id);
    expect(pendingRow).toBeUndefined(); // hard-deleted sau merge
  });

  it("target KHÔNG có mật khẩu: merge thành công, passwordHash vẫn null (không đổi gì thừa)", async () => {
    const [target] = await testDb
      .insert(members)
      .values({ name: "Placeholder", approvalStatus: "approved" })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "Placeholder Thật",
        approvalStatus: "pending",
        facebookId: "fb-456",
      })
      .returning({ id: members.id });

    const result = await approveAndMergeMember(pending.id, target.id);
    expect(result).toEqual({ success: true });

    const merged = await memberById(target.id);
    expect(merged?.passwordHash).toBeNull();
    expect(merged?.facebookId).toBe("fb-456");
  });

  it("cả 2 bên cùng có googleId (2 OAuth account thật khác nhau) → vẫn chặn, không liên quan password", async () => {
    const [target] = await testDb
      .insert(members)
      .values({
        name: "A",
        approvalStatus: "approved",
        googleId: "google-target",
      })
      .returning({ id: members.id });
    const [pending] = await testDb
      .insert(members)
      .values({
        name: "A giống tên",
        approvalStatus: "pending",
        googleId: "google-pending",
      })
      .returning({ id: members.id });

    const result = await approveAndMergeMember(pending.id, target.id);
    expect(result).toHaveProperty("error");
  });
});

describe("getNameMatches", () => {
  beforeEach(reset);

  it("trả hasPassword=true cho candidate đã có mật khẩu riêng", async () => {
    await testDb.insert(members).values({
      name: "Tuấn Béo",
      nickname: "Tuấn Béo",
      approvalStatus: "approved",
      passwordHash: "$2a$10$hash",
    });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Tuấn Phạm", approvalStatus: "pending" })
      .returning({ id: members.id });

    const suggestions = await getNameMatches(pending.id);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].hasPassword).toBe(true);
  });

  it("trả hasPassword=false cho candidate admin-tạo chưa có mật khẩu", async () => {
    await testDb.insert(members).values({
      name: "Tuấn Béo",
      approvalStatus: "approved",
    });
    const [pending] = await testDb
      .insert(members)
      .values({ name: "Tuấn Béo", approvalStatus: "pending" })
      .returning({ id: members.id });

    const suggestions = await getNameMatches(pending.id);
    expect(suggestions[0].hasPassword).toBe(false);
  });
});
