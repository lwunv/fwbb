"use client";

import { useState, useEffect, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  initFacebookSDK,
  checkLoginStatus,
  loginWithFacebook,
  isInFacebookBrowser,
} from "@/lib/facebook-sdk";
import { facebookLogin } from "@/actions/fb-auth";

export function FacebookLoginGate({ appName = "FWBB" }: { appName?: string }) {
  const [error, setError] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("fbLogin");
  const isIAB = typeof navigator !== "undefined" && isInFacebookBrowser();

  // Initialize FB SDK and attempt auto-login in IAB
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await initFacebookSDK();
        if (cancelled) return;
        setSdkReady(true);

        // In IAB, try auto-login
        if (isInFacebookBrowser()) {
          const status = await checkLoginStatus();
          if (cancelled) return;

          if (status.status === "connected" && status.authResponse) {
            // Auto-login silently
            startTransition(async () => {
              const result = await facebookLogin(
                status.authResponse!.accessToken,
              );
              if (result.error) {
                setError(result.error);
              }
              // On success, layout re-renders
            });
          }
          setAutoLoginAttempted(true);
        } else {
          setAutoLoginAttempted(true);
        }
      } catch {
        if (!cancelled) {
          setAutoLoginAttempted(true);
          setSdkReady(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = () => {
    setError("");
    startTransition(async () => {
      try {
        const auth = await loginWithFacebook();
        const result = await facebookLogin(auth.accessToken);
        if (result.error) {
          setError(result.error);
        }
        // On success, layout re-renders via revalidatePath
      } catch {
        setError(t("loginCancelled"));
      }
    });
  };

  const handleRetrySDK = () => {
    setError("");
    setSdkReady(false);
    setAutoLoginAttempted(false);
    // Re-trigger by forcing re-mount would be complex, just reload
    window.location.reload();
  };

  // Show loading while SDK initializes or auto-login is in progress
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
        ) : sdkReady ? (
          <Button
            onClick={handleLogin}
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
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-destructive text-sm">{t("sdkLoadFailed")}</p>
            <Button variant="outline" onClick={handleRetrySDK} size="sm">
              {t("retry")}
            </Button>
          </div>
        )}

        {error && (
          <p className="text-destructive text-center text-sm">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
