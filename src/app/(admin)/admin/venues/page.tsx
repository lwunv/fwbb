import { listVenuesForReview } from "@/actions/venues";
import { VenueReviewList } from "./venue-review-list";

export default async function AdminVenuesPage() {
  const [pending, approved, hidden] = await Promise.all([
    listVenuesForReview("pending"),
    listVenuesForReview("approved"),
    listVenuesForReview("hidden"),
  ]);
  return (
    <VenueReviewList pending={pending} approved={approved} hidden={hidden} />
  );
}
