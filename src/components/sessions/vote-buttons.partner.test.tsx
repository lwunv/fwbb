// @vitest-environment jsdom
/**
 * "Cho đi 2 mình" là quyền admin cấp (yêu cầu user 6/11/2026): member chưa
 * được cho thì không thấy switch 👫, trừ khi phiếu đang đi 2 mình sẵn (admin
 * bật hộ) để member vẫn tắt được. Render với vi.json thật.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "@/i18n/messages/vi.json";

vi.mock("@/actions/votes", () => ({ submitVote: vi.fn() }));
vi.mock("@/lib/optimistic-action", () => ({ fireAction: vi.fn() }));

const { VoteButtons } = await import("./vote-buttons");

function renderButtons(props: {
  partnerAllowed: boolean;
  currentWithPartner: boolean;
}) {
  render(
    <NextIntlClientProvider locale="vi" messages={viMessages}>
      <VoteButtons
        sessionId={1}
        currentWillPlay
        currentWillDine={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const partnerSwitch = () =>
  screen.queryByRole("switch", { name: viMessages.voting.withPartner });

describe("VoteButtons — switch đi 2 mình", () => {
  afterEach(cleanup);

  it("member chưa được cho đi 2 mình → không có switch 👫", () => {
    renderButtons({ partnerAllowed: false, currentWithPartner: false });
    expect(partnerSwitch()).toBeNull();
  });

  it("member được cho đi 2 mình → có switch 👫", () => {
    renderButtons({ partnerAllowed: true, currentWithPartner: false });
    expect(partnerSwitch()).not.toBeNull();
  });

  it("chưa được cho nhưng phiếu đang đi 2 mình (admin bật hộ) → vẫn có switch để tắt", () => {
    renderButtons({ partnerAllowed: false, currentWithPartner: true });
    expect(partnerSwitch()).not.toBeNull();
  });
});
