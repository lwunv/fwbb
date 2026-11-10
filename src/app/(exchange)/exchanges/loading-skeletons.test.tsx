// @vitest-environment jsdom
/**
 * Task 25 (rà giao diện mobile): G2d thêm dòng uy tín host (44px) vào đầu bài
 * và link "Hồ sơ của tôi" (44px) vào /exchanges/mine. Skeleton không giữ chỗ
 * thì nội dung bị đẩy xuống khi tải xong.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import EventLoading from "./[code]/loading";
import MineLoading from "./mine/loading";

afterEach(cleanup);

describe("exchange skeletons reserve the G2d rows", () => {
  it("event post skeleton has the 44px host row and the host reputation row", () => {
    const { container } = render(<EventLoading />);
    expect(container.querySelector(".min-h-11")).not.toBeNull();
    expect(screen.getByTestId("host-reputation-skeleton").className).toContain(
      "h-11",
    );
  });

  it("my exchanges skeleton has the 44px profile link row", () => {
    render(<MineLoading />);
    expect(screen.getByTestId("my-profile-link-skeleton").className).toContain(
      "h-11",
    );
  });
});
