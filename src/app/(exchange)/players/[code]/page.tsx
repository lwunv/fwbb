import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { getMyReferralState } from "@/actions/referrals";
import { getExchangeViewer } from "@/lib/member-auth";
import { getPublicProfile } from "@/lib/reputation/profile-read";
import { vnDisplayDate } from "@/lib/reputation/referral-rules";
import { PlayerProfile, type ReferralOffer } from "./player-profile";

// Tiêu đề và trang chạy song song trong cùng một request: gộp về một lần gọi
// để lúc cache hồ sơ hết hạn cũng chỉ đọc DB một lần.
const loadProfile = cache((code: string) => getPublicProfile(code));

/**
 * Tiêu đề tab theo tên người chơi (Task 25), để mở nhiều hồ sơ còn phân biệt
 * được. Mã lạ thì để trang 404, không đặt tiêu đề.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const profile = await loadProfile(code);
  if (!profile) return {};
  const t = await getTranslations("exchange.reputation");
  return { title: t("profileOf", { name: profile.name }) };
}

/**
 * Hồ sơ công khai của một người chơi. Cờ tắt đã 404 ở layout /players; mã
 * không có, tài khoản bị khoá hay bị từ chối cũng 404 (`getPublicProfile` trả
 * null). Hồ sơ đọc qua cache; khách không có cookie thì `getExchangeViewer`
 * trả về ngay, không đọc DB thêm. Chỉ truyền xuống client hai cờ boolean của
 * người xem, không truyền bản ghi member của họ.
 *
 * Trạng thái giới thiệu chỉ đọc khi hồ sơ là nick mới chưa ai giới thiệu và
 * người xem là người khác đã đăng nhập: các trường hợp còn lại không tốn thêm
 * lần đọc nào.
 */
export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // Hồ sơ (có cache) trước: mã lạ 404 ngay, không tốn lần đọc người xem.
  const profile = await loadProfile(code);
  if (!profile) notFound();
  const viewer = await getExchangeViewer();

  const isSelf = viewer.status === "ok" && viewer.member.publicCode === code;
  const canReport = viewer.status === "ok" && !isSelf;

  let referral: ReferralOffer | null = null;
  if (canReport && profile.isNew && !profile.referred) {
    const state = await getMyReferralState();
    if (state) {
      referral = {
        eligible: state.eligible,
        remaining: Math.max(0, state.limit - state.usedThisMonth),
        limit: state.limit,
        blockedDate: state.blockedUntil
          ? vnDisplayDate(state.blockedUntil)
          : null,
      };
    }
  }

  return (
    <PlayerProfile
      profile={profile}
      canReport={canReport}
      referral={referral}
    />
  );
}
