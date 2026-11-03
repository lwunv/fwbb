import { getCourts } from "@/actions/courts";
import { listVenuesForReview } from "@/actions/venues";
import { CourtList } from "./court-list";

export default async function CourtsPage() {
  const [courts, venues] = await Promise.all([
    getCourts(),
    listVenuesForReview("approved"),
  ]);
  return (
    <div>
      <CourtList
        courts={courts}
        venueOptions={venues.map((v) => ({ id: v.id, name: v.name }))}
      />
    </div>
  );
}
