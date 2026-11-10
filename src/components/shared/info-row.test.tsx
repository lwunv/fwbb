// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InfoRow } from "./info-row";

afterEach(cleanup);

const classesOf = (el: Element | null) =>
  (el?.getAttribute("class") ?? "").split(/\s+/);

describe("InfoRow", () => {
  it("keeps the value on one line by default", () => {
    render(<InfoRow label="Tổng" value="120.000đ" />);
    const value = screen.getByText("120.000đ");
    expect(classesOf(value.parentElement)).toContain("shrink-0");
    expect(classesOf(value)).not.toContain("wrap-anywhere");
  });

  it("wrapValue lets a long value wrap beside a fixed label instead of overflowing the row", () => {
    render(
      <InfoRow
        label="Địa chỉ"
        value="Số 2 Phạm Văn Đồng, Mai Dịch, Cầu Giấy, Hà Nội"
        valueClassName="text-base"
        wrapValue
      />,
    );
    const label = screen.getByText("Địa chỉ");
    const value = screen.getByText(/Phạm Văn Đồng/);
    expect(classesOf(label)).toContain("shrink-0");
    expect(classesOf(value.parentElement)).not.toContain("shrink-0");
    expect(classesOf(value.parentElement)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1"]),
    );
    expect(classesOf(value)).toEqual(
      expect.arrayContaining(["text-right", "wrap-anywhere", "text-base"]),
    );
  });
});
