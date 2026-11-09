// @vitest-environment jsdom
/**
 * Nút "Xin vào nhóm" (g2a, Task 11). Phải đổi ngay sang trạng thái "Đã gửi"
 * khi bấm (optimistic) và trả lại nút + báo lỗi nếu server từ chối, để người
 * dùng không tưởng đã gửi khi thật ra chưa.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

const refresh = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
const actions = vi.hoisted(() => ({
  requestGroupMembership:
    vi.fn<() => Promise<{ success: true } | { error: string }>>(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => toastMock);
vi.mock("@/actions/member-approval", () => actions);

const { JoinGroupButton } = await import("./join-group-button");

function renderButton() {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <JoinGroupButton />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refresh.mockClear();
  toastMock.toast.error.mockClear();
  actions.requestGroupMembership.mockReset();
});
afterEach(cleanup);

describe("JoinGroupButton", () => {
  it("bấm → hiện 'Đã gửi' ngay khi server chưa trả lời, rồi refresh khi xong", async () => {
    let resolve!: (v: { success: true }) => void;
    actions.requestGroupMembership.mockReturnValue(
      new Promise((r) => (resolve = r)),
    );
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Xin vào nhóm" }));

    expect(screen.getByText("Đã gửi, chờ admin duyệt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Xin vào nhóm" })).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    resolve({ success: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Đã gửi, chờ admin duyệt")).toBeTruthy();
  });

  it("action lỗi → quay lại nút + toast lỗi, không refresh", async () => {
    actions.requestGroupMembership.mockResolvedValue({
      error: "Tài khoản đã bị từ chối.",
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Xin vào nhóm" }));

    await waitFor(() =>
      expect(toastMock.toast.error).toHaveBeenCalledWith(
        "Tài khoản đã bị từ chối.",
      ),
    );
    expect(screen.getByRole("button", { name: "Xin vào nhóm" })).toBeTruthy();
    expect(screen.queryByText("Đã gửi, chờ admin duyệt")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("nút đạt vùng chạm tối thiểu 44px", () => {
    renderButton();
    const btn = screen.getByRole("button", { name: "Xin vào nhóm" });
    expect(btn.className).toContain("min-h-11");
  });
});
