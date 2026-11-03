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
import { isInFacebookBrowser } from "@/lib/facebook-sdk";
import { googleLogin } from "@/actions/google-auth";
import { safeNextPath } from "@/lib/safe-next-path";

/** Server kiểm `action` của token, nên mỗi nút có widget với action riêng. */
const ZALO_ACTION = "zalo_login";
const GOOGLE_ACTION = "google_login";

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
 * Zalo vì không cần popup) và Google. Cả hai đều đòi token Turnstile; token
 * dùng một lần nên sau mỗi lần gọi Google phải xin token mới (`resetKey`).
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

  const [zaloToken, setZaloToken] = useState<string | null>(null);
  const [googleResetKey, setGoogleResetKey] = useState(0);
  const [googleState, setGoogleState] = useState<"loading" | "ready" | "off">(
    "loading",
  );
  const [googleError, setGoogleError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Token Google đọc qua ref: nút Google do SDK vẽ một lần và giữ callback cũ,
  // nên closure sẽ kẹt ở token của lúc vẽ.
  const googleTokenRef = useRef<string | null>(null);
  const onCredentialRef = useRef<(idToken: string) => void>(() => {});

  const handleGoogleCredential = (idToken: string) => {
    const token = googleTokenRef.current;
    if (!token) {
      setGoogleError(t("googleNeedsCheck"));
      return;
    }
    setGoogleError("");
    startTransition(async () => {
      const result = await googleLogin(idToken, {
        intent: "exchange",
        turnstileToken: token,
      });
      // Token đã tiêu dù thành công hay lỗi.
      setGoogleResetKey((k) => k + 1);
      if (result.error) {
        setGoogleError(result.error);
        return;
      }
      router.replace(target);
      router.refresh();
    });
  };
  useEffect(() => {
    onCredentialRef.current = handleGoogleCredential;
  });

  // Trong trình duyệt của Facebook popup Google không chạy: bỏ hẳn phần Google.
  useEffect(() => {
    let cancelled = false;
    const outcome: Promise<"ready" | "off"> = isInFacebookBrowser()
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
          <TurnstileWidget
            action={ZALO_ACTION}
            onToken={setZaloToken}
            resetKey={0}
          />

          {googleState === "loading" && (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="mx-auto h-4 w-16" />
              <Skeleton className="h-[65px] w-full rounded-lg" />
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
              <TurnstileWidget
                action={GOOGLE_ACTION}
                onToken={(token) => {
                  googleTokenRef.current = token;
                }}
                resetKey={googleResetKey}
              />
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
        className="bg-background/95 fixed inset-x-0 bottom-0 z-30 space-y-2 border-t p-3 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0"
      >
        <input
          type="hidden"
          name="cf-turnstile-response"
          value={zaloToken ?? ""}
        />
        <input type="hidden" name="next" value={target} />
        {!zaloToken && (
          <p className="text-muted-foreground text-center text-base">
            {t("checking")}
          </p>
        )}
        <Button
          type="submit"
          disabled={!zaloToken}
          className="min-h-12 w-full gap-2 text-base"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          {t("zalo")}
        </Button>
      </form>
    </motion.div>
  );
}
