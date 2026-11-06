// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  NuqsTestingAdapter,
  type OnUrlUpdateFunction,
} from "nuqs/adapters/testing";
import viMessages from "@/i18n/messages/vi.json";

type Result = { success: true } | { error: string };

const h = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));
vi.mock("@/actions/notifications", () => ({
  getMyNotificationPrefs: h.get,
  updateMyNotificationPrefs: h.update,
  requestNotifyEmailVerification: h.verify,
}));

const { NotificationPrefsSection } =
  await import("./notification-prefs-section");

const prefs = (mutedGroups: string[]) => ({
  mutedGroups,
  emailEnabled: true,
  email: null,
  emailVerified: false,
});

/** Mỗi lần gọi update trả một promise do test tự quyết khi nào xong. */
function deferredUpdates() {
  const calls: { groups: string[]; resolve: (r: Result) => void }[] = [];
  h.update.mockImplementation(
    (_scope: string, patch: { mutedGroups: string[] }) =>
      new Promise<Result>((resolve) => {
        calls.push({ groups: [...patch.mutedGroups], resolve });
      }),
  );
  return calls;
}

function setup(
  url: { searchParams?: string; onUrlUpdate?: OnUrlUpdateFunction } = {},
  exchangeEnabled?: boolean,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <NuqsTestingAdapter {...url}>
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="vi" messages={viMessages}>
          <NotificationPrefsSection
            scope="member"
            exchangeEnabled={exchangeEnabled}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
  return qc;
}

const groups = viMessages.notifications.groups;
const switchOf = (label: string) => screen.getByRole("switch", { name: label });
const muted = (qc: QueryClient) =>
  (
    qc.getQueryData(["notification-prefs", "member"]) as {
      mutedGroups: string[];
    }
  ).mutedGroups;

beforeEach(() => {
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
  h.verify.mockReset();
  h.get.mockReset().mockResolvedValue(prefs([]));
  h.update.mockReset();
});
afterEach(() => cleanup());

async function openCard() {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(viMessages.notifications.prefs.title),
    }),
  );
  await screen.findByRole("switch", { name: groups.session });
}

describe("NotificationPrefsSection", () => {
  it("overlapping toggles: the retry sends the latest list and a failure reverts only its own group", async () => {
    const calls = deferredUpdates();
    const qc = setup();
    await openCard();

    fireEvent.click(switchOf(groups.session)); // tắt "Buổi chơi"
    fireEvent.click(switchOf(groups.venue)); // tắt "Sân mình đề xuất"
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].groups).toEqual(["session"]);
    expect(calls[1].groups.sort()).toEqual(["session", "venue"]);

    // Lần gửi đầu lỗi: fireAction thử lại, và lần thử lại phải gửi danh sách
    // MỚI NHẤT, không gửi lại ["session"] cũ (sẽ bật lại nhóm "venue").
    calls[0].resolve({ error: "boom" });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].groups.sort()).toEqual(["session", "venue"]);

    // Thử lại vẫn lỗi: chỉ trả lại nhóm "session", giữ "venue" đang tắt.
    calls[2].resolve({ error: "boom" });
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("boom"));
    expect(muted(qc)).toEqual(["venue"]);
    expect(h.get).toHaveBeenCalledTimes(1);

    // Lần gửi còn lại xong thì đọc lại server để hội tụ.
    h.get.mockResolvedValue(prefs(["venue"]));
    calls[1].resolve({ success: true });
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(muted(qc)).toEqual(["venue"]));
  });

  it("a single successful toggle re-reads the server preferences", async () => {
    h.update.mockResolvedValue({ success: true });
    const qc = setup();
    await openCard();

    h.get.mockResolvedValue(prefs(["session"]));
    fireEvent.click(switchOf(groups.session));
    expect(muted(qc)).toEqual(["session"]);
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    expect(h.update).toHaveBeenCalledWith("member", {
      mutedGroups: ["session"],
    });
  });

  it("load error shows a retry button that refetches", async () => {
    h.get.mockRejectedValueOnce(new Error("down"));
    setup();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(viMessages.notifications.prefs.title),
      }),
    );
    const retry = await screen.findByRole("button", {
      name: viMessages.notifications.retry,
    });
    fireEvent.click(retry);
    await screen.findByRole("switch", { name: groups.session });
    expect(h.get).toHaveBeenCalledTimes(2);
  });
  it("?email=verified from the mail link opens the card, toasts once and clears the param through the URL state", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    setup({ searchParams: "?email=verified&tab=x", onUrlUpdate });
    // Thẻ tự mở: thấy công tắc mà không cần bấm tiêu đề.
    await screen.findByRole("switch", { name: groups.session });
    expect(h.toastSuccess).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith(
      viMessages.notifications.prefs.emailVerifiedToast,
    );
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const last = onUrlUpdate.mock.calls.at(-1)![0];
    expect(last.searchParams.get("email")).toBeNull();
    expect(last.searchParams.get("tab")).toBe("x");
  });

  it("?email=invalid shows the error toast; other values are ignored", async () => {
    setup({ searchParams: "?email=invalid" });
    await screen.findByRole("switch", { name: groups.session });
    expect(h.toastError).toHaveBeenCalledWith(
      viMessages.notifications.prefs.emailInvalidToast,
    );
    cleanup();
    h.toastError.mockReset();
    setup({ searchParams: "?email=weird" });
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("the send-verification button shows a spinner and is locked while sending", async () => {
    h.get.mockResolvedValue({
      ...prefs([]),
      email: "me@example.com",
      emailVerified: false,
    });
    let finish!: (r: Result) => void;
    h.verify.mockImplementation(
      () => new Promise<Result>((resolve) => (finish = resolve)),
    );
    setup();
    await openCard();
    const send = screen.getByRole("button", {
      name: viMessages.notifications.prefs.emailSend,
    });
    fireEvent.click(send);
    const busy = await screen.findByRole("button", {
      name: viMessages.notifications.prefs.emailSending,
    });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector("svg.animate-spin")).not.toBeNull();
    finish({ success: true });
    await screen.findByRole("button", {
      name: viMessages.notifications.prefs.emailSend,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(
      viMessages.notifications.prefs.emailSent,
    );
  });
});

describe("NotificationPrefsSection exchange group", () => {
  const labels = () =>
    screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"));

  it("prefs section hides exchange unless exchangeEnabled", async () => {
    setup();
    await openCard();
    expect(labels()).not.toContain(groups.exchange);
    cleanup();

    setup({}, false);
    await openCard();
    expect(labels()).not.toContain(groups.exchange);
    cleanup();

    setup({}, true);
    await openCard();
    expect(labels()).toEqual([
      groups.session,
      groups.money,
      groups.account,
      groups.venue,
      groups.exchange,
      groups.exchange_comments,
    ]);
  });

  it("prefs: exchange_comments shows only when exchangeEnabled", async () => {
    setup({}, false);
    await openCard();
    expect(labels()).not.toContain(groups.exchange_comments);
    cleanup();

    setup({}, true);
    await openCard();
    expect(labels()).toContain(groups.exchange_comments);
  });
});
