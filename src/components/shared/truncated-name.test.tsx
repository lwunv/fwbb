// @vitest-environment jsdom
/**
 * Tên member trong danh sách vote: trên điện thoại tên dài bị cắt "Trần ...",
 * nên chạm hoặc rê chuột phải hiện đủ tên. Tên ngắn đã hiện đủ thì không bật
 * bong bóng thừa.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TruncatedName } from "./truncated-name";

afterEach(cleanup);

function fakeWidths(el: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(el, "scrollWidth", {
    configurable: true,
    value: scroll,
  });
  Object.defineProperty(el, "clientWidth", {
    configurable: true,
    value: client,
  });
}

describe("tên member bị cắt", () => {
  it("chạm vào tên bị cắt thì hiện đủ tên trong bong bóng", () => {
    render(<TruncatedName name="Trần Văn Nghiện Cờ Bạc" />);
    const btn = screen.getByRole("button", { name: "Trần Văn Nghiện Cờ Bạc" });
    fakeWidths(btn, 300, 80);
    fireEvent.click(btn);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Trần Văn Nghiện Cờ Bạc",
    );
  });

  it("rê chuột vào tên bị cắt cũng hiện", () => {
    render(<TruncatedName name="Trần Văn Nghiện Cờ Bạc" />);
    const btn = screen.getByRole("button");
    fakeWidths(btn, 300, 80);
    fireEvent.pointerEnter(btn, { pointerType: "mouse" });
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("tên đã hiện đủ thì không bật bong bóng", () => {
    render(<TruncatedName name="An" />);
    const btn = screen.getByRole("button");
    fakeWidths(btn, 20, 80);
    fireEvent.click(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("chạm lần nữa thì đóng", () => {
    render(<TruncatedName name="Trần Văn Nghiện Cờ Bạc" />);
    const btn = screen.getByRole("button");
    fakeWidths(btn, 300, 80);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
