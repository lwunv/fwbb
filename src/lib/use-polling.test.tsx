// @vitest-environment jsdom
/**
 * Nhịp tự làm mới.
 *
 * Bài quan trọng nhất là bài "tab bị ẩn thì im". Ngày 24/10/2026 cả web sập vì
 * cháy hạn mức đọc của Turso, và thủ phạm chính là những tab quản lý mở rồi
 * quên: không ai nhìn, nhưng cứ vài giây lại bắt server dựng lại trang và đọc
 * hàng nghìn dòng. Mất chốt chặn đó là lặp lại đúng sự cố.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { HEAVY_POLL_MS, usePolling } from "./use-polling";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

/** Giả lập người dùng chuyển tab. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function Probe({ interval }: { interval?: number }) {
  usePolling(interval);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  setHidden(false);
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("nhịp tự làm mới", () => {
  it("tab đang xem: làm mới theo đúng nhịp", () => {
    render(<Probe interval={1000} />);

    act(() => void vi.advanceTimersByTime(3000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("tab bị ẩn: KHÔNG gọi server lần nào", () => {
    render(<Probe interval={1000} />);
    setHidden(true);
    refresh.mockClear();

    act(() => void vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("quay lại tab: làm mới NGAY, không bắt chờ hết một nhịp", () => {
    render(<Probe interval={10_000} />);
    setHidden(true);
    refresh.mockClear();

    setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("quay lại tab rồi thì nhịp chạy tiếp", () => {
    render(<Probe interval={1000} />);
    setHidden(true);
    setHidden(false);
    refresh.mockClear();

    act(() => void vi.advanceTimersByTime(2000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("mặc định 30 giây, không phải 5", () => {
    render(<Probe />);

    act(() => void vi.advanceTimersByTime(29_000));
    expect(refresh).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rời trang thì dừng hẳn, không để timer chạy mồ côi", () => {
    const { unmount } = render(<Probe interval={1000} />);
    unmount();
    refresh.mockClear();

    act(() => void vi.advanceTimersByTime(10_000));
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * Trang quản lý nào vừa quét sổ cái vừa tự làm mới phải dùng nhịp chậm.
 *
 * Đo ngày 2/11/2026 trên dữ liệu thật: sổ cái có 2.021 dòng, và một lượt dựng
 * trang `/admin/members` đọc khoảng 5.000 dòng (1.881 dòng sổ cái lọc theo 51
 * member, 1.504 dòng để tính số buổi đã chơi, 750 dòng nợ kèm nối bảng). Nhịp
 * 30 giây nghĩa là 120 lượt mỗi giờ, tức 600.000 dòng một giờ cho MỘT tab, mà
 * mức nền cả hệ thống lúc đó chỉ khoảng 460.000 dòng một giờ.
 *
 * Nhịp chậm không làm dữ liệu cũ đi: mỗi lượt dựng vẫn đọc thẳng từ database,
 * thao tác của chính admin vẫn hiện tức thì (optimistic + revalidatePath), và
 * `usePolling` vốn đã làm mới NGAY khi quay lại tab. Nhịp chỉ còn ảnh hưởng
 * đúng một trường hợp: ngồi nhìn chằm chằm một tab mà không đụng vào.
 */
const TRANG_NANG = [
  "../app/(admin)/admin/members/member-list.tsx",
  "../app/(admin)/admin/dashboard/dashboard-client.tsx",
  "../app/(admin)/admin/sessions/session-list.tsx",
  "../app/(admin)/admin/sessions/[id]/session-detail.tsx",
];

describe("nhịp cho trang quét sổ cái", () => {
  it("nhịp chậm tối thiểu 5 phút", () => {
    expect(HEAVY_POLL_MS).toBeGreaterThanOrEqual(300_000);
  });

  it("đúng nhịp chậm đó khi chạy", () => {
    render(<Probe interval={HEAVY_POLL_MS} />);

    act(() => void vi.advanceTimersByTime(HEAVY_POLL_MS - 1_000));
    expect(refresh).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(TRANG_NANG)("%s dùng nhịp chậm, không dùng mặc định", (rel) => {
    const src = readFileSync(new URL(rel, import.meta.url), "utf-8");
    expect(src).toMatch(/usePolling\(HEAVY_POLL_MS\)/);
    expect(src).not.toMatch(/usePolling\(\s*\)/);
  });
});
