import type { Metadata } from "next";
import { Geist, Geist_Mono, Roboto } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Providers } from "@/components/providers";
import { PinkThemeEffects } from "@/components/shared/pink-theme-effects";
import { Toaster } from "@/components/ui/sonner";
import { getSettings } from "@/actions/settings";
import "./globals.css";

/** vi/en: Roboto. zh: stack dùng Geist + font hệ thống Hán (`globals.css` html[lang="zh"]) */
const roboto = Roboto({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("appMeta");
  return {
    title: t("title"),
    description: t("description"),
    other: {
      google: "notranslate",
      // Nhãn dưới icon khi thêm ra màn hình chính iPhone. Không đặt thì iOS lấy
      // <title> đầy đủ rồi cắt cụt thành "FWBB-Friendswi...".
      //
      // Cố tình KHÔNG dùng `appleWebApp` của Next metadata dù nó có sẵn field
      // `title`: nó phát ra kèm `mobile-web-app-capable`, tức bật chế độ
      // standalone (mở app không có thanh Safari). App này đăng nhập bằng
      // Facebook/Google, mà standalone trên iOS hay làm đứt phiên OAuth vì
      // trình duyệt bật ra là một ngữ cảnh khác. Đổi hành vi đó chỉ để sửa một
      // cái nhãn là không đáng.
      "apple-mobile-web-app-title": "FWBB",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const settings = await getSettings();

  return (
    <html
      lang={locale}
      translate="no"
      className={`${roboto.variable} ${geistSans.variable} ${geistMono.variable} notranslate h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider messages={messages}>
          <NuqsAdapter>
            <ThemeProvider
              attribute="class"
              defaultTheme="light"
              themes={["light", "dark", "pink"]}
              enableSystem={false}
              disableTransitionOnChange
            >
              <Providers settings={settings}>{children}</Providers>
              {/* Chỗ render cho mọi `toast.*` trong app. Thiếu nó thì sonner
                  vẫn chạy không lỗi nhưng không vẽ gì, nên mọi thất bại đều
                  im lặng — admin bấm xóa thành viên chỉ thấy hàng biến mất
                  rồi hiện lại, không biết vì sao. Đặt TRONG ThemeProvider vì
                  Toaster đọc useTheme, và ngoài Providers để mọi route
                  (admin/public/auth) đều có. */}
              <Toaster position="top-center" richColors closeButton />
              <PinkThemeEffects />
            </ThemeProvider>
          </NuqsAdapter>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
