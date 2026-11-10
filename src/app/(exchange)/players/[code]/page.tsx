import { notFound } from "next/navigation";
import { getExchangeViewer } from "@/lib/member-auth";
import { getPublicProfile } from "@/lib/reputation/profile-read";
import { PlayerProfile } from "./player-profile";

/**
 * Hồ sơ công khai của một người chơi. Cờ tắt đã 404 ở layout /players; mã
 * không có, tài khoản bị khoá hay bị từ chối cũng 404 (`getPublicProfile` trả
 * null). Hồ sơ đọc qua cache; khách không có cookie thì `getExchangeViewer`
 * trả về ngay, không đọc DB thêm. Chỉ truyền xuống client hai cờ boolean của
 * người xem, không truyền bản ghi member của họ.
 */
export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // Hồ sơ (có cache) trước: mã lạ 404 ngay, không tốn lần đọc người xem.
  const profile = await getPublicProfile(code);
  if (!profile) notFound();
  const viewer = await getExchangeViewer();

  const isSelf = viewer.status === "ok" && viewer.member.publicCode === code;
  const canReport = viewer.status === "ok" && !isSelf;

  return <PlayerProfile profile={profile} canReport={canReport} />;
}
