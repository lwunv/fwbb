"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { initGoogleSDK, renderGoogleButton } from "@/lib/google-sdk";
import { adminGoogleLogin } from "@/actions/auth";

/**
 * Nút "Đăng nhập bằng Google" cho admin (Phase 4). Render nút GIS chính chủ qua
 * callback ref (giống FacebookLoginGate). idToken → adminGoogleLogin → nếu
 * google_id đã liên kết 1 admin thì cấp cookie admin, client điều hướng
 * /admin/dashboard. SDK bị chặn/không load → ẩn nút (admin vẫn login được bằng
 * username/mật khẩu).
 */
export function AdminGoogleSignin() {
  const t = useTranslations("auth");
  const router = useRouter();
  const locale = useLocale();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    initGoogleSDK()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !ready) return;
      try {
        const width = Math.min(400, Math.max(240, node.offsetWidth || 320));
        renderGoogleButton(
          node,
          (idToken) => {
            setError("");
            startTransition(async () => {
              const r = await adminGoogleLogin(idToken);
              if (r && "error" in r && r.error) {
                setError(r.error);
                return;
              }
              router.push("/admin/dashboard");
              router.refresh();
            });
          },
          { width, locale },
        );
      } catch {
        /* GIS render lỗi → bỏ qua, giữ form username/password */
      }
    },
    [ready, locale, router],
  );

  // SDK chưa sẵn (hoặc bị chặn) → không render gì (fallback: login username/pw).
  if (!ready) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="relative py-1">
        <div className="absolute inset-x-0 top-1/2 border-t" />
        <div className="bg-card text-muted-foreground relative mx-auto w-fit px-3 text-xs tracking-wider uppercase">
          {t("orDivider")}
        </div>
      </div>
      <div className="flex justify-center" ref={mount} />
      {error && <p className="text-destructive text-center text-sm">{error}</p>}
    </div>
  );
}
