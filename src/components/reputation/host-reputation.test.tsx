// @vitest-environment jsdom
/**
 * Dòng uy tín host trên trang buổi (G2d Task 16, quyết định 18). Điều dễ hỏng
 * im lặng: hiện "0%" hay "null%" khi chưa đủ người chấm, host chưa tổ chức buổi
 * nào lại hiện "Đã tổ chức 0 buổi" thay vì "Host mới", hoặc có dòng (và link
 * hỏng) khi host chưa có mã hồ sơ.
 */
import type { ReactElement } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";
import enMessages from "@/i18n/messages/en.json";
import type { PublicPlayerProfile } from "@/lib/reputation/public-profile";
import { toHostLine, type HostLine } from "@/lib/reputation/host-line";
import { HostReputation } from "./host-reputation";
import { NewBadge } from "./new-badge";

afterEach(cleanup);

function renderVi(ui: ReactElement, locale: "vi" | "en" = "vi") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "vi" ? viMessages : enMessages}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const line = (over: Partial<HostLine> = {}): HostLine => ({
  code: "hostcode22",
  organized: 3,
  asDescribedPct: 90,
  feeAsPromisedPct: 100,
  ...over,
});

function profile(host: PublicPlayerProfile["host"]): PublicPlayerProfile {
  return {
    code: "hostcode22",
    name: "Minh Host",
    avatarUrl: null,
    avatarKey: null,
    selfSkill: null,
    isNew: false,
    referred: false,
    attendance: {
      attended: 0,
      approvedPast: 0,
      lateCancels: 0,
      noShows: 0,
      charged: 0,
      paidOnTime: 0,
    },
    peer: { raters: null, playAgain: null, tags: [], skill: null },
    host,
  };
}

const hostSummary = (
  over: Partial<NonNullable<PublicPlayerProfile["host"]>> = {},
): NonNullable<PublicPlayerProfile["host"]> => ({
  organized: 4,
  cancelled: 0,
  cancelPct: 0,
  raters: 5,
  asDescribedPct: 80,
  feeAsPromisedPct: 75,
  ...over,
});

describe("HostReputation", () => {
  it("the host line links to /players/{code}, shows Host mới when nothing was organized, and is absent without a code", () => {
    renderVi(<HostReputation line={line()} />);
    const link = screen.getByRole("link", { name: /Đã tổ chức 3 buổi/ });
    expect(link.getAttribute("href")).toBe("/players/hostcode22");
    expect(link.className).toMatch(/min-h-11/);
    expect(screen.queryByText("Host mới")).toBeNull();
    cleanup();

    renderVi(
      <HostReputation
        line={line({
          organized: 0,
          asDescribedPct: null,
          feeAsPromisedPct: null,
        })}
      />,
    );
    const fresh = screen.getByRole("link", { name: /Host mới/ });
    expect(fresh.getAttribute("href")).toBe("/players/hostcode22");
    expect(screen.queryByText(/Đã tổ chức/)).toBeNull();

    // Trang buổi dựng dòng từ hồ sơ: không mã hoặc không hồ sơ thì không có dòng.
    expect(toHostLine(null, profile(hostSummary()))).toBeNull();
    expect(toHostLine("hostcode22", null)).toBeNull();
    // `host: null` (chưa từng tổ chức) được coi như organized = 0.
    expect(toHostLine("hostcode22", profile(null))).toEqual({
      code: "hostcode22",
      organized: 0,
      asDescribedPct: null,
      feeAsPromisedPct: null,
    });
    expect(toHostLine("hostcode22", profile(hostSummary()))).toEqual({
      code: "hostcode22",
      organized: 4,
      asDescribedPct: 80,
      feeAsPromisedPct: 75,
    });
  });

  it("percentages show only when not null", () => {
    renderVi(<HostReputation line={line()} />);
    expect(screen.getByText("Đúng mô tả 90%")).toBeTruthy();
    expect(screen.getByText("Đúng phí 100%")).toBeTruthy();
    cleanup();

    renderVi(
      <HostReputation
        line={line({ asDescribedPct: null, feeAsPromisedPct: 0 })}
      />,
    );
    expect(screen.queryByText(/Đúng mô tả/)).toBeNull();
    // 0% là một số thật (đủ người chấm, không ai bấm "đúng"): vẫn hiện.
    expect(screen.getByText("Đúng phí 0%")).toBeTruthy();
    cleanup();

    const { container } = renderVi(
      <HostReputation
        line={line({ asDescribedPct: null, feeAsPromisedPct: null })}
      />,
    );
    expect(container.textContent).not.toMatch(/%|null/);
  });

  it("uses an ICU plural for the organized count in English", () => {
    renderVi(<HostReputation line={line({ organized: 1 })} />, "en");
    expect(screen.getByText("Organized 1 event")).toBeTruthy();
    cleanup();
    renderVi(<HostReputation line={line({ organized: 5 })} />, "en");
    expect(screen.getByText("Organized 5 events")).toBeTruthy();
  });
});

describe("NewBadge", () => {
  it("shows the Mới chip", () => {
    renderVi(<NewBadge />);
    expect(screen.getByText("Mới")).toBeTruthy();
  });

  // Task 25 carry (Task 16 review): chip "Host mới" từng chép tay class của
  // NewBadge, sửa một bên là hai chip lệch nhau.
  it("the Host mới chip is the same badge as Mới", () => {
    renderVi(
      <>
        <NewBadge />
        <HostReputation line={line({ organized: 0 })} />
      </>,
    );
    expect(screen.getByText("Host mới").className).toBe(
      screen.getByText("Mới").className,
    );
  });
});
