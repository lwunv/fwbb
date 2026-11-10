// @vitest-environment jsdom
/**
 * Trang buổi giao lưu dạng bài (g2b, Task 16). Các điều dễ hỏng im lặng:
 * 1. Khách không thấy liên hệ, link nhóm, tên người tham gia hay tài khoản nhận tiền.
 * 2. Số tiền chỉ hiện, không tính lại ở client: `remaining` và `refundDue` đến từ server.
 * 3. Phí đã chốt cao hơn số đã hiện thì nói đúng một câu, không nêu lý do.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { exchangeWhenLabel } from "@/lib/exchange/format";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import viMessages from "@/i18n/messages/vi.json";
import { getVietQRUrl } from "@/lib/vietqr";
import { makeEvent, makeReg, makeViewer } from "./fixtures";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/use-is-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/actions/exchange-registrations", () => ({
  registerForExchange: vi.fn(),
  cancelMyRegistration: vi.fn(),
}));
vi.mock("@/actions/exchange-reports", () => ({ reportAbuse: vi.fn() }));
vi.mock("@/components/exchange/comments/comment-section", () => ({
  CommentSection: (p: { code: string; signedIn: boolean }) => (
    <div
      data-testid="comments"
      data-code={p.code}
      data-signed={String(p.signedIn)}
    />
  ),
}));
vi.mock("@/components/security/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));
const feedback = vi.hoisted(() => ({ form: vi.fn() }));
vi.mock("@/actions/reputation", () => ({
  getEventFeedbackForm: feedback.form,
  submitEventFeedback: vi.fn(),
}));

const { EventPost } = await import("./event-post");

afterEach(cleanup);

type Props = Parameters<typeof EventPost>[0];

function renderPost(props: Partial<Props> = {}) {
  return render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <EventPost
        event={makeEvent()}
        viewer={makeViewer()}
        memberGender={null}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("EventPost", () => {
  it("post shows title, venue link, fee, slot bar and directions; no phone or email", () => {
    const { container } = renderPost();
    expect(
      screen.getByRole("heading", { name: "Giao lưu tối thứ ba" }),
    ).toBeTruthy();
    const venue = screen.getByRole("link", { name: /Sân Cầu Lông Tân Bình/ });
    expect(venue.getAttribute("href")).toBe("/venues/5");
    expect(screen.getByText(/^80\.000\s₫ mỗi người$/)).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "4",
    );
    expect(screen.getByText("còn 2 slot nữ")).toBeTruthy();
    const dir = screen.getByRole("link", { name: "Chỉ đường" });
    expect(dir.getAttribute("href")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=10.8,106.65",
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\d{9,}/);
    expect(screen.queryByText("Liên hệ host")).toBeNull();
  });

  it("mounts the comment section under #comments with the signed-in hint", () => {
    const { container } = renderPost();
    const slot = container.querySelector("#comments");
    const section = slot?.querySelector("[data-testid=comments]");
    expect(section?.getAttribute("data-code")).toBe("ABCD1234");
    expect(section?.getAttribute("data-signed")).toBe("false");
  });

  it("guest sees login CTA with next back to the event", () => {
    renderPost();
    const cta = screen.getByRole("link", { name: "Đăng nhập để đăng ký" });
    expect(cta.getAttribute("href")).toBe(
      `/exchanges/login?next=${encodeURIComponent("/exchanges/ABCD1234")}`,
    );
  });

  it("approved registrant sees contact, zalo link, names and QR with remaining", () => {
    renderPost({
      viewer: makeViewer({
        role: "member",
        myRegistration: makeReg({ remaining: 80000 }),
        hostContact: "zalo.me/minhhost",
        zaloGroupLink: "https://zalo.me/g/abc",
        attendees: [
          { name: "Lan Nguyen", avatarUrl: null, avatarKey: null, code: null },
          { name: "Bao Tran", avatarUrl: null, avatarKey: null, code: null },
        ],
        payout: {
          bankBin: "970416",
          accountNo: "123456789",
          accountName: "NGUYEN VAN A",
        },
      }),
    });
    expect(screen.getByText("zalo.me/minhhost")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Vào nhóm Zalo" }).getAttribute("href"),
    ).toBe("https://zalo.me/g/abc");
    expect(screen.getByText("Lan Nguyen")).toBeTruthy();
    expect(screen.getByText("Bao Tran")).toBeTruthy();
    const qr = screen.getByRole("img", { name: "Mã QR chuyển khoản" });
    expect(qr.getAttribute("src")).toBe(
      getVietQRUrl({
        bankBin: "970416",
        accountNo: "123456789",
        accountName: "NGUYEN VAN A",
        amount: 80000,
        memo: "GL ABCD1234 12",
      }),
    );
  });

  it("refundDue shows the refund line", () => {
    renderPost({
      viewer: makeViewer({
        role: "member",
        myRegistration: makeReg({ status: "cancelled", refundDue: 30000 }),
      }),
    });
    expect(
      screen.getByText(/^Host sẽ hoàn lại 30\.000\s₫ ngoài app$/),
    ).toBeTruthy();
  });

  it("paid less than a raised fee still shows the pay block for the remaining, not the paid line", () => {
    renderPost({
      viewer: makeViewer({
        role: "member",
        myRegistration: makeReg({ paid: true, remaining: 20000 }),
        payout: {
          bankBin: "970416",
          accountNo: "123456789",
          accountName: "NGUYEN VAN A",
        },
      }),
    });
    expect(screen.queryByText("Đã thanh toán")).toBeNull();
    const qr = screen.getByRole("img", { name: "Mã QR chuyển khoản" });
    expect(qr.getAttribute("src")).toBe(
      getVietQRUrl({
        bankBin: "970416",
        accountNo: "123456789",
        accountName: "NGUYEN VAN A",
        amount: 20000,
        memo: "GL ABCD1234 12",
      }),
    );
  });

  it("paid with nothing remaining shows the paid line", () => {
    renderPost({
      viewer: makeViewer({
        role: "member",
        myRegistration: makeReg({ paid: true, remaining: 0 }),
      }),
    });
    expect(screen.getByText("Đã thanh toán")).toBeTruthy();
  });

  it("no payout account falls back to paying the host directly", () => {
    renderPost({
      viewer: makeViewer({
        role: "member",
        myRegistration: makeReg({ remaining: 50000 }),
      }),
    });
    expect(screen.getByText("Thanh toán trực tiếp với host")).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "Mã QR chuyển khoản" }),
    ).toBeNull();
  });

  it("locked above estimate shows the higher-than-shown line", () => {
    renderPost({
      event: makeEvent({
        status: "locked",
        fee: {
          kind: "locked",
          rates: { male: 90000, female: 90000 },
          aboveEstimate: true,
        },
      }),
    });
    expect(screen.getByText("Phí cao hơn số đã hiện lúc đăng ký")).toBeTruthy();
  });

  it("approved attendee names link to profiles; no code means plain text", () => {
    renderPost({
      viewer: makeViewer({
        role: "member",
        myRegistration: makeReg(),
        attendees: [
          {
            name: "Lan Nguyen",
            avatarUrl: null,
            avatarKey: null,
            code: "lannguyen1",
          },
          { name: "Bao Tran", avatarUrl: null, avatarKey: null, code: null },
        ],
      }),
    });
    const link = screen.getByRole("link", { name: /Lan Nguyen/ });
    expect(link.getAttribute("href")).toBe("/players/lannguyen1");
    expect(link.className).toContain("min-h-11");
    expect(screen.getByText("Bao Tran").closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /Bao Tran/ })).toBeNull();
  });

  it("the host line links to /players/{code}, shows Host mới when nothing was organized, and is absent without a code", () => {
    renderPost({
      hostLine: {
        code: "hostcode22",
        organized: 3,
        asDescribedPct: 90,
        feeAsPromisedPct: null,
      },
    });
    const link = screen.getByRole("link", { name: /Đã tổ chức 3 buổi/ });
    expect(link.getAttribute("href")).toBe("/players/hostcode22");
    expect(screen.getByText("Đúng mô tả 90%")).toBeTruthy();
    expect(screen.queryByText(/Đúng phí/)).toBeNull();
    cleanup();

    renderPost({
      hostLine: {
        code: "hostcode22",
        organized: 0,
        asDescribedPct: null,
        feeAsPromisedPct: null,
      },
    });
    expect(
      screen.getByRole("link", { name: /Host mới/ }).getAttribute("href"),
    ).toBe("/players/hostcode22");
    cleanup();

    // Không mã hồ sơ thì trang truyền `hostLine` null: không có dòng nào.
    const { container } = renderPost({ hostLine: null });
    expect(container.querySelector('a[href^="/players/"]')).toBeNull();
    expect(screen.queryByText("Host mới")).toBeNull();
  });
});

// Final review F8: the date chip used Intl in render. Node's ICU writes the
// Vietnamese weekday differently from Chrome's ("Th 4" vs "Thứ 4"), so the
// server HTML and the first browser render disagreed (React #418).
describe("EventPost hydration", () => {
  let hydrated: { root: Root; container: HTMLElement } | null = null;
  afterEach(() => {
    if (hydrated) {
      const { root, container } = hydrated;
      act(() => root.unmount());
      container.remove();
      hydrated = null;
    }
    vi.restoreAllMocks();
  });

  const post = () => (
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <EventPost
        event={makeEvent()}
        viewer={makeViewer()}
        memberGender={null}
      />
    </NextIntlClientProvider>
  );

  it("the date chip is the fixed-table label and hydrates without a mismatch when the browser ICU differs", () => {
    const html = renderToString(post());
    const event = makeEvent();
    const label = exchangeWhenLabel(event.startAt, event.endAt, "vi");
    expect(html).toContain(label);

    // Browser ICU: same API, different weekday wording.
    const RealDTF = Intl.DateTimeFormat;
    // `function`, not an arrow: the component calls it with `new`.
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
      locale?: string | string[],
      opts?: Intl.DateTimeFormatOptions,
    ) {
      const real = new RealDTF(locale, opts);
      if (!opts?.weekday) return real;
      return {
        ...real,
        resolvedOptions: () => real.resolvedOptions(),
        formatToParts: (d?: Date | number) => real.formatToParts(d),
        format: (d?: Date | number) => `Browser ${real.format(d)}`,
      };
    } as never);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    act(() => {
      hydrated = {
        root: hydrateRoot(container, post(), { onRecoverableError }),
        container,
      };
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(
      consoleError.mock.calls
        .map((args) => args.map(String).join(" "))
        .filter((m) => /hydrat|did not match|server rendered/i.test(m)),
    ).toEqual([]);
    expect(container.textContent).toContain(label);
  });
});

describe("EventPost rating", () => {
  const END = Date.parse("2030-01-15T14:00:00.000Z");
  afterEach(() => vi.useRealTimers());

  function renderRating(search: string, onUrlUpdate = vi.fn()) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(END + 86_400_000);
    feedback.form.mockReset();
    feedback.form.mockResolvedValue({
      success: true,
      data: {
        state: "open",
        closesAt: "2030-01-22T14:00:00.000Z",
        host: {
          name: "Minh Host",
          avatarUrl: null,
          avatarKey: null,
          code: null,
        },
        hostAnswer: null,
        peers: [],
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate}>
          <NextIntlClientProvider locale="vi" messages={viMessages}>
            <EventPost
              event={makeEvent({ status: "done" })}
              viewer={makeViewer({
                role: "member",
                myRegistration: makeReg({ checkedIn: true }),
              })}
              memberGender={null}
            />
          </NextIntlClientProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    );
    return onUrlUpdate;
  }

  it("?feedback=1 opens the sheet", async () => {
    const onUrlUpdate = renderRating("?feedback=1");
    expect(
      await screen.findByText("Trả lời 2 câu về host để gửi"),
    ).toBeTruthy();
    expect(feedback.form).toHaveBeenCalledWith("ABCD1234");
    // Đóng sheet thì bỏ tham số, thay URL chứ không thêm lịch sử.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const last = onUrlUpdate.mock.calls.at(-1)![0] as UrlUpdateEvent;
    expect(last.searchParams.get("feedback")).toBeNull();
    expect(last.options.history).toBe("replace");
  });

  it("the rate button opens the sheet and sets feedback=1", async () => {
    const onUrlUpdate = renderRating("");
    expect(feedback.form).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Đánh giá buổi này" }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const last = onUrlUpdate.mock.calls.at(-1)![0] as UrlUpdateEvent;
    expect(last.queryString).toBe("?feedback=1");
    expect(
      await screen.findByText("Trả lời 2 câu về host để gửi"),
    ).toBeTruthy();
  });
});
