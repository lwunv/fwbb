import { redirect } from "next/navigation";

// Quỹ và công nợ đã được gộp làm một — số dư quỹ chính là "còn nợ" hay "còn quỹ".
// /my-debts redirect về /my-fund để mọi thao tác liên quan tiền nong nằm cùng một chỗ.
export default function MyDebtsPage() {
  redirect("/my-fund");
}
