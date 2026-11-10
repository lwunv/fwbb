// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import Loading from "./loading";

afterEach(cleanup);

describe("venue detail loading", () => {
  // Thiếu loading.tsx riêng thì Next lấy skeleton bản đồ toàn màn của /venues.
  it("loading skeleton mirrors the detail layout instead of the full-screen map", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[class*="aspect-[16/9]"]')).not.toBeNull();
    // Đủ năm hàng thông tin: địa chỉ, giờ, số sân, giá, số điện thoại.
    expect(container.querySelectorAll("[data-skeleton-row]")).toHaveLength(5);
    expect(
      container.querySelector('[data-testid="venues-overlay"]'),
    ).toBeNull();
  });
});
