// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  configure,
  waitFor,
} from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { DupSignalGroupView } from "@/lib/reputation/dup-signals";

configure({ asyncUtilTimeout: 3000 });

const actions = vi.hoisted(() => ({
  mergeMember: vi.fn(),
  ignoreDuplicateGroup: vi.fn(),
  getMembers: vi.fn(async () => []),
  getCurrentAdminMemberId: vi.fn(async () => null),
  findDuplicateMembers: vi.fn(async () => [] as unknown[]),
}));
const flag = vi.hoisted(() => ({ isExchangeEnabled: vi.fn() }));
const dup = vi.hoisted(() => ({ findExchangeDuplicateSignals: vi.fn() }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/actions/members", () => actions);
vi.mock("@/actions/exchange-dup-signals", () => dup);
vi.mock("@/lib/exchange-flag", () => flag);
vi.mock("@/actions/finance", () => ({ getAllDebts: vi.fn(async () => []) }));
vi.mock("@/actions/stats", () => ({
  getMemberPlayStats: vi.fn(async () => ({})),
}));
vi.mock("@/actions/member-approval", () => ({
  getNameMatchesBatch: vi.fn(async () => ({})),
}));
vi.mock("@/db", () => ({
  db: {
    query: { members: { findMany: vi.fn(async () => []) } },
    select: vi.fn(),
  },
}));
vi.mock("./pending-queue", () => ({
  loadPendingGroupRows: vi.fn(async () => []),
  loadIdentityProviders: vi.fn(async () => ({})),
  splitExchangeAccounts: () => ({ regular: [], exchange: [] }),
}));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const { DuplicateMembersBanner } = await import("./duplicate-members-banner");
const { default: MembersPage } = await import("./page");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const signalGroups: DupSignalGroupView[] = [
  {
    key: "same_name_network:3-4",
    reason: "same_name_network",
    members: [
      {
        id: 3,
        name: "Nguyễn Văn An",
        avatarUrl: null,
        avatarKey: null,
        isExchange: true,
        createdAt: "2026-11-01T03:00:00.000Z",
        code: "abcdefghij",
      },
      {
        id: 4,
        name: "Nguyen Van An",
        avatarUrl: null,
        avatarKey: null,
        isExchange: false,
        createdAt: "2026-10-01T03:00:00.000Z",
        code: null,
      },
    ],
  },
  {
    key: "network_burst:5-6-7",
    reason: "network_burst",
    members: [5, 6, 7].map((id) => ({
      id,
      name: `Nick ${id}`,
      avatarUrl: null,
      avatarKey: null,
      isExchange: true,
      createdAt: "2026-11-02T03:00:00.000Z",
      code: null,
    })),
  },
];

const nameGroup = {
  name: "Lan",
  members: [1, 2].map((id) => ({
    id,
    name: "Lan",
    nickname: null,
    avatarKey: null,
    avatarUrl: null,
    isActive: true,
    facebookId: null,
    balance: 0,
    ledgerCount: id,
  })),
};

function mount(props: Parameters<typeof DuplicateMembersBanner>[0]) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <DuplicateMembersBanner {...props} />
    </NextIntlClientProvider>,
  );
}

describe("duplicate exchange account signals", () => {
  it("signal groups render under their own heading with the reason and no merge button", () => {
    mount({ groups: [], signalGroups });
    expect(
      screen.getByText("Tài khoản giao lưu có dấu hiệu trùng"),
    ).toBeTruthy();
    expect(screen.getByText("Cùng tên và từng dùng chung mạng")).toBeTruthy();
    expect(
      screen.getByText("3 tài khoản tạo trong 24 giờ từ cùng một mạng"),
    ).toBeTruthy();
    expect(screen.getByText("Nguyễn Văn An")).toBeTruthy();
    // Chip "Tài khoản giao lưu" chỉ cho người là tài khoản giao lưu (1 + 3).
    expect(screen.getAllByText("Tài khoản giao lưu")).toHaveLength(4);
    const profile = screen.getByRole("link", { name: "Xem hồ sơ" });
    expect(profile.getAttribute("href")).toBe("/players/abcdefghij");
    expect(screen.getAllByRole("link", { name: "Xem hồ sơ" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Bỏ qua/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Gộp/ })).toBeNull();
    // Phần trùng tên không hiện khi không có nhóm trùng tên.
    expect(screen.queryByText(/Phát hiện thành viên trùng tên/)).toBeNull();
  });

  it("Bỏ qua hides the group at once and brings it back with a toast on error", async () => {
    let resolveIgnore: (v: unknown) => void = () => {};
    actions.ignoreDuplicateGroup.mockReturnValueOnce(
      new Promise((r) => (resolveIgnore = r)),
    );
    mount({ groups: [], signalGroups });
    fireEvent.click(screen.getAllByRole("button", { name: /Bỏ qua/ })[0]);
    await waitFor(() => expect(screen.queryByText("Nguyễn Văn An")).toBeNull());
    expect(actions.ignoreDuplicateGroup).toHaveBeenCalledWith([3, 4]);
    // Nhóm kia vẫn còn.
    expect(screen.getByText("Nick 5")).toBeTruthy();
    resolveIgnore({ success: true });

    actions.ignoreDuplicateGroup.mockResolvedValue({ error: "nope" });
    fireEvent.click(screen.getByRole("button", { name: /Bỏ qua/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("nope"));
    expect(await screen.findByText("Nick 5")).toBeTruthy();
    expect(actions.ignoreDuplicateGroup).toHaveBeenCalledWith([5, 6, 7]);
    // Nhóm đã bỏ qua thành công không quay lại.
    expect(screen.queryByText("Nguyễn Văn An")).toBeNull();
  });

  it("name groups keep their merge flow", () => {
    mount({ groups: [nameGroup], signalGroups });
    expect(
      screen.getByText(/Phát hiện thành viên trùng tên \(1\)/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gộp vào ID #2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Gộp vào ID #2/ }));
    expect(screen.getByText(/Gộp vào Lan \(#2\)\?/)).toBeTruthy();
    expect(
      screen.getByText("Tài khoản giao lưu có dấu hiệu trùng"),
    ).toBeTruthy();
  });

  // Task 25 carry (Tasks 23+24 review): tên trong nhóm trùng tên bị cắt "..."
  // mà không xem được đủ, nút chỉ cao 32px.
  it("name groups show full wrapped names and 44px buttons", () => {
    mount({ groups: [nameGroup], signalGroups: [] });
    const names = screen.getAllByTestId("dup-member-name");
    expect(names).toHaveLength(2);
    for (const n of names) {
      expect(n.className).not.toContain("truncate");
      expect(n.className).toContain("break-words");
    }
    for (const b of [
      screen.getByRole("button", { name: /Gộp vào ID #2/ }),
      ...screen.getAllByRole("button", { name: /Bỏ qua/ }),
    ]) {
      expect(b.className).toContain("min-h-11");
    }
  });

  it("the members page passes signal groups only when the exchange flag is on", async () => {
    const findBanner = (node: ReactNode): ReactElement | undefined => {
      if (Array.isArray(node)) {
        for (const n of node) {
          const hit = findBanner(n);
          if (hit) return hit;
        }
        return undefined;
      }
      if (!isValidElement(node)) return undefined;
      if (node.type === DuplicateMembersBanner) return node;
      return findBanner((node.props as { children?: ReactNode }).children);
    };

    flag.isExchangeEnabled.mockResolvedValue(true);
    dup.findExchangeDuplicateSignals.mockResolvedValue(signalGroups);
    const on = findBanner(await MembersPage());
    expect(on).toBeTruthy();
    expect((on!.props as { signalGroups: unknown }).signalGroups).toEqual(
      signalGroups,
    );

    vi.clearAllMocks();
    flag.isExchangeEnabled.mockResolvedValue(false);
    dup.findExchangeDuplicateSignals.mockResolvedValue(signalGroups);
    expect(findBanner(await MembersPage())).toBeUndefined();
    expect(dup.findExchangeDuplicateSignals).not.toHaveBeenCalled();

    actions.findDuplicateMembers.mockResolvedValueOnce([nameGroup]);
    const off = findBanner(await MembersPage());
    expect((off!.props as { signalGroups: unknown }).signalGroups).toEqual([]);
  });
});
