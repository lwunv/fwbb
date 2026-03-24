import { getMembers } from "@/actions/members";
import { MemberList } from "./member-list";

export default async function MembersPage() {
  const members = await getMembers();
  return (
    <div>
      <MemberList members={members} />
    </div>
  );
}
