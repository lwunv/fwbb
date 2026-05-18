"use server";

import { db } from "@/db";
import {
  inventoryPurchases,
  sessionShuttlecocks,
  sessions,
  shuttlecockBrands,
} from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { calculateExactShuttlecockCost } from "@/lib/cost-calculator";
import { roundToThousand } from "@/lib/utils";

export interface ShuttlecockFinanceSummary {
  totalSpent: number; // admin's outlay on all purchases (cost)
  totalRevenue: number; // members' aggregate share for shuttles used in sessions
  /**
   * Cost-basis value of remaining stock (per brand: weighted-avg
   * costPerQua × remainingQua, summed). Counts as admin's asset, NOT loss.
   * Bao gồm trong netProfit để admin không bị "lỗ ảo" khi mới nhập lô lớn
   * chưa kịp bán.
   */
  inventoryValue: number;
  netProfit: number; // (revenue + inventoryValue) - totalSpent
  totalTubesPurchased: number;
  totalQuaUsed: number;
  totalQuaPurchased: number;
  totalQuaRemaining: number;
}

export interface PurchaseRow {
  id: number;
  brandId: number;
  brandName: string;
  tubes: number;
  pricePerTube: number;
  totalPrice: number;
  purchasedAt: string;
  notes: string | null;
}

export interface UsageRow {
  id: number;
  sessionId: number;
  sessionDate: string;
  brandId: number;
  brandName: string;
  quantityUsed: number;
  pricePerTube: number;
  exactRevenue: number;
}

/**
 * Aggregate purchase outlay vs session-usage revenue. Treats the admin as a
 * separate "shuttlecock business": admin pays inventoryPurchases.totalPrice
 * upfront, then recovers (quantityUsed * pricePerTube / 12) per session usage
 * row — that exact amount goes into the session's totalShuttlecockCost which
 * members pay back via the play_amount.
 */
export async function getShuttlecockFinanceSummary(): Promise<ShuttlecockFinanceSummary> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return {
      totalSpent: 0,
      totalRevenue: 0,
      inventoryValue: 0,
      netProfit: 0,
      totalTubesPurchased: 0,
      totalQuaUsed: 0,
      totalQuaPurchased: 0,
      totalQuaRemaining: 0,
    };
  }

  const [purchases, usages] = await Promise.all([
    db.query.inventoryPurchases.findMany({}),
    // Fetch with session status so we can exclude cancelled sessions.
    // Cancelled sessions retain their sessionShuttlecocks rows (only
    // finalize-then-delete wipes them) but members were never charged for
    // those shuttlecocks — counting them inflates revenue.
    db.query.sessionShuttlecocks.findMany({
      with: { session: { columns: { status: true } } },
    }),
  ]);

  // Per-brand aggregation: cần weighted-avg costPerQua từng brand để định
  // giá tồn kho. Khác brand có giá nhập khác nhau → không thể dùng tổng
  // averaged cross-brand.
  interface BrandStat {
    spent: number;
    quaPurchased: number;
    quaUsed: number;
    revenue: number;
  }
  const byBrand = new Map<number, BrandStat>();
  function ensureBrand(id: number): BrandStat {
    let s = byBrand.get(id);
    if (!s) {
      s = { spent: 0, quaPurchased: 0, quaUsed: 0, revenue: 0 };
      byBrand.set(id, s);
    }
    return s;
  }

  let totalSpent = 0;
  let totalTubesPurchased = 0;
  for (const p of purchases) {
    totalSpent += p.totalPrice;
    totalTubesPurchased += p.tubes;
    const s = ensureBrand(p.brandId);
    s.spent += p.totalPrice;
    s.quaPurchased += p.tubes * 12;
  }

  let totalRevenueExact = 0;
  let totalQuaUsed = 0;
  for (const u of usages) {
    if (u.session?.status === "cancelled") continue;
    const exact = calculateExactShuttlecockCost(u.quantityUsed, u.pricePerTube);
    totalRevenueExact += exact;
    totalQuaUsed += u.quantityUsed;
    const s = ensureBrand(u.brandId);
    s.revenue += exact;
    s.quaUsed += u.quantityUsed;
  }

  // Revenue = số tiền admin THỰC TẾ thu được từ member cho cầu. Member bị
  // charge qua `calculateShuttlecockCost` (round UP to 1k), nên admin nhận
  // ≥ exact cost. Dùng `roundToThousand` thay vì `Math.round` để match đúng
  // số đã charge (Math.round có thể trả về số THẤP hơn thực thu → report
  // underestimate admin's actual revenue).
  const totalRevenue = roundToThousand(totalRevenueExact);

  // Tồn kho theo giá nhập: cho mỗi brand → remaining_qua × weighted-avg
  // cost_per_qua. Bỏ qua adjustQua (manual correction) vì admin chưa thực sự
  // chi/thu cho phần đó — chỉ cần định giá phần đã CHI thật.
  let inventoryValueExact = 0;
  let totalQuaRemaining = 0;
  for (const s of byBrand.values()) {
    if (s.quaPurchased <= 0) continue;
    const costPerQua = s.spent / s.quaPurchased;
    const remaining = Math.max(0, s.quaPurchased - s.quaUsed);
    inventoryValueExact += costPerQua * remaining;
    totalQuaRemaining += remaining;
  }
  const inventoryValue = Math.round(inventoryValueExact);

  // Lãi/Lỗ accounting:
  //   netProfit = doanh thu đã bán + giá trị tồn kho còn lại - tổng giá gốc
  // Tương đương COGS-based: profit = revenue - (totalSpent - inventoryValue)
  //   = revenue - COGS, với COGS = phần giá gốc của số quả ĐÃ bán.
  // Lý do dùng (revenue + inventory) - spent thay vì revenue - spent: khi
  // admin mới nhập 1 lô lớn (totalSpent tăng vọt), nếu chưa kịp bán hết,
  // formula cũ sẽ báo "lỗ" giả — thực tế đó là hàng tồn còn nguyên giá trị.
  const netProfit = totalRevenue + inventoryValue - totalSpent;

  return {
    totalSpent,
    totalRevenue,
    inventoryValue,
    netProfit,
    totalTubesPurchased,
    totalQuaUsed,
    totalQuaPurchased: totalTubesPurchased * 12,
    totalQuaRemaining,
  };
}

/** List purchases (admin spending), most recent first. */
export async function getPurchaseHistory(limit = 100): Promise<PurchaseRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db
    .select({
      id: inventoryPurchases.id,
      brandId: inventoryPurchases.brandId,
      brandName: shuttlecockBrands.name,
      tubes: inventoryPurchases.tubes,
      pricePerTube: inventoryPurchases.pricePerTube,
      totalPrice: inventoryPurchases.totalPrice,
      purchasedAt: inventoryPurchases.purchasedAt,
      notes: inventoryPurchases.notes,
    })
    .from(inventoryPurchases)
    .leftJoin(
      shuttlecockBrands,
      eq(inventoryPurchases.brandId, shuttlecockBrands.id),
    )
    .orderBy(desc(inventoryPurchases.purchasedAt), desc(inventoryPurchases.id))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    brandName: r.brandName ?? "—",
  }));
}

/** List session usages (admin revenue events), most recent first. */
export async function getUsageHistory(limit = 100): Promise<UsageRow[]> {
  const auth = await requireAdmin();
  if ("error" in auth) return [];

  const rows = await db
    .select({
      id: sessionShuttlecocks.id,
      sessionId: sessionShuttlecocks.sessionId,
      sessionDate: sessions.date,
      brandId: sessionShuttlecocks.brandId,
      brandName: shuttlecockBrands.name,
      quantityUsed: sessionShuttlecocks.quantityUsed,
      pricePerTube: sessionShuttlecocks.pricePerTube,
    })
    .from(sessionShuttlecocks)
    .leftJoin(sessions, eq(sessionShuttlecocks.sessionId, sessions.id))
    .leftJoin(
      shuttlecockBrands,
      eq(sessionShuttlecocks.brandId, shuttlecockBrands.id),
    )
    .orderBy(desc(sessions.date), desc(sessionShuttlecocks.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    sessionDate: r.sessionDate ?? "",
    brandId: r.brandId,
    brandName: r.brandName ?? "—",
    quantityUsed: r.quantityUsed,
    pricePerTube: r.pricePerTube,
    exactRevenue: roundToThousand(
      calculateExactShuttlecockCost(r.quantityUsed, r.pricePerTube),
    ),
  }));
}
