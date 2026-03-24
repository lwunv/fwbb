import { getCourts } from "@/actions/courts";
import { CourtList } from "./court-list";

export default async function CourtsPage() {
  const courts = await getCourts();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Quan ly san</h1>
      <CourtList courts={courts} />
    </div>
  );
}
