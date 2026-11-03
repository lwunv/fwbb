import { requireApprovedMember } from "@/lib/member-auth";
import { VenueDirectory } from "./venue-directory";

/** Danh bạ sân quanh đây. Công khai; chỉ member đã duyệt mới thấy nút đề xuất. */
export default async function VenuesPage() {
  const auth = await requireApprovedMember();
  return <VenueDirectory canSuggest={!("error" in auth)} />;
}
