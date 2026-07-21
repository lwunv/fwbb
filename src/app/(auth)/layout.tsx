/**
 * (auth) route group — dùng cho forgot/reset-password. KHÔNG có login gate
 * (khác `(public)`, nơi `FacebookLoginGate` thay children khi thiếu cookie) vì
 * member chưa đăng nhập được (đang quên mật khẩu) vẫn phải vào được đây.
 *
 * Wrapper thuần: root `src/app/layout.tsx` đã cấp html/body/ThemeProvider/
 * NextIntlClientProvider/fonts — ở đây chỉ bọc khung glass mobile-first,
 * mirror `(admin)/admin/layout.tsx` (không render lại `<html>/<body>` hay
 * provider nào khác).
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="from-background to-muted/40 flex min-h-screen flex-col items-center justify-center bg-gradient-to-b p-4">
      <div className="bg-card/80 w-full max-w-sm space-y-4 rounded-2xl border p-6 shadow-sm backdrop-blur">
        {children}
      </div>
    </div>
  );
}
