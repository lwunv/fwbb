import { getMembers } from "@/actions/members";
import { MemberList } from "./member-list";

export default async function MembersPage() {
  const members = await getMembers();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quan ly thanh vien</h1>
      <MemberList members={members} />
    </div>
  );
}
