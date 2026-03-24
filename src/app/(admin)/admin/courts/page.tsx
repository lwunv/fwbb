import { getCourts } from "@/actions/courts";
import { CourtList } from "./court-list";

export default async function CourtsPage() {
  const courts = await getCourts();
  return (
    <div>
      <CourtList courts={courts} />
    </div>
  );
}
