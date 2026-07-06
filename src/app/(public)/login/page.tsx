import { redirect } from "next/navigation";
import { getUserFromCookie } from "@/lib/user-identity";
import { getAppName } from "@/actions/settings";
import { FacebookLoginGate } from "../facebook-login-gate";

/**
 * Surface đăng nhập/đăng ký công khai. Từ khi trang chủ mở public (khách xem
 * được lịch mà chưa cần login), đây là NƠI DUY NHẤT hiện form login: các trang
 * cá nhân + nút vote của khách đều redirect/link về đây. Đã đăng nhập rồi →
 * về trang chủ.
 */
export default async function LoginPage() {
  const user = await getUserFromCookie();
  if (user) redirect("/");
  const appName = await getAppName();
  return (
    <div className="flex flex-1 items-center justify-center py-8">
      <FacebookLoginGate appName={appName} />
    </div>
  );
}
