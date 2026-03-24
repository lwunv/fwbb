import { getBrands } from "@/actions/shuttlecocks";
import { BrandList } from "./brand-list";

export default async function ShuttlecocksPage() {
  const brands = await getBrands();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quan ly hang cau</h1>
      <BrandList brands={brands} />
    </div>
  );
}
