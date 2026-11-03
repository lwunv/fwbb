import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireApprovedMember } from "@/lib/member-auth";
import { VenueSubmitForm } from "./venue-submit-form";

export default async function SuggestVenuePage() {
  const auth = await requireApprovedMember();
  if ("error" in auth) redirect("/login");
  const t = await getTranslations("venues");
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("suggestTitle")}</h1>
        <p className="text-muted-foreground text-base">
          {t("suggestSubtitle")}
        </p>
      </header>
      <VenueSubmitForm />
    </div>
  );
}
