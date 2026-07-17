"use server";

import { db } from "@/db";
import { financialTransactions, sessionDebts, votes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import { ymdInVN } from "@/lib/date-format";
import {
  attributePaidFifo,
  type PaidStatus,
} from "@/lib/fifo-paid-attribution";

export type MemberPlayHistoryEntry = {
  sessionId: number;
  date: string;
  startTime: string;
  endTime: string;
  courtName: string | null;
  totalAmount: number;
  playAmount: number;
  dineAmount: number;
  paidStatus: PaidStatus;
  /** true = buổi CHƯA chốt sổ (voting/confirmed): đã ghi nhận đi chơi qua vote
   *  nhưng chưa có tiền/nợ. UI hiện badge "Chưa chốt", ẩn phần tiền. */
  pending: boolean;
};

export type MemberPlayHistoryResult =
  | { balance: number; entries: MemberPlayHistoryEntry[] }
  | { error: string };

/**
 * Lịch sử chơi của 1 member cho admin: các buổi ĐÃ CHỐT SỔ member này bị tính
 * tiền, kèm trạng thái đã trả per-buổi theo FIFO (spec 2026-07-02). Read-only.
 */
export async function getMemberPlayHistory(
  memberId: number,
): Promise<MemberPlayHistoryResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  const parsed = z.number().int().positive().safeParse(memberId);
  if (!parsed.success) return { error: "Invalid memberId" };

  const [debtRows, txs, voteRows] = await Promise.all([
    db.query.sessionDebts.findMany({
      where: eq(sessionDebts.memberId, parsed.data),
      with: { session: { with: { court: true } } },
    }),
    db.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, parsed.data),
      columns: { id: true, type: true, amount: true, reversalOfId: true },
    }),
    // Buổi member đã vote CHƠI (willPlay) — dùng cho các buổi CHƯA chốt sổ.
    db.query.votes.findMany({
      where: and(eq(votes.memberId, parsed.data), eq(votes.willPlay, true)),
      with: { session: { with: { court: true } } },
    }),
  ]);

  const { balance } = computeBalanceFromTransactions(parsed.data, txs);

  const completed = debtRows.filter((d) => d.session?.status === "completed");
  const statusBySession = attributePaidFifo(
    completed.map((d) => ({
      sessionId: d.sessionId,
      date: d.session.date,
      totalAmount: d.totalAmount,
    })),
    balance,
  );

  const completedEntries: MemberPlayHistoryEntry[] = completed.map((d) => ({
    sessionId: d.sessionId,
    date: d.session.date,
    startTime: d.session.startTime || "20:30",
    endTime: d.session.endTime || "22:30",
    courtName: d.session.court?.name ?? null,
    totalAmount: d.totalAmount,
    playAmount: (d.playAmount ?? 0) + (d.guestPlayAmount ?? 0),
    dineAmount: (d.dineAmount ?? 0) + (d.guestDineAmount ?? 0),
    paidStatus: statusBySession[d.sessionId],
    pending: false,
  }));

  // Buổi ĐÃ DIỄN RA (date <= hôm nay VN), CHƯA completed và không huỷ = chưa
  // chốt sổ → chưa có tiền/nợ, chỉ ghi nhận member đã đi (theo vote willPlay).
  const today = ymdInVN();
  const pendingEntries: MemberPlayHistoryEntry[] = voteRows.flatMap((v) => {
    const s = v.session;
    if (
      !s ||
      s.status === "completed" ||
      s.status === "cancelled" ||
      s.date > today
    ) {
      return [];
    }
    return [
      {
        sessionId: v.sessionId,
        date: s.date,
        startTime: s.startTime || "20:30",
        endTime: s.endTime || "22:30",
        courtName: s.court?.name ?? null,
        totalAmount: 0,
        playAmount: 0,
        dineAmount: 0,
        paidStatus: "unpaid" as PaidStatus,
        pending: true,
      },
    ];
  });

  const entries: MemberPlayHistoryEntry[] = [
    ...completedEntries,
    ...pendingEntries,
  ].sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);

  return { balance, entries };
}
