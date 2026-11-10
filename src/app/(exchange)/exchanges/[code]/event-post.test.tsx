// @vitest-environment jsdom
/**
 * Trang buổi giao lưu dạng bài (g2b, Task 16). Các điều dễ hỏng im lặng:
 * 1. Khách không thấy liên hệ, link nhóm, tên người tham gia hay tài khoản nhận tiền.
 * 2. Số tiền chỉ hiện, không tính lại ở client: `remaining` và `refundDue` đến từ server.
 * 3. Phí đã chốt cao hơn số đã hiện thì nói đúng một câu, không nêu lý do.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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
