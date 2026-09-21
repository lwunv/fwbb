// @vitest-environment jsdom
/**
 * `useFireAction` — chốt chặn gọi trùng + trạng thái chờ.
 *
 * Ca đầu là ca có tiền: trang thuê sân sinh `idempotencyKey` mới mỗi lần bấm,
 * nên bấm hai lần là ghi HAI thanh toán thật. Hook phải bỏ qua cú bấm thứ hai
 * khi cú thứ nhất còn đang bay.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const { useFireAction } = await import("./use-fire-action");

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  toastMock.error.mockClear();
  toastMock.success.mockClear();
});

describe("useFireAction", () => {
  it("bấm hai lần liên tiếp: lần thứ hai BỊ BỎ QUA, action chỉ chạy một lần", async () => {
    const { result } = renderHook(() => useFireAction());
    const action = vi.fn(
      () =>
        new Promise<{ success: true }>((r) =>
          setTimeout(() => r({ success: true }), 20),
        ),
    );

    let first = false;
    let second = false;
    act(() => {
      first = result.current.fire(action);
      // Cú thứ hai xảy ra TRƯỚC khi React render lại, nên chốt chặn phải nằm ở
      // ref chứ không phải state.
      second = result.current.fire(action);
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  });

  it("xong lần đầu thì bấm lại được", async () => {
    const { result } = renderHook(() => useFireAction());
    const action = vi.fn(async () => ({ success: true as const }));

    await act(async () => {
      result.current.fire(action);
      await flush();
    });
    expect(result.current.pending).toBe(false);

    await act(async () => {
      result.current.fire(action);
      await flush();
    });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("pending bật khi đang chạy và tắt khi xong", async () => {
    const { result } = renderHook(() => useFireAction());
    let release: (() => void) | null = null;
    const action = () =>
      new Promise<{ success: true }>((r) => {
        release = () => r({ success: true });
      });

    act(() => {
      result.current.fire(action);
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      release!();
      await flush();
    });
    expect(result.current.pending).toBe(false);
  });

  it("action lỗi: vẫn rollback, vẫn báo lỗi, và mở khoá cho lần bấm sau", async () => {
    const { result } = renderHook(() => useFireAction());
    const rollback = vi.fn();
    const failing = vi.fn(async () => ({ error: "hỏng" }));

    await act(async () => {
      result.current.fire(failing, rollback, { retry: false });
      await flush();
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith("hỏng");
    expect(result.current.pending).toBe(false);

    // Quan trọng: hỏng rồi thì vẫn phải bấm lại được, không được kẹt khoá.
    const ok = vi.fn(async () => ({ success: true as const }));
    await act(async () => {
      const accepted = result.current.fire(ok);
      expect(accepted).toBe(true);
      await flush();
    });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("gọi tiếp onSuccess/onError của nơi gọi", async () => {
    const { result } = renderHook(() => useFireAction());
    const onSuccess = vi.fn();
    await act(async () => {
      result.current.fire(async () => ({ success: true as const }), undefined, {
        onSuccess,
      });
      await flush();
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("unmount giữa chừng không làm vỡ gì", async () => {
    const { result, unmount } = renderHook(() => useFireAction());
    let release: (() => void) | null = null;
    act(() => {
      result.current.fire(
        () =>
          new Promise<{ success: true }>((r) => {
            release = () => r({ success: true });
          }),
      );
    });
    unmount();
    await act(async () => {
      release!();
      await flush();
    });
    // Không có assertion nào ngoài "không ném" — đây là ca chống cảnh báo
    // setState-sau-unmount khi dialog đóng ngay lúc bấm.
    expect(true).toBe(true);
  });
});
