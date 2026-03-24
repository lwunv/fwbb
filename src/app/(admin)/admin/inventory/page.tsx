import {
  getStockByBrand,
  getPurchaseHistory,
  getUsageHistory,
} from "@/actions/inventory";
import { getActiveBrands } from "@/actions/shuttlecocks";
import { InventoryClient } from "./inventory-client";

export default async function InventoryPage() {
  const [stock, purchases, usage, brands] = await Promise.all([
    getStockByBrand(),
    getPurchaseHistory(),
    getUsageHistory(),
    getActiveBrands(),
  ]);

  return (
    <div className="space-y-6">
      <InventoryClient
        stock={stock}
        purchases={purchases}
        usage={usage}
        brands={brands}
      />
    </div>
  );
}
