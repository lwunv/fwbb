import "server-only";
import type { Tx } from "@/db/tx";
import { depositSettlement } from "@/lib/exchange-fee";
import { notify } from "./notify";
import { superadminRecipients, type Recipient } from "./recipients";

/*
 * Tin của luồng giao lưu (G2b). Mọi hàm nhận `tx` của giao dịch nghiệp vụ và
 * `gate` (cờ thông báo mà action đã đọc 1 lần); hàm KHÔNG tự đọc cờ. `gate`
 * false thì không ghi gì, không chạm DB.
 *
 * Riêng tư: tin cho host chỉ có số người, tin cho người đăng ký chỉ có khoản
 * của chính họ. Không đưa tên hay tiền của người khác vào payload.
 *
 * Khoá chống trùng theo bảng "Quy ước dùng chung" của plan G2b; `token` là ISO
 * thời điểm hành động.
 */

type EventRef = {
  id: number;
  publicCode: string;
  title: string;
};

const entity = (event: EventRef) => ({
  type: "exchange_event" as const,
  id: event.id,
});

const base = (event: EventRef) => ({
  eventCode: event.publicCode,
  eventTitle: event.title,
});

const member = (id: number): Recipient => ({ type: "member", id });

/** Host nhận tin có người đăng ký mới. */
export async function notifyRegistrationReceived(
  tx: Tx,
  input: {
    event: EventRef & { hostMemberId: number };
    reg: { id: number; maleCount: number; femaleCount: number };
    needsApproval: boolean;
    now: Date;
  },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  await notify(tx, {
    kind: "exchange_registration_received",
    recipients: [member(input.event.hostMemberId)],
    payload: {
      ...base(input.event),
      heads: input.reg.maleCount + input.reg.femaleCount,
      needsApproval: input.needsApproval,
    },
    dedupBase: `xreg:r${input.reg.id}:new:${input.now.toISOString()}`,
    entity: entity(input.event),
    now: input.now,
    gate,
  });
}

/**
 * Người đăng ký nhận kết quả: duyệt, từ chối, hoặc được đẩy từ danh sách chờ.
 * `refundDue` chỉ dùng cho từ chối; `status` chỉ dùng cho đẩy từ danh sách chờ
 * (đăng ký mới vào có thể vẫn chờ duyệt).
 */
export async function notifyRegistrationDecision(
  tx: Tx,
  input: {
    event: EventRef & { startAt: string };
    reg: { id: number; memberId: number };
    decision: "approved" | "rejected" | "promoted";
    refundDue?: number;
    status?: "pending" | "approved";
    now: Date;
  },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  const { event, reg, decision, now } = input;
  const common = {
    recipients: [member(reg.memberId)],
    dedupBase: `xreg:r${reg.id}:${decision}:${now.toISOString()}`,
    entity: entity(event),
    now,
    gate,
  };
  if (decision === "approved") {
    await notify(tx, {
      ...common,
      kind: "exchange_registration_approved",
      payload: { ...base(event), startAt: event.startAt },
    });
  } else if (decision === "rejected") {
    await notify(tx, {
      ...common,
      kind: "exchange_registration_rejected",
      payload: {
        ...base(event),
        startAt: event.startAt,
        refundDue: input.refundDue ?? 0,
      },
    });
  } else {
    await notify(tx, {
      ...common,
      kind: "exchange_waitlist_promoted",
      payload: {
        ...base(event),
        startAt: event.startAt,
        status: input.status ?? "approved",
      },
    });
  }
}

/**
 * Host nhận tin có người hủy. Buổi đã chốt phí (`afterLock`) dùng kind bắt
 * buộc vì host phải xem lại số tiền; chưa chốt thì tin thường, tắt được.
 */
export async function notifyRegistrationCancelled(
  tx: Tx,
  input: {
    event: EventRef & { hostMemberId: number };
    reg: { id: number; maleCount: number; femaleCount: number };
    late: boolean;
    afterLock: boolean;
    now: Date;
  },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  await notify(tx, {
    kind: input.afterLock
      ? "exchange_cancelled_after_lock"
      : "exchange_registration_cancelled",
    recipients: [member(input.event.hostMemberId)],
    payload: {
      ...base(input.event),
      heads: input.reg.maleCount + input.reg.femaleCount,
      late: input.late,
    },
    dedupBase: `xcancel:r${input.reg.id}:${input.now.toISOString()}`,
    entity: entity(input.event),
    now: input.now,
    gate,
  });
}

/**
 * Báo phí sau khi host chốt. `event.lockCount` là số lần chốt SAU lần này.
 * Lần đầu (1): mọi người bị tính phí nhận `exchange_fee_locked`. Chốt lại: chỉ
 * người đổi số tiền nhận `exchange_fee_changed` (`amount: 0` nếu không còn bị
 * tính). Cọc của từng người = `depositAmount` nếu `reg.depositPaid`, còn lại 0;
 * `remaining`/`refundDue` suy ra từ đó. `aboveEstimate` do caller tính theo cả buổi.
 */
export async function notifyFeesLocked(
  tx: Tx,
  input: {
    event: EventRef & {
      startAt: string;
      lockCount: number;
      depositAmount: number;
    };
    changes: {
      reg: { id: number; memberId: number; depositPaid: boolean };
      amount: number;
      previousAmount: number | null;
    }[];
    aboveEstimate?: boolean;
    now: Date;
  },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  const { event, now } = input;
  const first = event.lockCount <= 1;
  const dedupBase = `xfee:e${event.id}:n${event.lockCount}`;
  for (const c of input.changes) {
    if (!first && c.previousAmount === c.amount) continue;
    const deposit = c.reg.depositPaid ? event.depositAmount : 0;
    // Công thức đối trừ cọc chỉ có một nơi (exchange-fee.ts).
    const { remaining, refundDue } = depositSettlement(
      { depositPaid: c.reg.depositPaid, feeAmount: c.amount },
      event.depositAmount,
    );
    const fee = {
      ...base(event),
      startAt: event.startAt,
      amount: c.amount,
      deposit,
      remaining,
      refundDue,
      aboveEstimate: input.aboveEstimate ?? false,
    };
    const common = {
      recipients: [member(c.reg.memberId)],
      dedupBase,
      entity: entity(event),
      now,
      gate,
    };
    if (first) {
      await notify(tx, {
        ...common,
        kind: "exchange_fee_locked",
        payload: fee,
      });
    } else {
      await notify(tx, {
        ...common,
        kind: "exchange_fee_changed",
        payload: { ...fee, previousAmount: c.previousAmount ?? 0 },
      });
    }
  }
}

const NOTIFIED_ON_CANCEL = new Set(["pending", "approved", "waitlist"]);

/** Buổi bị hủy: mọi đăng ký còn hiệu lực nhận tin kèm số cọc được hoàn của riêng họ. */
export async function notifyEventCancelled(
  tx: Tx,
  input: {
    event: EventRef & { startAt: string };
    regs: { id: number; memberId: number; status: string; refundDue: number }[];
    now: Date;
  },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  const { event, now } = input;
  for (const reg of input.regs) {
    if (!NOTIFIED_ON_CANCEL.has(reg.status)) continue;
    await notify(tx, {
      kind: "exchange_event_cancelled",
      recipients: [member(reg.memberId)],
      payload: {
        ...base(event),
        startAt: event.startAt,
        refundDue: reg.refundDue,
      },
      dedupBase: `xevcancel:e${event.id}`,
      entity: entity(event),
      now,
      gate,
    });
  }
}

/** Admin ẩn buổi: báo host. */
export async function notifyEventHidden(
  tx: Tx,
  input: { event: EventRef & { hostMemberId: number }; now: Date },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  await notify(tx, {
    kind: "exchange_event_hidden",
    recipients: [member(input.event.hostMemberId)],
    payload: base(input.event),
    dedupBase: `xhide:e${input.event.id}:${input.now.toISOString()}`,
    entity: entity(input.event),
    now: input.now,
    gate,
  });
}

/** Có báo cáo mới: báo superadmin. Payload chỉ có loại đối tượng và lý do. */
export async function notifyReported(
  tx: Tx,
  input: { reportId: number; targetType: string; reason: string },
  gate: boolean,
): Promise<void> {
  if (!gate) return;
  await notify(tx, {
    kind: "exchange_reported",
    recipients: await superadminRecipients(tx),
    payload: { targetType: input.targetType, reason: input.reason },
    dedupBase: `xreport:${input.reportId}`,
    gate,
  });
}
