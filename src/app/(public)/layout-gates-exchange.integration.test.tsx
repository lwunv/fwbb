/**
 * Cổng của (public)/layout.tsx khi có tài khoản giao lưu (g2a, Task 10). File
 * ghim của Task 1 (layout-gates.integration.test.tsx) giữ nguyên, các ô mới
 * của bảng hành vi nằm ở đây. Cờ `exchangeEnabled` được mock để bật/tắt.
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

const { default: PublicLayout } = await import("./layout");
const { Header } = await import("@/components/layout/header");
const { PendingApprovalGate } = await import("./pending-approval-gate");
const { ForceChangePasswordGate } =
  await import("./force-change-password-gate");
const { ExchangeAccountNotice } = await import("./exchange-account-notice");
const { isExchangeEnabled } = await import("@/lib/exchange-flag");

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

function expectBlockedScreen(tree: ReactNode) {
  expect(hasText(tree, "accountDisabledTitle")).toBe(true);
  expect(hasText(tree, "CHILD")).toBe(false);
  expect(findByType(tree, PendingApprovalGate)).toBeNull();
  expect(findByType(tree, ForceChangePasswordGate)).toBeNull();
  expect(findByType(tree, ExchangeAccountNotice)).toBeNull();
}

beforeEach(async () => {
  identity.current = null;
  flag.on = false;
  vi.mocked(isExchangeEnabled).mockClear();
  await client.execute("DELETE FROM members");
});

describe("(public)/layout: khách và member nhóm không đổi", () => {
  it("khách, cờ bật → vẫn Header showLogin mặc định, không đọc cờ", async () => {
    flag.on = true;
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    const header = findByType(tree, Header);
    expect(header?.props).toEqual({ appName: "FWBB", showLogin: true });
    expect(isExchangeEnabled).not.toHaveBeenCalled();
  });

  it("approved, cờ bật → như hiện tại, không đọc cờ", async () => {
    flag.on = true;
    await seed();
    const tree = await renderLayout();
    expect(hasText(tree, "CHILD")).toBe(true);
    const header = findByType(tree, Header);
    expect(header?.props).toEqual({ appName: "FWBB", showMenu: true });
    expect(isExchangeEnabled).not.toHaveBeenCalled();
  });

  it("rejected, cờ bật → màn khoá", async () => {
    flag.on = true;
    await seed({ approvalStatus: "rejected", signupIntent: "exchange" });
    expectBlockedScreen(await renderLayout());
  });

  it("approved + mustChangePassword, cờ bật → ForceChangePasswordGate", async () => {
    flag.on = true;
    await seed({ mustChangePassword: true });
    expectOnly(await renderLayout(), ForceChangePasswordGate);
  });
});

describe("(public)/layout: thứ tự cổng của loại tài khoản đang có", () => {
  it("màn chờ duyệt vẫn có Header (không menu, không nút đăng nhập)", async () => {
    await seed({ approvalStatus: "pending" });
    const tree = await renderLayout();
    const header = findByType(tree, Header);
    expect(header).not.toBeNull();
    expect(header?.props).toEqual({ appName: "FWBB" });
  });

  it("rejected + mustChangePassword → màn khoá", async () => {
    await seed({ approvalStatus: "rejected", mustChangePassword: true });
    expectBlockedScreen(await renderLayout());
  });

  it("pending + isActive=false → màn khoá", async () => {
    await seed({ approvalStatus: "pending", isActive: false });
    expectBlockedScreen(await renderLayout());
  });

  it("pending (group) + mustChangePassword → PendingApprovalGate", async () => {
    await seed({ approvalStatus: "pending", mustChangePassword: true });
    expectOnly(await renderLayout(), PendingApprovalGate);
  });
});

describe("(public)/layout: member chờ duyệt theo cờ", () => {
  it("pending exchange, cờ tắt → PendingApprovalGate", async () => {
    await seed({ approvalStatus: "pending", signupIntent: "exchange" });
    expectOnly(await renderLayout(), PendingApprovalGate);
  });

  it("pending group, cờ bật → PendingApprovalGate", async () => {
    flag.on = true;
    await seed({ approvalStatus: "pending", signupIntent: "group" });
    expectOnly(await renderLayout(), PendingApprovalGate);
  });

  it("pending group + mustChangePassword, cờ bật → PendingApprovalGate", async () => {
    flag.on = true;
    await seed({
      approvalStatus: "pending",
      signupIntent: "group",
      mustChangePassword: true,
    });
    expectOnly(await renderLayout(), PendingApprovalGate);
  });

  it("pending exchange, cờ bật → ExchangeAccountNotice có tên, Header không menu", async () => {
    flag.on = true;
    await seed({
      approvalStatus: "pending",
      signupIntent: "exchange",
      name: "Khách Zalo",
    });
    const tree = await renderLayout();
    expectOnly(tree, ExchangeAccountNotice);
    expect(findByType(tree, ExchangeAccountNotice)?.props.memberName).toBe(
      "Khách Zalo",
    );
    expect(findByType(tree, Header)?.props).toEqual({ appName: "FWBB" });
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
