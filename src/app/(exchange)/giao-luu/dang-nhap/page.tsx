import { redirect } from "next/navigation";
import { getUserFromCookie } from "@/lib/user-identity";
import { safeNextPath } from "@/lib/safe-next-path";
import { ExchangeLoginForm } from "./exchange-login-form";

/**
 * Đăng nhập vùng giao lưu. Cờ tắt đã 404 ở layout /giao-luu. Đã đăng nhập thì
 * đi tiếp tới `next` (qua safeNextPath: giá trị đến từ URL do client kiểm soát).
 */
export default async function ExchangeLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  if (await getUserFromCookie()) redirect(safeNextPath(next));

  return (
    <div className="flex flex-1 flex-col py-2">
      <ExchangeLoginForm next={next} error={error} />
    </div>
  );
}
