// @vitest-environment jsdom
/**
 * Khi admin bấm "Mở vote", hạn bị xóa (null) nên đồng hồ đếm ngược không còn
 * gì để hiện. Test này chốt: chỗ đó phải nói rõ "đang mở, không hạn" khi được
 * yêu cầu, và vẫn im lặng ở màn member (mặc định) để không đổi UI công khai.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import { VoteCountdown } from "./vote-countdown";

afterEach(cleanup);

function renderCountdown(props: {
  deadline: string | null;
  showNoDeadline?: boolean;
}) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VoteCountdown variant="inline" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("VoteCountdown — không có hạn vote", () => {
  it("showNoDeadline → hiện nhãn 'Đang mở (không hạn)'", () => {
    renderCountdown({ deadline: null, showNoDeadline: true });
    expect(screen.getByText("Đang mở (không hạn)")).toBeTruthy();
  });

  it("mặc định (không truyền cờ) → không render gì", () => {
    const { container } = renderCountdown({ deadline: null });
    expect(container.textContent).toBe("");
  });

  it("có hạn thì cờ showNoDeadline không đổi gì (vẫn là đồng hồ)", () => {
    const { container } = renderCountdown({
      deadline: "2026-06-01T20:30:00",
      showNoDeadline: true,
    });
    expect(container.textContent).not.toContain("Đang mở");
  });
});
