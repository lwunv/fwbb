"use server";

import { db } from "@/db";
import { courts, financialTransactions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { recordFinancialTransaction } from "@/lib/financial-ledger";
import { getTranslations } from "next-intl/server";
import {
  computeCourtRentReport,
  type CourtRentReport,
} from "@/lib/court-rent-report";

export type {
  CourtRentMonthSummary,
  CourtRentReport,
  OrphanedPayment,
} from "@/lib/court-rent-report";

interface PaymentRow {
  id: number;
  amount: number;
  description: string | null;
  createdAt: string;
  /** target month from metadata: "YYYY-MM" */
  targetMonth: string | null;
  courtId: number | null;
  courtName: string | null;
}

export async function getCourtRentReport(
  year: number,
): Promise<CourtRentReport> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return {
      year,
      months: [],
      yearTotal: {
        expected: 0,
        fixedRent: 0,
        extraRent: 0,
        paid: 0,
        passRevenue: 0,
        remaining: 0,
      },
      orphanedPayments: [],
    };
  }

  return computeCourtRentReport(db, year);
}

/**
 * Liệt kê các payment cho 1 tháng cụ thể (để admin review/edit/xóa).
 */
export async function getCourtRentPayments(
  year: number,
  month: number,
): Promise<PaymentRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const target = `${year}-${String(month).padStart(2, "0")}`;
  const allRaw = await db.query.financialTransactions.findMany({
    where: eq(financialTransactions.type, "court_rent_payment"),
    orderBy: [desc(financialTransactions.createdAt)],
  });
  // Bỏ cặp đã reverse (original + reversal cancel out → admin không thấy
  // row đã xóa logic).
  const reversedIds = new Set(
    allRaw.filter((p) => p.reversalOfId).map((p) => p.reversalOfId!),
  );
  const all = allRaw.filter((p) => !p.reversalOfId && !reversedIds.has(p.id));

  const courtRows = await db.query.courts.findMany({
    columns: { id: true, name: true },
  });
  const courtMap = new Map(courtRows.map((c) => [c.id, c.name]));

  return all
    .map((t): PaymentRow | null => {
      let targetMonth: string | null = null;
      let courtId: number | null = null;
      try {
        const m = t.metadataJson
          ? (JSON.parse(t.metadataJson) as {
              targetMonth?: unknown;
              courtId?: unknown;
            })
          : {};
        if (typeof m.targetMonth === "string") targetMonth = m.targetMonth;
        if (typeof m.courtId === "number") courtId = m.courtId;
      } catch {
        // ignore
      }
      if (targetMonth !== target) return null;
      return {
        id: t.id,
        amount: t.amount,
        description: t.description,
        createdAt: t.createdAt ?? "",
        targetMonth,
        courtId,
        courtName: courtId ? (courtMap.get(courtId) ?? null) : null,
      };
    })
    .filter((r): r is PaymentRow => r !== null);
}

export async function recordCourtRentPayment(input: {
  year: number;
  month: number;
  amount: number;
  courtId?: number | null;
  /** "fixed" = trả gói tháng cố định; "extra" = trả phát sinh. Default "fixed"
   *  cho backwards-compat. */
  bucket?: "fixed" | "extra";
  note?: string;
  /** UUID per submit — DB UNIQUE INDEX trên `idempotency_key` chặn double-write
   *  khi admin click 2 lần liên tiếp / mạng trễ → optimistic UI đã reset form. */
  idempotencyKey: string;
}): Promise<{ success: true; replayed: boolean } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const t = await getTranslations("serverErrors");
  if (!Number.isInteger(input.year) || input.year < 2020 || input.year > 2100) {
    return { error: t("invalidYear") };
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    return { error: t("invalidMonth") };
  }
  if (
    !Number.isInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 1_000_000_000
  ) {
    return { error: t("invalidAmount") };
  }

  if (
    !input.idempotencyKey ||
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim().length < 4
  ) {
    return { error: t("missingIdempotencyKey") };
  }

  let courtId: number | null = null;
  if (input.courtId) {
    const c = await db.query.courts.findFirst({
      where: eq(courts.id, input.courtId),
      columns: { id: true },
    });
    if (!c) return { error: t("courtNotExists") };
    courtId = c.id;
  }

  // Đi qua `recordFinancialTransaction` helper để: (a) idempotency check + DB
  // UNIQUE fallback cùng 1 đường code với mọi action khác, (b) validate
  // `Number.isInteger(amount) && >= 0` (defence-in-depth dù đã guard ở trên),
  // (c) metadata serialize chuẩn JSON. Trước đây inline `db.insert` bypass
  // helper → mất defence layer.
  const targetMonth = `${input.year}-${String(input.month).padStart(2, "0")}`;
  const bucket: "fixed" | "extra" =
    input.bucket === "extra" ? "extra" : "fixed";
  const r = await recordFinancialTransaction({
    type: "court_rent_payment",
    direction: "out",
    amount: input.amount,
    memberId: null,
    sessionId: null,
    debtId: null,
    description:
      input.note ??
      `Trả tiền sân tháng ${String(input.month).padStart(2, "0")}/${input.year} (${bucket === "extra" ? "phát sinh" : "cố định"})`,
    metadata: { targetMonth, courtId, bucket },
    idempotencyKey: input.idempotencyKey,
  });
  if ("error" in r) {
    return { error: r.error ?? t("transactionWriteFailed") };
  }
  if (r.replayed) return { success: true, replayed: true };

  revalidatePath("/admin/court-rent");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/fund");
  return { success: true, replayed: false };
}

export async function deleteCourtRentPayment(
  paymentId: number,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;

  const original = await db.query.financialTransactions.findFirst({
    where: and(
      eq(financialTransactions.id, paymentId),
      eq(financialTransactions.type, "court_rent_payment"),
    ),
  });
  if (!original) {
    const t = await getTranslations("serverErrors");
    return { error: t("transactionNotFound") };
  }

  // Reversal pattern thay vì hard-delete — giữ audit trail. Trước đây
  // hard-delete làm reconcile không phân biệt "xóa nhầm" vs "chưa từng tồn
  // tại". Reversal row có `reversalOfId` trỏ về row gốc; khi list payments
  // có thể filter (original ≠ none-reversed) để ẩn cặp đã reverse.
  //
  // Pre-check + insert now happen inside a db.transaction so the
  // read-then-write is atomic. idempotencyKey `delete-court-rent-${paymentId}`
  // is the last-line-of-defence via DB UNIQUE INDEX on idempotency_key.
  try {
    await db.transaction(async (tx) => {
      const existingReversal = await tx.query.financialTransactions.findFirst({
        where: eq(financialTransactions.reversalOfId, paymentId),
        columns: { id: true },
      });
      if (existingReversal) return; // idempotent no-op inside tx

      const r = await recordFinancialTransaction(
        {
          type: "court_rent_payment",
          direction: "in", // ngược direction với original (out → in)
          amount: original.amount,
          memberId: original.memberId,
          sessionId: original.sessionId,
          debtId: original.debtId,
          reversalOfId: original.id,
          description:
            `Hoàn tác trả tiền sân — ${original.description ?? ""}`.trim(),
          metadata: original.metadataJson
            ? (JSON.parse(original.metadataJson) as Record<
                string,
                string | number | boolean | null
              >)
            : null, // copy để filter list theo targetMonth vẫn match
          idempotencyKey: `delete-court-rent-${paymentId}`,
        },
        tx,
      );
      if ("error" in r) throw new Error(r.error);
    });
  } catch (err) {
    const t = await getTranslations("serverErrors");
    return {
      error: err instanceof Error ? err.message : t("transactionWriteFailed"),
    };
  }

  revalidatePath("/admin/court-rent");
  revalidatePath("/admin/fund");
  return { success: true };
}

export async function getCourtRentYears(): Promise<number[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db.query.sessions.findMany({
    columns: { date: true },
  });
  const years = new Set<number>();
  for (const r of rows) {
    if (r.date) {
      const y = parseInt(r.date.slice(0, 4), 10);
      if (Number.isFinite(y)) years.add(y);
    }
  }
  years.add(new Date().getFullYear());
  return Array.from(years).sort((a, b) => b - a);
}
