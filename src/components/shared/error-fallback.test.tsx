// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ErrorFallback } from "./error-fallback";
import { errorPageCopy } from "@/lib/error-page-copy";

afterEach(cleanup);

const copy = errorPageCopy.vi;

describe("ErrorFallback", () => {
  it("hiện tiêu đề, lời giải thích, nút Thử lại và đường về trang chủ", () => {
    render(<ErrorFallback copy={copy} onRetry={() => {}} />);

    expect(screen.getByRole("heading", { name: copy.title })).toBeTruthy();
    expect(screen.getByText(copy.description)).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.retry })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: copy.home }).getAttribute("href"),
    ).toBe("/");
  });

  it("bấm Thử lại thì gọi onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorFallback copy={copy} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: copy.retry }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("có digest thì in mã lỗi để đối chiếu log server", () => {
    render(
      <ErrorFallback copy={copy} onRetry={() => {}} digest="3627000779" />,
    );

    expect(screen.getByText(/3627000779/)).toBeTruthy();
  });

  it("không có digest thì không in dòng mã lỗi", () => {
    render(<ErrorFallback copy={copy} onRetry={() => {}} />);

    expect(screen.queryByText(new RegExp(copy.codeLabel))).toBeNull();
  });
});
