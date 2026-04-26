import type { Metadata } from "next";
import { Geist, Geist_Mono, Roboto } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Providers } from "@/components/providers";
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

export const metadata: Metadata = {
  title: "FWBB - Quản lý nhóm cầu lông",
  description: "Ứng dụng quản lý nhóm cầu lông phong trào",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${roboto.variable} ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
              <Providers>{children}</Providers>
            </ThemeProvider>
          </NuqsAdapter>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
