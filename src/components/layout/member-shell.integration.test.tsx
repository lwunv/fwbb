/**
 * Chuông thông báo trong MemberShell: chỉ nhánh đã duyệt và nhánh giao lưu chờ
 * duyệt mới có; khách, bị khoá, chờ duyệt nhóm, đổi mật khẩu thì không. Gọi
 * thẳng Server Component rồi đọc prop `showBell` của Header.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  user: null as { memberId: number } | null,
  member: null as Record<string, unknown> | null,
  enabled: false,
  exchange: true,
}));

vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: async () => h.user,
}));
vi.mock("@/db", () => ({
  db: { query: { members: { findFirst: async () => h.member } } },
}));
vi.mock("@/actions/settings", () => ({
  getAppName: async () => "FWBB",
  getSettings: async () => ({ notificationsEnabled: h.enabled }),
}));
vi.mock("@/lib/exchange-flag", () => ({
  isExchangeEnabled: async () => h.exchange,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (k: string) => k,
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/app/(public)/pending-approval-gate", () => ({
  PendingApprovalGate: () => null,
}));
vi.mock("@/app/(public)/force-change-password-gate", () => ({
  ForceChangePasswordGate: () => null,
}));
vi.mock("@/app/(public)/exchange-account-notice", () => ({
  ExchangeAccountNotice: () => null,
}));

const { MemberShell } = await import("./member-shell");
const { Header } = await import("@/components/layout/header");

/** Tìm Header trong cây element (shell chỉ trả về cây tĩnh, chưa render). */
function findHeader(node: unknown): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  const el = node as ReactElement<{ children?: unknown }>;
  if (el.type === Header) return el;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const found = findHeader(k);
    if (found) return found;
  }
  return null;
}

async function bell(mode: "group" | "exchange" = "group") {
  const tree = await MemberShell({ mode, children: null });
  const header = findHeader(tree);
  expect(header).not.toBeNull();
  return Boolean((header!.props as { showBell?: boolean }).showBell);
}

const approved = {
  isActive: true,
  approvalStatus: "approved",
  mustChangePassword: false,
  signupIntent: "group",
  name: "A",
};

beforeEach(() => {
  h.user = { memberId: 1 };
  h.member = { ...approved };
  h.enabled = true;
  h.exchange = true;
});

describe("MemberShell bell", () => {
  it("guest, locked, pending-group and forced-password branches render no bell", async () => {
    h.user = null;
    expect(await bell()).toBe(false);

    h.user = { memberId: 1 };
    h.member = { ...approved, isActive: false };
    expect(await bell()).toBe(false);

    h.member = { ...approved, approvalStatus: "pending" };
    expect(await bell()).toBe(false);

    h.member = { ...approved, mustChangePassword: true };
    expect(await bell()).toBe(false);
  });

  it("approved branch renders it only when notificationsEnabled", async () => {
    expect(await bell()).toBe(true);
    h.enabled = false;
    expect(await bell()).toBe(false);
  });

  it("exchange-pending branch renders it only when notificationsEnabled", async () => {
    h.member = {
      ...approved,
      approvalStatus: "pending",
      signupIntent: "exchange",
    };
    expect(await bell("exchange")).toBe(true);
    h.enabled = false;
    expect(await bell("exchange")).toBe(false);
  });

  it("rejected members see the locked screen branch with a bell only when enabled", async () => {
    h.member = { ...approved, approvalStatus: "rejected" };
    expect(await bell()).toBe(true);
    h.enabled = false;
    expect(await bell()).toBe(false);
  });
});
