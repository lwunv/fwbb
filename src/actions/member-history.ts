"use server";

import { db } from "@/db";
import { financialTransactions, sessionDebts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
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

  const [debtRows, txs] = await Promise.all([
    db.query.sessionDebts.findMany({
      where: eq(sessionDebts.memberId, parsed.data),
      with: { session: { with: { court: true } } },
    }),
    db.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, parsed.data),
      columns: { id: true, type: true, amount: true, reversalOfId: true },
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

  const entries: MemberPlayHistoryEntry[] = completed
    .map((d) => ({
      sessionId: d.sessionId,
      date: d.session.date,
      startTime: d.session.startTime || "20:30",
      endTime: d.session.endTime || "22:30",
      courtName: d.session.court?.name ?? null,
      totalAmount: d.totalAmount,
      playAmount: (d.playAmount ?? 0) + (d.guestPlayAmount ?? 0),
      dineAmount: (d.dineAmount ?? 0) + (d.guestDineAmount ?? 0),
      paidStatus: statusBySession[d.sessionId],
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);

  return { balance, entries };
}
