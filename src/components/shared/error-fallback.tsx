"use client";

import { useTransition } from "react";
import { motion } from "framer-motion";
import { CloudOff, Home, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ErrorPageCopy } from "@/lib/error-page-copy";

interface ErrorFallbackProps {
  copy: ErrorPageCopy;
  /** Gọi `unstable_retry()` của error boundary: tải lại dữ liệu rồi render lại. */
  onRetry: () => void;
  /** Mã Next gắn cho lỗi phía server, khớp với trường `digest` trong log Vercel. */
  digest?: string;
}

/** Màn báo lỗi dùng chung cho `app/error.tsx` và `app/global-error.tsx`. */
export function ErrorFallback({ copy, onRetry, digest }: ErrorFallbackProps) {
  // unstable_retry refresh trong transition nên isPending phản ánh đúng lúc
  // đang tải lại, đủ để khoá nút và hiện spinner.
  const [isPending, startTransition] = useTransition();

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-10">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="border-border/60 bg-card/80 flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border px-6 py-8 text-center shadow-lg backdrop-blur"
      >
        <div className="from-primary/25 to-primary/5 text-primary flex size-16 items-center justify-center rounded-full bg-gradient-to-br">
          <CloudOff className="size-8" aria-hidden />
        </div>

        <div className="space-y-2">
          <h1 className="text-foreground text-xl font-bold">{copy.title}</h1>
          <p className="text-muted-foreground text-base">{copy.description}</p>
        </div>

        <div className="flex w-full flex-col gap-3">
          <motion.div whileTap={{ scale: 0.97 }}>
            <Button
              size="lg"
              className="w-full"
              disabled={isPending}
              onClick={() => startTransition(() => onRetry())}
            >
              {isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {isPending ? copy.retrying : copy.retry}
            </Button>
          </motion.div>
          {/* Thẻ <a> thường chứ không phải <Link>: về trang chủ bằng một lượt
              tải trang mới, không dựa vào router client có thể đang hỏng. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- cần tải lại trang đầy đủ, xem comment trên */}
          <a
            href="/"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "w-full",
            )}
          >
            <Home aria-hidden />
            {copy.home}
          </a>
        </div>

        {digest ? (
          <p className="text-muted-foreground text-sm">
            {copy.codeLabel}: {digest}
          </p>
        ) : null}
      </motion.section>
    </main>
  );
}
