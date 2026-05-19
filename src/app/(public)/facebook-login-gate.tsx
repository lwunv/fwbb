"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  initFacebookSDK,
  checkLoginStatus,
  loginWithFacebook,
  isInFacebookBrowser,
} from "@/lib/facebook-sdk";
import { initGoogleSDK, renderGoogleButton } from "@/lib/google-sdk";
import { facebookLogin } from "@/actions/fb-auth";
import { googleLogin } from "@/actions/google-auth";
import { PasswordAuthForm } from "./password-auth-form";

/**
 * OAuth login gate — Facebook + Google. Gọi là `FacebookLoginGate` vì
 * legacy + import sites cũ, nhưng giờ render cả 2 button.
 */
export function FacebookLoginGate({ appName = "FWBB" }: { appName?: string }) {
  const [error, setError] = useState("");
  const [fbReady, setFbReady] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("fbLogin");
  const locale = useLocale();
  const isIAB = typeof navigator !== "undefined" && isInFacebookBrowser();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  // Initialize Facebook SDK and attempt auto-login in IAB
  useEffect(() => {
    let cancelled = false;

    async function initFb() {
      try {
        await initFacebookSDK();
        if (cancelled) return;
        setFbReady(true);

        if (isInFacebookBrowser()) {
          const status = await checkLoginStatus();
          if (cancelled) return;
          if (status.status === "connected" && status.authResponse) {
            startTransition(async () => {
              const result = await facebookLogin(
                status.authResponse!.accessToken,
              );
              if (result.error) setError(result.error);
            });
          }
        }
        setAutoLoginAttempted(true);
      } catch {
        if (!cancelled) {
          setAutoLoginAttempted(true);
          setFbReady(false);
        }
      }
    }

    initFb();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize Google SDK + render official button. In IAB (Facebook in-app
  // browser), skip Google entirely — popups don't work properly there.
  useEffect(() => {
    if (isIAB) return;
    let cancelled = false;
    async function initGoogle() {
      try {
        await initGoogleSDK();
        if (cancelled) return;
        setGoogleReady(true);
      } catch {
        if (!cancelled) setGoogleReady(false);
      }
    }
    initGoogle();
    return () => {
      cancelled = true;
    };
  }, [isIAB]);

  // Render the Google button once SDK is ready and the ref is mounted.
  // Note: setState-in-effect intentionally avoided — if renderButton fails
  // (rare), user can still use FB login or refresh.
  useEffect(() => {
    if (!googleReady || !googleButtonRef.current) return;
    try {
      renderGoogleButton(
        googleButtonRef.current,
        (idToken) => {
          startTransition(async () => {
            const result = await googleLogin(idToken);
            if (result.error) setError(result.error);
          });
        },
        { width: 280, locale },
      );
    } catch (err) {
      console.error("Google button render failed", err);
    }
  }, [googleReady, locale]);

  const handleFbLogin = () => {
    setError("");
    startTransition(async () => {
      try {
        const auth = await loginWithFacebook();
        const result = await facebookLogin(auth.accessToken);
        if (result.error) setError(result.error);
      } catch {
        setError(t("loginCancelled"));
      }
    });
  };

  const handleRetrySDK = () => {
    setError("");
    setFbReady(false);
    setGoogleReady(false);
    setAutoLoginAttempted(false);
    window.location.reload();
  };

  const isLoading = !autoLoginAttempted || isPending;

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="space-y-6 p-6">
        <div className="space-y-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fwbb.svg" alt={appName} className="mx-auto h-16 w-auto" />
          <h1 className="text-xl font-bold">{appName}</h1>
          <p className="text-muted-foreground text-sm">
            {isLoading ? t("checking") : t("signInPrompt")}
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="text-primary h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Email/password form là primary — luôn ổn định, không phụ thuộc SDK */}
            <PasswordAuthForm />

            {/* Divider — chỉ hiện khi có ít nhất 1 OAuth provider khả dụng */}
            {(fbReady || (!isIAB && googleReady)) && (
              <div className="relative py-2">
                <div className="absolute inset-x-0 top-1/2 border-t" />
                <div className="bg-card text-muted-foreground relative mx-auto w-fit px-3 text-xs tracking-wider uppercase">
                  {t("orDivider")}
                </div>
              </div>
            )}

            {fbReady && (
              <Button
                onClick={handleFbLogin}
                disabled={isPending}
                className="w-full bg-[#1877F2] py-3 text-base font-medium text-white hover:bg-[#166FE5]"
                size="lg"
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <svg
                    className="mr-2 h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                )}
                {isIAB ? t("continueWithFacebook") : t("signInWithFacebook")}
              </Button>
            )}

            {/* Google button — chỉ render khi không trong IAB (popup không work) */}
            {!isIAB && googleReady && (
              <div className="flex justify-center" ref={googleButtonRef} />
            )}

            {/* Chỉ hiện retry khi CẢ HAI OAuth fail — single fail thường do env
                config (vd Google client id chưa set) nên reload không sửa. */}
            {!fbReady && (isIAB || !googleReady) && (
              <Button
                variant="outline"
                onClick={handleRetrySDK}
                size="sm"
                className="w-full"
              >
                {t("retry")}
              </Button>
            )}
          </div>
        )}

        {error && (
          <p className="text-destructive text-center text-sm">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
