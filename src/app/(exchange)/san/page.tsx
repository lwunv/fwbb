import { requireApprovedMember } from "@/lib/member-auth";
import { isExchangeEnabled } from "@/lib/exchange-flag";
import { VenueDirectory } from "./venue-directory";

/** Danh bạ sân quanh đây. Công khai; chỉ member đã duyệt mới thấy nút đề xuất. */
export default async function VenuesPage() {
  const [auth, exchangeEnabled] = await Promise.all([
    requireApprovedMember(),
    isExchangeEnabled(),
  ]);
  return (
    <VenueDirectory
      canSuggest={!("error" in auth)}
      exchangeEnabled={exchangeEnabled}
    />
  );
}
