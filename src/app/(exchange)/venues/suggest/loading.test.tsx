// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Loading from "./loading";

afterEach(cleanup);

describe("/venues/suggest loading", () => {
  it("is shaped like the suggest form, not the full-screen map of /venues", () => {
    const { container } = render(<Loading />);
    const root = screen.getByTestId("suggest-skeleton");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    // Trang đề xuất là trang cuộn thường: không có khung fixed hay skeleton bản đồ.
    expect(container.querySelector(".fixed")).toBeNull();
    expect(screen.queryByTestId("venues-panel-skeleton")).toBeNull();

    expect(screen.getByTestId("suggest-skeleton-title")).toBeTruthy();
    const fields = screen.getAllByTestId("suggest-skeleton-field");
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const field of fields) {
      // Mỗi hàng: nhãn rồi ô nhập cao 44px như Input thật.
      expect(field.querySelector(".h-11")).not.toBeNull();
    }
    const submit = screen.getByTestId("suggest-skeleton-submit");
    expect(submit.querySelector(".h-\\[46px\\]")).not.toBeNull();
    expect(
      fields.every(
        (f) =>
          (f.compareDocumentPosition(submit) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ),
    ).toBe(true);
  });
});
