// @vitest-environment jsdom
/**
 * Hàng chờ duyệt: huy hiệu `Z` cho người đăng nhập bằng Zalo, và nút "Không
 * nhận vào nhóm" chỉ có khi giao lưu đã bật (cờ tắt thì màn y như cũ).
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { ConfirmProvider } from "@/components/shared/confirm-provider";

const actions = vi.hoisted(() => ({
  approveMember: vi.fn(async () => ({ success: true })),
  rejectMember: vi.fn(async () => ({ success: true })),
  declineGroupRequest: vi.fn(async () => ({ success: true })),
  approveAndMergeMember: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/actions/member-approval", () => actions);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { PendingMembersSection } = await import("./pending-members-section");

function pending(id: number, name: string, providers: string[]) {
  return {
    id,
    name,
    nickname: null,
    email: null,
    phoneNumber: null,
    bankAccountNo: null,
    avatarKey: null,
    avatarUrl: null,
    facebookId: null,
    googleId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    providers,
    suggestions: [],
  };
}

function renderSection(exchangeEnabled: boolean) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <ConfirmProvider>
        <PendingMembersSection
          pendingMembers={[
            pending(1, "Có Zalo", ["zalo"]),
            pending(2, "Không Zalo", ["google"]),
          ]}
          exchangeEnabled={exchangeEnabled}
        />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
}

// jsdom không có matchMedia mà một component con gọi nó trong effect.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PendingMembersSection", () => {
  it("chỉ người có identity zalo mới có huy hiệu Z", () => {
    renderSection(false);
    expect(screen.getAllByLabelText("Zalo")).toHaveLength(1);
  });

  it("cờ tắt: không có nút Không nhận vào nhóm, nút Từ chối vẫn còn", () => {
    renderSection(false);
    expect(screen.queryByText("Không nhận vào nhóm")).toBeNull();
    expect(screen.getAllByText("Từ chối")).toHaveLength(2);
  });

  it("cờ bật: bấm Không nhận vào nhóm gỡ dòng ngay và gọi declineGroupRequest", async () => {
    renderSection(true);
    const buttons = screen.getAllByText("Không nhận vào nhóm");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    // Dòng rời danh sách ngay (sau animation thoát), không đợi server.
    await waitFor(() => expect(screen.queryByText("Có Zalo")).toBeNull());
    expect(screen.getByText("Không Zalo")).toBeTruthy();
    expect(actions.declineGroupRequest).toHaveBeenCalledWith(1);
    expect(actions.rejectMember).not.toHaveBeenCalled();
  });
});
