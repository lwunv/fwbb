import {
  getStockByBrand,
  getPurchaseHistory,
  getUsageHistory,
} from "@/actions/inventory";
import { getActiveBrands } from "@/actions/shuttlecocks";
import { getTranslations } from "next-intl/server";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const t = await getTranslations("adminNav");

  const [stock, purchases, usage, brands] = await Promise.all([
    getStockByBrand(),
    getPurchaseHistory(),
    getUsageHistory(),
    getActiveBrands(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("inventory")}</h1>
      <InventoryClient
        stock={stock}
        purchases={purchases}
        usage={usage}
        brands={brands}
      />
    </div>
  );
}
