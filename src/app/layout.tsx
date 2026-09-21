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
