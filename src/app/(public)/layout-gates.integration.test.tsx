/**
 * Characterization (03/11/2026, trước g2a): ghim hành vi hiện tại của
 * (public)/layout.tsx. Test dùng resolveServerTree nên vẫn đúng khi logic layout
 * được bọc vào một server component async lồng bên trong.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { createTestDb } from "@/db/test-db";
import { members } from "@/db/schema";
import {
  resolveServerTree,
  findByType,
  hasText,
} from "@/test-utils/resolve-server-tree";

const identity = vi.hoisted(() => ({
  current: null as { memberId: number; externalId: string } | null,
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => identity.current),
  clearUserCookie: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/actions/settings", async (orig) => ({
  ...(await orig<typeof import("@/actions/settings")>()),
  getAppName: vi.fn(async () => "FWBB"),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { default: PublicLayout } = await import("./layout");
const { Header } = await import("@/components/layout/header");
const { PendingApprovalGate } = await import("./pending-approval-gate");
const { ForceChangePasswordGate } =
  await import("./force-change-password-gate");

async function renderLayout() {
  return resolveServerTree(await PublicLayout({ children: <p>CHILD</p> }));
}

async function seed(values: Partial<typeof members.$inferInsert> = {}) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Tester", approvalStatus: "approved", ...values })
    .returning({ id: members.id });
  identity.current = { memberId: m.id, externalId: `ext-${m.id}` };
  return m.id;
}

function expectBlockedScreen(tree: ReactNode) {
  expect(hasText(tree, "accountDisabledTitle")).toBe(true);
  expect(hasText(tree, "CHILD")).toBe(false);
  expect(findByType(tree, PendingApprovalGate)).toBeNull();
  expect(findByType(tree, ForceChangePasswordGate)).toBeNull();
}

beforeEach(async () => {
  identity.current = null;
  await client.execute("DELETE FROM members");
});

describe("(public)/layout gates", () => {
  it("layout: khách → có CHILD, Header showLogin", async () => {
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    const header = findByType(tree, Header);
    expect(header?.props.showLogin).toBe(true);
    expect(header?.props.showMenu).toBeUndefined();
    expect(header?.props.appName).toBe("FWBB");
  });

  it("layout: approved → có CHILD, Header showMenu", async () => {
    await seed();
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    const header = findByType(tree, Header);
    expect(header?.props.showMenu).toBe(true);
    expect(header?.props.showLogin).toBeUndefined();
    expect(findByType(tree, PendingApprovalGate)).toBeNull();
    expect(findByType(tree, ForceChangePasswordGate)).toBeNull();
  });

  it("layout: pending → PendingApprovalGate, không có CHILD", async () => {
    await seed({
      approvalStatus: "pending",
      name: "Chờ duyệt",
      nickname: "Bi",
      phoneNumber: "0900000001",
      bankAccountNo: "123456",
    });
    const tree = await renderLayout();
    const gate = findByType(tree, PendingApprovalGate);
    expect(gate).not.toBeNull();
    expect(gate?.props).toMatchObject({
      memberName: "Chờ duyệt",
      nickname: "Bi",
      phoneNumber: "0900000001",
      bankAccountNo: "123456",
    });
    expect(hasText(tree, "CHILD")).toBe(false);
    expect(hasText(tree, "accountDisabledTitle")).toBe(false);
    const header = findByType(tree, Header);
    expect(header?.props.showMenu).toBeUndefined();
    expect(header?.props.showLogin).toBeUndefined();
  });

  it("layout: rejected → màn khoá, không có CHILD", async () => {
    await seed({ approvalStatus: "rejected" });
    expectBlockedScreen(await renderLayout());
  });

  it("layout: isActive=false → màn khoá, không có CHILD", async () => {
    await seed({ isActive: false });
    expectBlockedScreen(await renderLayout());
  });

  it("layout: member không tồn tại → màn khoá, không có CHILD", async () => {
    identity.current = { memberId: 987654, externalId: "ghost" };
    expectBlockedScreen(await renderLayout());
  });

  it("layout: approved + mustChangePassword → ForceChangePasswordGate, không có CHILD", async () => {
    await seed({ mustChangePassword: true });
    const tree = await renderLayout();
    expect(findByType(tree, ForceChangePasswordGate)).not.toBeNull();
    expect(hasText(tree, "CHILD")).toBe(false);
    expect(findByType(tree, PendingApprovalGate)).toBeNull();
    expect(hasText(tree, "accountDisabledTitle")).toBe(false);
  });
});
