"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { initGoogleSDK, renderGoogleButton } from "@/lib/google-sdk";
import { linkAdminGoogle, unlinkAdminGoogle } from "@/actions/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, Loader2 } from "lucide-react";

/**
 * Section liên kết/gỡ Google ở /admin/account (Phase 4). Đã liên kết → nút gỡ
 * (unlinkAdminGoogle). Chưa → render nút GIS để liên kết (linkAdminGoogle).
 * SDK bị chặn khi chưa liên kết → chỉ hiện hướng dẫn, không có nút.
 */
export function AdminGoogleLink({ hasGoogle }: { hasGoogle: boolean }) {
  const t = useTranslations("adminAccount");
  const router = useRouter();
  const locale = useLocale();
  const [ready, setReady] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (hasGoogle) return; // đã liên kết → không cần SDK
    let cancelled = false;
    initGoogleSDK()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasGoogle]);

  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !ready) return;
      try {
        const width = Math.min(400, Math.max(240, node.offsetWidth || 320));
        renderGoogleButton(
          node,
          (idToken) => {
            startTransition(async () => {
              const r = await linkAdminGoogle(idToken);
              if (r && "error" in r && r.error) {
                toast.error(r.error);
                return;
              }
              toast.success(t("googleLinkedToast"));
              router.refresh();
            });
          },
          { width, locale },
        );
      } catch {
        /* GIS render lỗi → bỏ qua */
      }
    },
    [ready, locale, router, t],
  );

  function handleUnlink() {
    startTransition(async () => {
      const r = await unlinkAdminGoogle();
      if (r && "error" in r && r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(t("googleUnlinkedToast"));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {t("googleCardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasGoogle ? (
          <>
            <p className="text-muted-foreground text-sm">{t("googleLinked")}</p>
            <Button
              variant="outline"
              onClick={handleUnlink}
              disabled={pending}
              className="w-full"
              size="lg"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("unlinkGoogle")}
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {t("googleNotLinked")}
            </p>
            <div className="flex justify-center" ref={mount} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
