/**
 * Cổng của (exchange)/layout.tsx (g2a, Task 10): mỗi ô cột "mode exchange"
 * của bảng hành vi là một test. Layout này bọc /san, mà /san phải chạy y như
 * cũ khi cờ tắt, nên phần lớn test là "như (public)".
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
const flag = vi.hoisted(() => ({ on: false }));
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
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: vi.fn(async () => flag.on),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { default: ExchangeLayout } = await import("./layout");
const { Header } = await import("@/components/layout/header");
const { PendingApprovalGate } =
  await import("@/app/(public)/pending-approval-gate");
const { ForceChangePasswordGate } =
  await import("@/app/(public)/force-change-password-gate");
const { ExchangeAccountNotice } =
  await import("@/app/(public)/exchange-account-notice");
const { isExchangeEnabled } = await import("@/lib/exchange-flag");

async function renderLayout() {
  return resolveServerTree(await ExchangeLayout({ children: <p>CHILD</p> }));
}

async function seed(values: Partial<typeof members.$inferInsert> = {}) {
  const [m] = await testDb
    .insert(members)
    .values({ name: "Tester", approvalStatus: "approved", ...values })
    .returning({ id: members.id });
  identity.current = { memberId: m.id, externalId: `ext-${m.id}` };
  return m.id;
}

function expectOnly(tree: ReactNode, shown: unknown) {
  const gates = [
    PendingApprovalGate,
    ForceChangePasswordGate,
    ExchangeAccountNotice,
  ];
  for (const g of gates) {
    if (g === shown) expect(findByType(tree, g)).not.toBeNull();
    else expect(findByType(tree, g)).toBeNull();
  }
  expect(hasText(tree, "CHILD")).toBe(false);
  expect(hasText(tree, "accountDisabledTitle")).toBe(false);
}

function expectChildWithExchangeNav(tree: ReactNode) {
  expect(hasText(tree, "CHILD")).toBe(true);
  expect(findByType(tree, PendingApprovalGate)).toBeNull();
  expect(findByType(tree, ExchangeAccountNotice)).toBeNull();
  expect(findByType(tree, Header)?.props).toEqual({
    appName: "FWBB",
    showMenu: true,
    navItems: "exchange",
    homeHref: "/giao-luu",
  });
}

function expectBlockedScreen(tree: ReactNode) {
  expect(hasText(tree, "accountDisabledTitle")).toBe(true);
  expect(hasText(tree, "CHILD")).toBe(false);
  expect(findByType(tree, PendingApprovalGate)).toBeNull();
  expect(findByType(tree, ForceChangePasswordGate)).toBeNull();
}

beforeEach(async () => {
  identity.current = null;
  flag.on = false;
  vi.mocked(isExchangeEnabled).mockClear();
  await client.execute("DELETE FROM members");
});

describe("(exchange)/layout: khách", () => {
  it("cờ tắt → như (public): CHILD + Header showLogin mặc định", async () => {
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    expect(findByType(tree, Header)?.props).toEqual({
      appName: "FWBB",
      showLogin: true,
    });
  });

  it("cờ bật → Header đăng nhập trỏ /giao-luu/dang-nhap", async () => {
    flag.on = true;
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    expect(findByType(tree, Header)?.props).toEqual({
      appName: "FWBB",
      showLogin: true,
      loginHref: "/giao-luu/dang-nhap",
    });
  });
});

describe("(exchange)/layout: bị khoá / từ chối / không tồn tại", () => {
  it("rejected, cờ bật → màn khoá", async () => {
    flag.on = true;
    await seed({ approvalStatus: "rejected", signupIntent: "exchange" });
    expectBlockedScreen(await renderLayout());
  });

  it("isActive=false (pending exchange), cờ bật → màn khoá", async () => {
    flag.on = true;
    await seed({
      approvalStatus: "pending",
      signupIntent: "exchange",
      isActive: false,
    });
    expectBlockedScreen(await renderLayout());
  });

  it("member không tồn tại → màn khoá", async () => {
    identity.current = { memberId: 987654, externalId: "ghost" };
    expectBlockedScreen(await renderLayout());
  });
});

describe("(exchange)/layout: member", () => {
  it("approved → như hiện tại (Header showMenu, nav nhóm), không đọc cờ", async () => {
    flag.on = true;
    await seed();
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    expect(findByType(tree, Header)?.props).toEqual({
      appName: "FWBB",
      showMenu: true,
    });
    expect(isExchangeEnabled).not.toHaveBeenCalled();
  });

  it("approved + mustChangePassword → ForceChangePasswordGate", async () => {
    await seed({ mustChangePassword: true });
    expectOnly(await renderLayout(), ForceChangePasswordGate);
  });

  it("pending group, cờ tắt → PendingApprovalGate", async () => {
    await seed({ approvalStatus: "pending", signupIntent: "group" });
    expectOnly(await renderLayout(), PendingApprovalGate);
  });

  it("pending exchange, cờ tắt → PendingApprovalGate", async () => {
    await seed({ approvalStatus: "pending", signupIntent: "exchange" });
    expectOnly(await renderLayout(), PendingApprovalGate);
  });

  it("pending group, cờ bật → CHILD + nav giao lưu", async () => {
    flag.on = true;
    await seed({ approvalStatus: "pending", signupIntent: "group" });
    expectChildWithExchangeNav(await renderLayout());
  });

  it("pending exchange, cờ bật → CHILD + nav giao lưu", async () => {
    flag.on = true;
    await seed({ approvalStatus: "pending", signupIntent: "exchange" });
    expectChildWithExchangeNav(await renderLayout());
  });

  it("pending exchange + mustChangePassword, cờ bật → ForceChangePasswordGate", async () => {
    flag.on = true;
    await seed({
      approvalStatus: "pending",
      signupIntent: "exchange",
      mustChangePassword: true,
    });
    expectOnly(await renderLayout(), ForceChangePasswordGate);
  });
});
