import { getSessions } from "@/actions/sessions";
import { SessionList } from "./session-list";

export default async function SessionsPage() {
  const sessions = await getSessions();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quan ly buoi choi</h1>
      <SessionList sessions={sessions} />
    </div>
  );
}
