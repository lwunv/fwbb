import { notFound } from "next/navigation";
import { getExchangeEvent } from "@/actions/exchange-read";
import { getExchangeViewer } from "@/lib/member-auth";
import { parseGender } from "@/lib/gender";
import { EventPost } from "./event-post";

/**
 * Trang một buổi giao lưu. Cờ tắt đã 404 ở layout /exchanges. Buổi không có,
 * bị ẩn với người xem này hoặc host hết hiệu lực đều ra 404 (action trả null).
 * Giới tính của người xem đọc ở đây để điền sẵn form đăng ký, vì
 * `ViewerExtras` không mang theo.
 */
export default async function ExchangeEventPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [data, viewer] = await Promise.all([
    getExchangeEvent(code),
    getExchangeViewer(),
  ]);
  if (!data) notFound();

  const memberGender =
    viewer.status === "ok" ? parseGender(viewer.member.gender) : null;

  return (
    <EventPost
      event={data.event}
      viewer={data.viewer}
      memberGender={memberGender}
    />
  );
}
