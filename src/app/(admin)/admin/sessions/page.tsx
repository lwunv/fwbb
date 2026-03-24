import { getSessions } from "@/actions/sessions";
import { getTranslations } from "next-intl/server";
import { SessionList } from "./session-list";

export default async function SessionsPage() {
  const sessions = await getSessions();
  const t = await getTranslations("dashboard");
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("manageSessions")}</h1>
      <SessionList sessions={sessions} />
    </div>
  );
}
