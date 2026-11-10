// @vitest-environment jsdom
/**
 * Task 25 carry (Task 21 review): thẻ giả phải khớp thẻ đánh giá thật, nếu
 * không danh sách nhảy khi "Xem thêm" tải xong. Thẻ thật xếp sáu điểm với
 * `gap-y-1` và có hàng nút "Báo cáo" 44px khi người xem đã đăng nhập.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReviewSkeleton } from "./review-skeleton";

afterEach(cleanup);

describe("ReviewSkeleton", () => {
  it("uses the review card's criteria spacing", () => {
    const { container } = render(<ReviewSkeleton count={1} />);
    const grid = container.querySelector(".grid");
    expect(grid?.className).toContain("gap-y-1");
    expect(grid?.className).not.toContain("gap-y-2");
  });

  it("reserves the 44px report row only for a signed-in viewer", () => {
    render(<ReviewSkeleton count={2} report />);
    const rows = screen.getAllByTestId("review-skeleton-report");
    expect(rows).toHaveLength(2);
    expect(rows[0].firstElementChild?.className).toContain("h-11");
    cleanup();

    render(<ReviewSkeleton count={2} />);
    expect(screen.queryByTestId("review-skeleton-report")).toBeNull();
  });
});
