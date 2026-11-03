"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { initGoogleSDK, renderGoogleButton } from "@/lib/google-sdk";
import { isInFacebookBrowser, isInZaloBrowser } from "@/lib/facebook-sdk";
import { googleLogin } from "@/actions/google-auth";
import { safeNextPath } from "@/lib/safe-next-path";

/**
 * Một widget cho cả hai nút, nên route Zalo start và `googleLogin` đều kiểm
 * token với đúng action này.
 */
const EXCHANGE_ACTION = "exchange_login";

/** Mã `?error=` mà /api/auth/zalo/* có thể trả về (Task 8). */
const ERROR_CODES = [
  "origin",
  "config",
  "captcha",
  "rate",
  "state",
  "denied",
  "exchange",
  "profile",
  "region",
  "blocked",
  "server",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

function asErrorCode(raw: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(raw)
    ? (raw as ErrorCode)
    : "server";
}

/**
 * Đăng nhập vùng giao lưu: Zalo (form POST, chạy được trong trình duyệt của
 * Zalo vì không cần popup) và Google. Cả hai dùng chung một token Turnstile;
 * token dùng một lần nên phải xin token mới (`resetKey`) sau mỗi lần gọi
 * Google và sau khi gửi form Zalo.
 */
export function ExchangeLoginForm({
  next,
  error,
}: {
  /** Giá trị thô từ URL; luôn đi qua `safeNextPath` trước khi dùng. */
  next?: string;
  /** Mã lỗi thô từ `?error=`; mã lạ rơi về thông báo chung. */
  error?: string;
}) {
  const t = useTranslations("exchangeLogin");
  const router = useRouter();
  const locale = useLocale();
  const target = safeNextPath(next);

  // Cùng một token ở hai nơi: state để khoá/mở nút Zalo và điền input ẩn, ref
  // để callback của nút Google (SDK vẽ một lần, giữ closure cũ) đọc bản mới nhất.
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [googleState, setGoogleState] = useState<"loading" | "ready" | "off">(
    "loading",
  );
  const [googleError, setGoogleError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleToken = useCallback((value: string | null) => {
    tokenRef.current = value;
    setToken(value);
  }, []);
  const onCredentialRef = useRef<(idToken: string) => void>(() => {});

  const handleGoogleCredential = (idToken: string) => {
    const turnstileToken = tokenRef.current;
    if (!turnstileToken) {
      setGoogleError(t("googleNeedsCheck"));
      return;
    }
    setGoogleError("");
    startTransition(async () => {
      try {
        const result = await googleLogin(idToken, {
          intent: "exchange",
          turnstileToken,
        });
        if (result.error) {
          setGoogleError(result.error);
          return;
        }
        router.replace(target);
        router.refresh();
      } catch {
        // Lỗi mạng/5xx làm server action ném: không để nút im lặng. Không log
        // `err` vì nó có thể mang nội dung phản hồi.
        console.error("[ExchangeLogin] googleLogin failed");
        setGoogleError(t("errors.server"));
      } finally {
        // Token đã tiêu dù thành công, lỗi hay ném lỗi.
        setResetKey((k) => k + 1);
      }
    });
  };
  useEffect(() => {
    onCredentialRef.current = handleGoogleCredential;
  });

  // Google không cho đăng nhập trong webview nhúng (Facebook, Zalo), mà phần
  // lớn người dùng mở link ngay trong Zalo: bỏ phần Google, Zalo vẫn chạy.
  useEffect(() => {
    let cancelled = false;
    const outcome: Promise<"ready" | "off"> =
      isInFacebookBrowser() || isInZaloBrowser()
        ? Promise.resolve("off")
        : initGoogleSDK().then(
            () => "ready" as const,
            (err: unknown) => {
              console.error("Google SDK init failed:", err);
              return "off" as const;
            },
          );
    outcome.then((state) => {
      if (!cancelled) setGoogleState(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Callback ref (không dùng useEffect) để vẽ nút đúng lúc node gắn vào DOM,
  // tránh race giữa "SDK sẵn sàng" và "node đã mount" như facebook-login-gate.
  const mountGoogleButton = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || googleState !== "ready") return;
      try {
        const width = Math.min(400, Math.max(240, node.offsetWidth || 320));
        renderGoogleButton(
          node,
          (idToken) => onCredentialRef.current(idToken),
          {
            width,
            locale,
          },
        );
      } catch (err) {
        console.error("Google button render failed", err);
      }
    },
    [googleState, locale],
  );

  const urlError = error ? t(`errors.${asErrorCode(error)}`) : "";
  const shownError = googleError || urlError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto w-full max-w-md space-y-4 pb-36 sm:pb-0"
    >
      <Link
        href="/giao-luu"
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-2 text-base"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
        {t("back")}
      </Link>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground text-base">{t("subtitle")}</p>
      </div>

      {shownError && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-base"
        >
          {shownError}
        </p>
      )}

      <Card className="bg-card/80 backdrop-blur">
        <CardContent className="space-y-4 p-4 sm:p-6">
          {/* Ngoài các nhánh Google: widget phải còn khi Google bị ẩn hay lỗi. */}
          <TurnstileWidget
            action={EXCHANGE_ACTION}
            onToken={handleToken}
            resetKey={resetKey}
          />

          {googleState === "loading" && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="mx-auto h-4 w-16" />
              <Skeleton className="h-11 w-full rounded-full" />
            </div>
          )}

          {googleState === "ready" && (
            <div className="space-y-4">
              <div className="relative py-2">
                <div className="absolute inset-x-0 top-1/2 border-t" />
                <div className="bg-card text-muted-foreground relative mx-auto w-fit px-3 text-base">
                  {t("orDivider")}
                </div>
              </div>
              <div className="relative flex min-h-11 justify-center">
                <div
                  ref={mountGoogleButton}
                  className={isPending ? "opacity-50" : undefined}
                />
                {isPending && (
                  <Loader2
                    className="text-muted-foreground absolute top-1/2 left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-spin"
                    aria-hidden
                  />
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nút chính dính đáy trên mobile (tầm ngón cái). Form POST thay vì
          server action để chạy cả trong trình duyệt của Zalo. */}
      <form
        method="post"
        action="/api/auth/zalo/start"
        // Hoãn một nhịp: bump ngay trong handler sẽ xoá input ẩn trước khi
        // trình duyệt lấy dữ liệu form. Token gửi đi là đã tiêu, nên phải xin
        // mới để quay lại bằng bfcache không còn nút mở với token chết.
        onSubmit={() => setTimeout(() => setResetKey((k) => k + 1), 0)}
        className="bg-background/95 fixed inset-x-0 bottom-0 z-30 space-y-2 border-t p-3 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0"
      >
        <input type="hidden" name="cf-turnstile-response" value={token ?? ""} />
        <input type="hidden" name="next" value={target} />
        {!token && (
          <p className="text-muted-foreground text-center text-base">
            {t("checking")}
          </p>
        )}
        <Button
          type="submit"
          disabled={!token}
          className="min-h-12 w-full gap-2 text-base"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          {t("zalo")}
        </Button>
      </form>
    </motion.div>
  );
}
