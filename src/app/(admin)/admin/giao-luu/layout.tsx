import { notFound } from "next/navigation";
import { isExchangeEnabled } from "@/lib/exchange-flag";

/**
 * Cổng cờ của /admin/giao-luu. Đặt ở layout (trên loading.tsx) để cờ tắt trả
 * HTTP 404 thật, giống layout của /giao-luu.
 */
export default async function AdminGiaoLuuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isExchangeEnabled())) notFound();
  return children;
}
