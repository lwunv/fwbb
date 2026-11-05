import { notFound } from "next/navigation";
import { getManageView } from "@/actions/exchange-host";
import { ManageClient } from "./manage-client";

/**
 * Màn quản lý của host. `getManageView` trả null cho mọi ai không phải host
 * (chưa đăng nhập, người khác, cờ tắt), nên tất cả cùng ra 404, không lộ buổi có tồn tại.
 */
export default async function ManageExchangeEventPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const view = await getManageView(code);
  if (!view) notFound();
  return <ManageClient view={view} />;
}
