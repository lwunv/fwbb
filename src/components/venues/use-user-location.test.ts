// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUserLocation } from "./use-user-location";

type Success = (p: GeolocationPosition) => void;
type Failure = () => void;
let pendingSuccess: Success | null = null;
let calls: { ok: Success; fail: Failure }[] = [];

const pos = (lat: number, lng: number) =>
  ({ coords: { latitude: lat, longitude: lng } }) as GeolocationPosition;

beforeEach(() => {
  vi.useFakeTimers();
  pendingSuccess = null;
  calls = [];
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: Success, fail: Failure) => {
        pendingSuccess = ok;
        calls.push({ ok, fail });
      },
    },
  });
});

afterEach(() => vi.useRealTimers());

describe("useUserLocation", () => {
  it("quá 12 giây chưa có phản hồi → denied (hiện ô nhập địa chỉ)", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    expect(result.current.status).toBe("asking");
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.status).toBe("denied");
  });

  it("người dùng bấm Cho phép SAU 12 giây → vẫn nhận vị trí", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current.status).toBe("denied");
    act(() => pendingSuccess!(pos(21.03, 105.85)));
    expect(result.current.status).toBe("ok");
    expect(result.current.position).toEqual({ lat: 21.03, lng: 105.85 });
  });

  it("đã tự gõ địa chỉ thì GPS đến muộn không ghi đè", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    act(() => vi.advanceTimersByTime(15_000));
    act(() => result.current.setManual({ lat: 10.77, lng: 106.7 }, "Q1"));
    act(() => pendingSuccess!(pos(21.03, 105.85)));
    expect(result.current.position).toEqual({ lat: 10.77, lng: 106.7 });
    expect(result.current.label).toBe("Q1");
  });

  it("không có navigator.geolocation → unsupported", () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    expect(result.current.status).toBe("unsupported");
  });

  it("lần hỏi cũ trả muộn rồi lần hỏi mới báo lỗi → KHÔNG hạ trạng thái đã có vị trí", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    act(() => vi.advanceTimersByTime(12_000));
    act(() => result.current.request());
    act(() => calls[0].ok(pos(21.03, 105.85)));
    expect(result.current.status).toBe("ok");
    act(() => calls[1].fail());
    expect(result.current.status).toBe("ok");
    expect(result.current.position).toEqual({ lat: 21.03, lng: 105.85 });
  });

  it("callback của lần hỏi cũ không tắt hẹn giờ an toàn của lần hỏi mới", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    act(() => vi.advanceTimersByTime(12_000));
    act(() => result.current.request());
    act(() => calls[0].fail());
    expect(result.current.status).toBe("asking");
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.status).toBe("denied");
  });

  it("đã có vị trí, hỏi lại mà lỗi hoặc im lặng → quay về ok, không kẹt ở asking", () => {
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    act(() => calls[0].ok(pos(21.03, 105.85)));
    act(() => result.current.request());
    act(() => calls[1].fail());
    expect(result.current.status).toBe("ok");
    act(() => result.current.request());
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.status).toBe("ok");
  });
});
