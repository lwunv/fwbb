// @vitest-environment jsdom
/**
 * Khối số liệu trên hồ sơ công khai (G2d Task 17, quyết định 8, 12, 13, 14).
 * Điều dễ hỏng im lặng: hiện "0%" khi chưa có mẫu số, hiện dòng khen "0 lượt"
 * (không bấm khen không phải là chê), hoặc có khối host cho người chưa từng
 * làm host.
 */
import type { ReactElement } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import type { PublicPlayerProfile } from "@/lib/reputation/public-profile";
import { HostStats, ReputationStats } from "./reputation-stats";
import { PeerKudos } from "./peer-kudos";

afterEach(cleanup);

function renderVi(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type Attendance = PublicPlayerProfile["attendance"];
const attendance = (over: Partial<Attendance> = {}): Attendance => ({
  attended: 4,
  approvedPast: 5,
  lateCancels: 1,
  noShows: 0,
  charged: 4,
  paidOnTime: 3,
  ...over,
});

describe("ReputationStats", () => {
  it("stats hide the rate when approvedPast is 0", () => {
    renderVi(<ReputationStats attendance={attendance()} />);
    expect(screen.getByText("Đã đến")).toBeTruthy();
    expect(screen.getByText("4 buổi")).toBeTruthy();
    expect(screen.getByText("Tỉ lệ đến")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("Huỷ muộn")).toBeTruthy();
    expect(screen.getByText("Vắng")).toBeTruthy();
    expect(screen.getByText("Trả đúng hạn")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    cleanup();

    renderVi(
      <ReputationStats
        attendance={attendance({
          attended: 0,
          approvedPast: 0,
          charged: 0,
          paidOnTime: 0,
        })}
      />,
    );
    expect(screen.getByText("Đã đến")).toBeTruthy();
    expect(screen.queryByText("Tỉ lệ đến")).toBeNull();
    // Chưa bị tính phí lần nào thì không có dòng trả đúng hạn (không phải 0%).
    expect(screen.queryByText("Trả đúng hạn")).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe("PeerKudos", () => {
  it("kudos hide zero lines and show the not-enough line when nothing is left", () => {
    renderVi(
      <PeerKudos
        peer={{
          raters: 6,
          playAgain: 4,
          tags: [
            { tag: "on_time", count: 3 },
            { tag: "friendly", count: 0 },
            { tag: "nice_play", count: 2 },
          ],
          skill: null,
        }}
      />,
    );
    expect(screen.getByText("Muốn chơi lại cùng")).toBeTruthy();
    expect(screen.getByText("4 lượt")).toBeTruthy();
    expect(screen.getByText("Đúng giờ")).toBeTruthy();
    expect(screen.getByText("Đánh đẹp")).toBeTruthy();
    expect(screen.queryByText("Vui vẻ")).toBeNull();
    expect(screen.queryByText("Fair play")).toBeNull();
    expect(screen.queryByText("Chưa đủ lượt chấm để hiện")).toBeNull();
    cleanup();

    // playAgain null và mọi tag bằng 0: không còn dòng nào.
    renderVi(
      <PeerKudos
        peer={{
          raters: 3,
          playAgain: null,
          tags: [{ tag: "fair_play", count: 0 }],
          skill: null,
        }}
      />,
    );
    expect(screen.queryByText("Muốn chơi lại cùng")).toBeNull();
    expect(screen.queryByText("Fair play")).toBeNull();
    expect(screen.getByText("Chưa đủ lượt chấm để hiện")).toBeTruthy();
    cleanup();

    renderVi(
      <PeerKudos
        peer={{ raters: null, playAgain: null, tags: [], skill: null }}
      />,
    );
    expect(screen.getByText("Chưa đủ lượt chấm để hiện")).toBeTruthy();
  });
});

describe("HostStats", () => {
  it("host block only for someone who hosted", () => {
    const { container } = renderVi(<HostStats host={null} />);
    expect(container.textContent).toBe("");
    cleanup();

    renderVi(
      <HostStats
        host={{
          organized: 6,
          cancelled: 1,
          cancelPct: 14,
          raters: null,
          asDescribedPct: null,
          feeAsPromisedPct: 100,
        }}
      />,
    );
    expect(screen.getByText("Khi làm host")).toBeTruthy();
    expect(screen.getByText("Đã tổ chức")).toBeTruthy();
    expect(screen.getByText("6 buổi")).toBeTruthy();
    expect(screen.getByText("Tỉ lệ huỷ")).toBeTruthy();
    expect(screen.getByText("14%")).toBeTruthy();
    expect(screen.getByText("Đúng phí")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    // null = chưa đủ người chấm, không phải 0%.
    expect(screen.queryByText("Đúng mô tả")).toBeNull();
  });
});
