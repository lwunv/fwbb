import { MemberShell } from "@/components/layout/member-shell";

/**
 * Vùng giao lưu (/san, sau này /giao-luu). Cố tình KHÔNG kiểm cờ ở đây: /san
 * đã chạy cho mọi người trước g2a và phải chạy y như vậy khi cờ tắt. Các trang
 * mới của vùng này tự trả 404 khi cờ tắt.
 */
export default function ExchangeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MemberShell mode="exchange">{children}</MemberShell>;
}
