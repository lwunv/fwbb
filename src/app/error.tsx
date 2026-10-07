"use client"; // Error boundary bắt buộc là Client Component

import { useLocale } from "next-intl";
import { ErrorFallback } from "@/components/shared/error-fallback";
import { errorPageCopy, isErrorPageLocale } from "@/lib/error-page-copy";

/**
 * Lỗi trong một trang (dưới layout gốc). Layout vẫn sống nên còn provider
 * next-intl và theme. Lỗi ở chính layout gốc do `global-error.tsx` lo.
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const locale = useLocale();
  const copy = errorPageCopy[isErrorPageLocale(locale) ? locale : "vi"];

  return (
    <ErrorFallback copy={copy} onRetry={unstable_retry} digest={error.digest} />
  );
}
