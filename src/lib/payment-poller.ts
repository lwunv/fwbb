"use client";

/**
 * Singleton payment poller — gộp tất cả PaymentQR đang sống trên 1 page
 * thành duy nhất 1 vòng lặp `setTimeout` (4s cycle).
 *
 * Lý do: trước đây mỗi `<PaymentQR memo="...">` chạy effect riêng → list 5
 * DebtCard = 5 polls/4s = 75 req/phút trên cùng 1 user mở 1 màn hình. Giờ
 * chỉ còn 1 batch poll, mỗi memo được kiểm tra tuần tự. Số request thực
 * = (memos đang sống) × 1 mỗi 4s, không phải N × 1.
 *
 * Subscriber API:
 *   const unsub = subscribePayment(memo, (status) => { ... });
 *   // unsub() khi component unmount.
 *
 * HMR safety: state pinned to `globalThis` so that Next.js dev fast-refresh
 * (which re-imports the module) keeps the same `subscribers`/`timer` and
 * doesn't orphan listeners that were registered against a previous instance.
 */

import {
  checkPaymentForMemo,
  type PaymentStatusResult,
} from "@/actions/payment-status";

type Listener = (status: PaymentStatusResult) => void;

interface PollerState {
  subscribers: Map<string, Set<Listener>>;
  timer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
}

const STATE_KEY = "__fwbbPaymentPollerState__";
type GlobalWithState = typeof globalThis & { [STATE_KEY]?: PollerState };
function getState(): PollerState {
  const g = globalThis as GlobalWithState;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { subscribers: new Map(), timer: null, stopping: false };
  }
  return g[STATE_KEY];
}

const POLL_INTERVAL_MS = 4_000;

async function tick() {
  const state = getState();
  if (state.stopping) return;
  // Snapshot the keys so we don't iterate while subscribers can mutate.
  const memos = [...state.subscribers.keys()];

  for (const memo of memos) {
    const listeners = state.subscribers.get(memo);
    if (!listeners || listeners.size === 0) continue;
    try {
      const status = await checkPaymentForMemo(memo);
      // The set may have been emptied while we awaited; re-check.
      const stillListening = state.subscribers.get(memo);
      if (!stillListening) continue;
      // Fire all listeners FIRST so every subscriber to this memo is
      // notified — only AFTER do we drop the memo entry. Multi-card mounts
      // (2 DebtCards sharing a memo) all see the success state in the same
      // tick. See payment-poller.test.ts "ALL subscribers on the same memo"
      // for the regression guard.
      for (const fn of stillListening) fn(status);
      if (status.received) {
        state.subscribers.delete(memo);
      }
    } catch {
      // Silently retry on next tick — server actions can blip in serverless.
    }
  }

  if (state.subscribers.size === 0) {
    // No one to poll for; pause until the next subscribe.
    state.timer = null;
    return;
  }
  state.timer = setTimeout(tick, POLL_INTERVAL_MS);
}

function ensureLoop() {
  const state = getState();
  if (state.timer || state.stopping) return;
  state.timer = setTimeout(tick, POLL_INTERVAL_MS);
}

export function subscribePayment(memo: string, listener: Listener): () => void {
  if (!memo) return () => {};
  const state = getState();
  let set = state.subscribers.get(memo);
  if (!set) {
    set = new Set();
    state.subscribers.set(memo, set);
  }
  set.add(listener);
  ensureLoop();

  return () => {
    const s = getState().subscribers.get(memo);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) getState().subscribers.delete(memo);
  };
}

/** Test helper — clear state so unit tests don't bleed. */
export function _resetPaymentPollerForTesting() {
  const state = getState();
  state.stopping = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.subscribers.clear();
  state.stopping = false;
}
