import { redirect } from "next/navigation";

// Trang Quỹ và Tài chính đã được gộp lại — mọi thao tác và lịch sử giao dịch
// nằm tại /admin/fund. Giữ /admin/finance làm redirect để bookmark cũ vẫn chạy.
export default function AdminFinanceRedirect() {
  redirect("/admin/fund");
}
