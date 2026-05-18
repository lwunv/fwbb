import {
  getShuttlecockFinanceSummary,
  getPurchaseHistory,
  getUsageHistory,
} from "@/actions/shuttlecock-finance";
import { getDefaultBrand } from "@/actions/settings";
import { db } from "@/db";
import { shuttlecockBrands } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ShuttlecockFinanceClient } from "./shuttlecock-finance-client";

export default async function AdminShuttlecockFinancePage() {
  const [summary, purchases, usages, brands, defaultBrand] = await Promise.all([
    getShuttlecockFinanceSummary(),
    getPurchaseHistory(100),
    getUsageHistory(100),
    db.query.shuttlecockBrands.findMany({
      where: eq(shuttlecockBrands.isActive, true),
      columns: { id: true, name: true, pricePerTube: true },
      orderBy: (b, { asc }) => [asc(b.name)],
    }),
    getDefaultBrand(),
  ]);

  return (
    <ShuttlecockFinanceClient
      summary={summary}
      purchases={purchases}
      usages={usages}
      brands={brands}
      defaultBrandId={defaultBrand?.id ?? null}
    />
  );
}
