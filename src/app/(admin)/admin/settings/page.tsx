import { getTranslations } from "next-intl/server";
import { getSettings } from "@/actions/settings";
import { SettingsClient } from "./settings-client";

export default async function AdminSettingsPage() {
  const t = await getTranslations("adminSettings");
  const settings = await getSettings();

  return (
    <div className="space-y-4 p-4 pb-24 lg:p-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      <SettingsClient settings={settings} />
    </div>
  );
}
