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

export interface ShuttlecockFinanceSummary {
  totalSpent: number; // admin's outlay on purchases
  totalRevenue: number; // members' aggregate share for shuttles used
  netProfit: number; // revenue - spent
  totalTubesPurchased: number;
  totalQuaUsed: number;
  totalQuaPurchased: number;
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
      netProfit: 0,
      totalTubesPurchased: 0,
      totalQuaUsed: 0,
      totalQuaPurchased: 0,
    };
  }

  const [purchases, usages] = await Promise.all([
    db.query.inventoryPurchases.findMany({}),
    db.query.sessionShuttlecocks.findMany({}),
  ]);

  let totalSpent = 0;
  let totalTubesPurchased = 0;
  for (const p of purchases) {
    totalSpent += p.totalPrice;
    totalTubesPurchased += p.tubes;
  }

  let totalRevenue = 0;
  let totalQuaUsed = 0;
  for (const u of usages) {
    totalRevenue += calculateExactShuttlecockCost(
      u.quantityUsed,
      u.pricePerTube,
    );
    totalQuaUsed += u.quantityUsed;
  }

  // Round revenue to integer VND for display consistency.
  totalRevenue = Math.round(totalRevenue);

  return {
    totalSpent,
    totalRevenue,
    netProfit: totalRevenue - totalSpent,
    totalTubesPurchased,
    totalQuaUsed,
    totalQuaPurchased: totalTubesPurchased * 12,
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
    exactRevenue: Math.round(
      calculateExactShuttlecockCost(r.quantityUsed, r.pricePerTube),
    ),
  }));
}
