"use client"; // Error boundary bắt buộc là Client Component

import { useSyncExternalStore } from "react";
import { ErrorFallback } from "@/components/shared/error-fallback";
import { errorPageCopy, localeFromCookie } from "@/lib/error-page-copy";
import "./globals.css";

const noopSubscribe = () => () => {};

/**
 * Lỗi ở chính layout gốc. Layout gốc đọc `app_settings` từ DB, nên đây là màn
 * người dùng thấy khi kết nối Turso đứt. File này THAY THẾ layout gốc: phải tự
 * có <html>/<body>, tự import CSS, và không có provider next-intl hay theme.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // Cookie chỉ đọc được trên trình duyệt. Server render bản tiếng Việt, client
  // đổi sang đúng ngôn ngữ sau hydrate mà không lệch markup.
  const locale = useSyncExternalStore(
    noopSubscribe,
    () => localeFromCookie(document.cookie),
    () => "vi" as const,
  );
  const copy = errorPageCopy[locale];

  return (
    <html
      lang={locale}
      translate="no"
      className="notranslate h-full antialiased"
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <title>{copy.title}</title>
        <ErrorFallback
          copy={copy}
          onRetry={unstable_retry}
          digest={error.digest}
        />
      </body>
    </html>
  );
}
