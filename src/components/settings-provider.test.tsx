// @vitest-environment jsdom
/**
 * Kiểm cơ chế wiring setting xuống UI (lớp integration, không phải e2e):
 *  1. SettingsProvider bơm được giá trị custom xuống consumer qua useSettings.
 *  2. Không có provider → useSettings fallback về default registry (không vỡ,
 *     giữ đúng hành vi mặc định).
 *  3. Một consumer THẬT (FundStatusIcon) đổi output khi đổi ngưỡng: cùng một
 *     balance nhưng ngưỡng khác nhau cho ra lowFund (hiện icon) vs hasFund
 *     (render null). Đây là bằng chứng "đổi setting → UI đổi", không chỉ
 *     "code compile".
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SettingsProvider, useSettings } from "./settings-provider";
import { FundStatusIcon } from "./shared/fund-status-icon";
import { defaultSettings } from "@/lib/settings-registry";

afterEach(cleanup);

function LowFundProbe() {
  const s = useSettings();
  return <span data-testid="v">{s.lowFundThreshold}</span>;
}

describe("SettingsProvider + useSettings", () => {
  it("bơm giá trị custom xuống consumer", () => {
    render(
      <SettingsProvider
        settings={{ ...defaultSettings(), lowFundThreshold: 250_000 }}
      >
        <LowFundProbe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("v").textContent).toBe("250000");
  });

  it("không có provider → fallback default registry (100000)", () => {
    render(<LowFundProbe />);
    expect(screen.getByTestId("v").textContent).toBe("100000");
  });
});

describe("consumer thật phản ứng theo ngưỡng: FundStatusIcon", () => {
  it("balance 50k, ngưỡng 100k → lowFund → hiện icon cảnh báo", () => {
    const { container } = render(
      <FundStatusIcon balance={50_000} lowFundThreshold={100_000} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByLabelText(/Còn/)).toBeTruthy();
  });

  it("cùng balance 50k nhưng hạ ngưỡng xuống 40k → hasFund → render null", () => {
    const { container } = render(
      <FundStatusIcon balance={50_000} lowFundThreshold={40_000} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
