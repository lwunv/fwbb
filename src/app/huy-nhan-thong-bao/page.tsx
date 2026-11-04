import type { Metadata } from "next";
import { UnsubscribeCard } from "./unsubscribe-card";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Token nằm trong URL: không gửi URL đầy đủ sang trang khác qua Referer.
  referrer: "no-referrer",
};

/**
 * Trang công khai (không đăng nhập). Render chỉ hiện nút: việc huỷ thật chỉ
 * xảy ra khi bấm (POST), để máy quét link không tự huỷ thay người nhận.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-10">
      <UnsubscribeCard token={typeof token === "string" ? token : ""} />
    </main>
  );
}
