import { getMembers } from "@/actions/members";
import { getTranslations } from "next-intl/server";
import { MemberList } from "./member-list";

export default async function MembersPage() {
  const members = await getMembers();
  const t = await getTranslations("adminNav");
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("members")}</h1>
      <MemberList members={members} />
    </div>
  );
}
