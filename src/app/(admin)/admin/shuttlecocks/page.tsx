import { getBrands } from "@/actions/shuttlecocks";
import { BrandList } from "./brand-list";

export default async function ShuttlecocksPage() {
  const brands = await getBrands();
  return (
    <div>
      <BrandList brands={brands} />
    </div>
  );
}
