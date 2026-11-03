import { notFound } from "next/navigation";
import { isExchangeEnabled } from "@/lib/exchange-flag";

/**
 * Cổng cờ của các trang /giao-luu. Đặt ở layout (trên loading.tsx) để cờ tắt
 * trả HTTP 404 thật; đặt ở page thì loading.tsx đã gửi 200 trước khi page chạy.
 * Cố tình KHÔNG kiểm cờ ở (exchange)/layout.tsx vì /san ở đó phải chạy khi cờ tắt.
 */
export default async function GiaoLuuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isExchangeEnabled())) notFound();
  return children;
}
