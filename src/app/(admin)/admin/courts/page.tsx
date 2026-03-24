import { getCourts } from "@/actions/courts";
import { getTranslations } from "next-intl/server";
import { CourtList } from "./court-list";

export default async function CourtsPage() {
  const courts = await getCourts();
  const t = await getTranslations("adminNav");
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("courts")}</h1>
      <CourtList courts={courts} />
    </div>
  );
}
