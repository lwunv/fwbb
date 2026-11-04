import { and, asc, eq, inArray } from "drizzle-orm";
import { financialTransactions, notifications, sessions } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { isNotificationsEnabled, notify } from "./notify";
import { memberName, superadminRecipients } from "./recipients";

/**
 * Tin tiền (spec 4.5). Mọi hàm ở đây chạy TRONG transaction ghi sổ của action
 * gọi nó, ngay sau lệnh ghi sổ, nên lỗi ghi tin làm rollback cả khoản tiền
 * (spec 4.9). Số tiền lấy từ giá trị action vừa ghi, không tính lại.
 */

const DEFAULT_START_TIME = "20:30";

/** Công tắc: `gate` do action đọc sẵn; không truyền thì tự đọc 1 lần. */
async function enabled(db: DbOrTx, gate?: boolean): Promise<boolean> {
  if (gate !== undefined) return gate;
  return isNotificationsEnabled(db);
}

/** Số dư quỹ của member đọc trong tx (cùng công thức với getFundBalance). */
export async function memberBalanceInTx(
  tx: DbOrTx,
  memberId: number,
): Promise<number> {
  const rows = await tx.query.financialTransactions.findMany({
    where: eq(financialTransactions.memberId, memberId),
  });
  return computeBalanceFromTransactions(memberId, rows).balance;
}

async function sessionWhen(tx: DbOrTx, sessionId: number) {
  const [row] = await tx
    .select({ date: sessions.date, startTime: sessions.startTime })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row) return undefined;
  return {
    sessionDate: row.date,
    startTime: row.startTime ?? DEFAULT_START_TIME,
  };
}

export type FinalizedDebt = {
  memberId: number;
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  guestDineAmount: number;
  totalAmount: number;
};

const FINALIZE_KINDS = ["session_finalized", "session_amount_changed"];

/**
 * Tin chốt sổ cho từng member trong `debts` (đúng danh sách vừa insert vào
 * `session_debts`). Lần đầu: `session_finalized`. Chốt lại mà tổng đổi:
 * `session_amount_changed` kèm tổng cũ; tổng không đổi thì không gửi. Người đã
 * nhận tin trước đó nhưng không còn trong `debts` nhận tin tổng mới bằng 0.
 */
export async function notifyFinalized(
  tx: DbOrTx,
  sessionId: number,
  debts: FinalizedDebt[],
  adminMemberId: number | null,
  gate?: boolean,
): Promise<void> {
  if (!(await enabled(tx, gate))) return;
  const when = await sessionWhen(tx, sessionId);
  if (!when) return;

  const prior = await tx
    .select({
      recipientId: notifications.recipientId,
      payload: notifications.payload,
      dedupKey: notifications.dedupKey,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.entityType, "session"),
        eq(notifications.entityId, sessionId),
        eq(notifications.recipientType, "member"),
        inArray(notifications.kind, FINALIZE_KINDS),
      ),
    )
    .orderBy(asc(notifications.id));
  // `next` = chỉ số n lớn nhất đã có trong khoá `fin:s{sid}:n{n}` + 1, KHÔNG
  // phải số tin còn lại: dọn tin cũ làm số tin giảm, đếm lại sẽ trùng khoá của
  // một tin còn sống và onConflictDoNothing nuốt mất tin mới.
  const keyIndex = new RegExp(`^fin:s${sessionId}:n([0-9]+):`);
  const history = new Map<number, { next: number; lastTotal: number }>();
  for (const row of prior) {
    const h = history.get(row.recipientId) ?? { next: 0, lastTotal: 0 };
    const n = keyIndex.exec(row.dedupKey)?.[1];
    if (n !== undefined) h.next = Math.max(h.next, Number(n) + 1);
    h.lastTotal = Number(row.payload?.total ?? 0);
    history.set(row.recipientId, h);
  }

  const entity = { type: "session" as const, id: sessionId };
  const dedupBase = (memberId: number) =>
    `fin:s${sessionId}:n${history.get(memberId)?.next ?? 0}`;

  for (const debt of debts) {
    const isAdminDebt = debt.memberId === adminMemberId;
    // Khớp finalizeSession: admin chỉ bị trừ phần chơi + ăn của chính mình;
    // tiền khách của admin vào quỹ chung (session_guest_income).
    const amounts = isAdminDebt
      ? {
          playAmount: debt.playAmount,
          dineAmount: debt.dineAmount,
          guestPlayAmount: 0,
          guestDineAmount: 0,
          guestToFund: debt.guestPlayAmount + debt.guestDineAmount,
          total: debt.playAmount + debt.dineAmount,
        }
      : {
          playAmount: debt.playAmount,
          dineAmount: debt.dineAmount,
          guestPlayAmount: debt.guestPlayAmount,
          guestDineAmount: debt.guestDineAmount,
          guestToFund: 0,
          total: debt.totalAmount,
        };
    const h = history.get(debt.memberId);
    if (h && h.lastTotal === amounts.total) continue;
    const balance = await memberBalanceInTx(tx, debt.memberId);
    const recipients = [{ type: "member" as const, id: debt.memberId }];
    if (!h) {
      await notify(tx, {
        gate: true,
        kind: "session_finalized",
        recipients,
        payload: { ...when, ...amounts, balance },
        dedupBase: dedupBase(debt.memberId),
        entity,
      });
    } else {
      await notify(tx, {
        gate: true,
        kind: "session_amount_changed",
        recipients,
        payload: { ...when, ...amounts, balance, oldTotal: h.lastTotal },
        dedupBase: dedupBase(debt.memberId),
        entity,
      });
    }
  }

  const still = new Set(debts.map((d) => d.memberId));
  for (const [memberId, h] of history) {
    if (still.has(memberId) || h.lastTotal === 0) continue;
    await notify(tx, {
      gate: true,
      kind: "session_amount_changed",
      recipients: [{ type: "member", id: memberId }],
      payload: {
        ...when,
        playAmount: 0,
        dineAmount: 0,
        guestPlayAmount: 0,
        guestDineAmount: 0,
        guestToFund: 0,
        total: 0,
        balance: await memberBalanceInTx(tx, memberId),
        oldTotal: h.lastTotal,
      },
      dedupBase: dedupBase(memberId),
      entity,
    });
  }
}

/**
 * Xoá buổi: `deltas` = thay đổi số dư của từng member do các dòng đảo vừa ghi
 * trong chính tx này (đảo khoản trừ quỹ: dương, đảo tiền pass: âm).
 */
export async function notifySessionDeletedRefund(
  tx: DbOrTx,
  session: { id: number; date: string; startTime: string | null },
  deltas: Map<number, number>,
  gate?: boolean,
): Promise<void> {
  const changed = [...deltas].filter(([, delta]) => delta !== 0);
  if (changed.length === 0) return;
  if (!(await enabled(tx, gate))) return;
  for (const [memberId, delta] of changed) {
    await notify(tx, {
      gate: true,
      kind: "session_deleted_refund",
      recipients: [{ type: "member", id: memberId }],
      payload: {
        sessionDate: session.date,
        startTime: session.startTime ?? DEFAULT_START_TIME,
        amount: delta,
        balance: await memberBalanceInTx(tx, memberId),
      },
      dedupBase: `sdel:s${session.id}`,
      entity: { type: "session", id: session.id },
    });
  }
}

/** Hoàn tác thanh toán; số dư trong tx là số cuối (action không autoApply sau). */
export async function notifyPaymentUndone(
  tx: DbOrTx,
  input: {
    memberId: number;
    debtId: number;
    sessionId: number;
    amount: number;
    lastReversedId: number;
  },
): Promise<void> {
  if (!(await isNotificationsEnabled(tx))) return;
  await notify(tx, {
    gate: true,
    kind: "payment_undone",
    recipients: [{ type: "member", id: input.memberId }],
    payload: {
      amount: input.amount,
      // undoPaymentByAdmin chưa nhận lý do; render hiện "không ghi lý do".
      reason: "",
      balance: await memberBalanceInTx(tx, input.memberId),
    },
    dedupBase: `payundo:d${input.debtId}:${input.lastReversedId}`,
    entity: { type: "session", id: input.sessionId },
  });
}

/** Tin cho admin: member tự báo đã chuyển tiền (trả nợ hoặc nạp quỹ). */
export async function notifyMemberReportedTransfer(
  tx: DbOrTx,
  input: {
    memberId: number;
    amount: number;
    purpose: "debt" | "fund";
    sessionDate?: string;
    dedupBase: string;
    entity?: { type: "session" | "member"; id: number };
  },
): Promise<void> {
  if (!(await isNotificationsEnabled(tx))) return;
  await notify(tx, {
    gate: true,
    kind: "member_reported_transfer",
    recipients: await superadminRecipients(tx),
    payload: {
      memberName: await memberName(tx, input.memberId),
      amount: input.amount,
      purpose: input.purpose,
      ...(input.sessionDate ? { sessionDate: input.sessionDate } : {}),
    },
    dedupBase: input.dedupBase,
    entity: input.entity ?? { type: "member", id: input.memberId },
  });
}
