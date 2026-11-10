import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isExchangeEnabled } from "@/lib/exchange-flag";

// Hồ sơ công khai không cho máy tìm kiếm lập chỉ mục (quyết định 16).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Cổng cờ của /players. Đặt ở layout (trên loading.tsx) để cờ tắt trả HTTP 404
 * thật, như layout /exchanges.
 */
export default async function PlayersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isExchangeEnabled())) notFound();
  return children;
}
