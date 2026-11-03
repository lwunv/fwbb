import { describe, it, expect } from "vitest";
import { overlayValue } from "./optimistic-overlay";

describe("overlayValue", () => {
  it("chưa có overlay cho id → dùng giá trị từ server", () =>
    expect(overlayValue({}, 1, 7)).toBe(7));
  it("overlay là số → dùng overlay", () =>
    expect(overlayValue({ 1: 9 }, 1, 7)).toBe(9));
  it("overlay là null (vừa bỏ nối) → null, KHÔNG rơi về giá trị server", () =>
    expect(overlayValue({ 1: null }, 1, 7)).toBeNull());
});
