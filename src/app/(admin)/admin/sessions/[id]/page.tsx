import { getSession } from "@/actions/sessions";
import { getSessionVotes } from "@/actions/votes";
import { getActiveCourts } from "@/actions/courts";
import { getActiveBrands } from "@/actions/shuttlecocks";
import { getActiveMembers } from "@/actions/members";
import { SessionDetail } from "./session-detail";
import { notFound } from "next/navigation";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) notFound();

  const [session, votes, courts, brands, members] = await Promise.all([
    getSession(sessionId),
    getSessionVotes(sessionId),
    getActiveCourts(),
    getActiveBrands(),
    getActiveMembers(),
  ]);

  if (!session) notFound();

  return (
    <div>
      <SessionDetail
        session={session}
        votes={votes}
        courts={courts}
        brands={brands}
        members={members}
      />
    </div>
  );
}
