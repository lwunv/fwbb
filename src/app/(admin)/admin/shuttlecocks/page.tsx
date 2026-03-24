import { getBrands } from "@/actions/shuttlecocks";
import { getTranslations } from "next-intl/server";
import { BrandList } from "./brand-list";

export default async function ShuttlecocksPage() {
  const brands = await getBrands();
  const t = await getTranslations("adminNav");
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("shuttlecocks")}</h1>
      <BrandList brands={brands} />
    </div>
  );
}
