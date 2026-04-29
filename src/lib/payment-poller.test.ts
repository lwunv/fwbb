/**
 * Payment poller singleton tests.
 *
 * Trước fix: mỗi `<PaymentQR>` chạy effect polling 4s riêng → list 5 debt
 * card = 5 polls/4s. Sau fix: 1 vòng lặp duy nhất per process; mỗi memo
 * được kiểm 1 request/4s bất kể có bao nhiêu subscriber.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock the server action so we can count calls and stub return values.
const checkMock = vi.fn<
  (
    memo: string,
    sinceMinutes?: number,
  ) => Promise<{
    received: boolean;
    matched: boolean;
    amount?: number;
    transferContent?: string;
  }>
>();
vi.mock("@/actions/payment-status", () => ({
  checkPaymentForMemo: checkMock,
}));

const { subscribePayment, _resetPaymentPollerForTesting } =
  await import("./payment-poller");

describe("payment-poller singleton", () => {
  beforeEach(() => {
    _resetPaymentPollerForTesting();
    checkMock.mockReset();
    checkMock.mockResolvedValue({ received: false, matched: false });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetPaymentPollerForTesting();
  });

  it("does not poll until at least one subscriber exists", async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("polls a single memo every 4s once subscribed", async () => {
    const fn = vi.fn();
    subscribePayment("FWBB QUY 1", fn);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it("multiple subscribers on the SAME memo share a single poll request", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    subscribePayment("FWBB QUY 1", a);
    subscribePayment("FWBB QUY 1", b);
    subscribePayment("FWBB QUY 1", c);

    await vi.advanceTimersByTimeAsync(4_000);

    // Only ONE backend call, but ALL THREE listeners get notified.
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("different memos still each get their own poll", async () => {
    subscribePayment("FWBB QUY 1", vi.fn());
    subscribePayment("FWBB QUY 2", vi.fn());

    await vi.advanceTimersByTimeAsync(4_000);
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(checkMock).toHaveBeenCalledWith("FWBB QUY 1");
    expect(checkMock).toHaveBeenCalledWith("FWBB QUY 2");
  });

  it("unsubscribe stops the loop when no subscribers remain", async () => {
    const fn = vi.fn();
    const unsub = subscribePayment("FWBB QUY 1", fn);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(checkMock).toHaveBeenCalledTimes(1);

    unsub();

    await vi.advanceTimersByTimeAsync(20_000);
    // No more polls — listener gone.
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling that memo once payment is received", async () => {
    const fn = vi.fn();
    subscribePayment("FWBB QUY 1", fn);

    checkMock.mockResolvedValueOnce({
      received: true,
      matched: true,
      amount: 200_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fn).toHaveBeenCalledTimes(1);

    // Subsequent ticks must NOT call checkPaymentForMemo for this memo.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it("ALL subscribers on the same memo are notified when payment is received", async () => {
    // Reviewer concern: when status.received=true, the singleton drops the
    // memo from the map. Verify that ALL listeners still get fired BEFORE
    // the drop, so multi-card mounts (e.g., 2 DebtCard sharing memo) both
    // see the success state and never end up stuck on "Đang chờ…".
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    subscribePayment("FWBB QUY 1", a);
    subscribePayment("FWBB QUY 1", b);
    subscribePayment("FWBB QUY 1", c);

    checkMock.mockResolvedValueOnce({
      received: true,
      matched: true,
      amount: 100_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);

    // Each listener should have been called EXACTLY once with the success.
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0][0].received).toBe(true);
  });

  it("re-subscribing to a memo whose payment was already received re-polls and notifies", async () => {
    // After received=true the memo is dropped from the map. A new component
    // mounting later (re-render with same memo) must still get the
    // already-received status — checkPaymentForMemo will return it again
    // because the underlying notification row stays in DB.
    const a = vi.fn();
    subscribePayment("FWBB QUY 9", a);
    checkMock.mockResolvedValueOnce({ received: true, matched: true });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(a).toHaveBeenCalledTimes(1);

    // Now a different component subscribes — the loop should restart and
    // fire its listener with the same received=true status.
    const b = vi.fn();
    checkMock.mockResolvedValueOnce({ received: true, matched: true });
    subscribePayment("FWBB QUY 9", b);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
