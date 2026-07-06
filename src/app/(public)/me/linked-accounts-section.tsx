"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link2, Loader2, Unlink, ShieldCheck } from "lucide-react";
import { useConfirm } from "@/components/shared/confirm-provider";
import { fireAction } from "@/lib/optimistic-action";
import { initGoogleSDK, renderGoogleButton } from "@/lib/google-sdk";
import { linkGoogleIdentity } from "@/actions/google-auth";
import { unlinkOAuthIdentity } from "@/actions/members";

interface LinkedIdentity {
  id: number;
  provider: "google" | "facebook";
  email: string | null;
  createdAt: string | null;
}

const PROVIDER_LABEL: Record<LinkedIdentity["provider"], string> = {
  google: "Google",
  facebook: "Facebook",
};

type GoogleStatus = "loading" | "ready" | "failed";

/**
 * /me: quản lý các tài khoản đăng nhập ngoài (Google/Facebook) đã liên kết vào
 * hồ sơ (multi-SSO). Cho liên kết THÊM Google (đăng nhập nhiều tài khoản Google
 * vào cùng 1 hồ sơ) và gỡ từng cái. Server chặn gỡ phương thức cuối khi chưa có
 * mật khẩu dùng được. FB login đang ẩn toàn site nên chỉ mở liên kết Google.
 */
export function LinkedAccountsSection({
  identities,
  hasPassword,
}: {
  identities: LinkedIdentity[];
  /** Mật khẩu DÙNG ĐƯỢC (đã loại temp hết hạn) — để biết có được gỡ hết OAuth không. */
  hasPassword: boolean;
}) {
  const t = useTranslations("me");
  const locale = useLocale();
  const router = useRouter();
  const confirm = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>("loading");
  const [removingId, setRemovingId] = useState<number | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  // Bản sao cục bộ để optimistic remove khi gỡ (rule optimistic-UI). Sync lại
  // theo prop sau mỗi router.refresh() để hội tụ với server.
  const [list, setList] = useState<LinkedIdentity[]>(identities);
  useEffect(() => {
    setList(identities);
  }, [identities]);

  // Chỉ còn 1 đường đăng nhập + chưa có mật khẩu dùng được → không cho gỡ.
  const cannotRemoveLast = list.length <= 1 && !hasPassword;

  useEffect(() => {
    let cancelled = false;
    initGoogleSDK()
      .then(() => {
        if (!cancelled) setGoogleStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setGoogleStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (googleStatus !== "ready" || !googleBtnRef.current) return;
    try {
      renderGoogleButton(
        googleBtnRef.current,
        (idToken) => {
          startTransition(async () => {
            try {
              const r = await linkGoogleIdentity(idToken);
              if (r && "error" in r && r.error) {
                toast.error(r.error);
                return;
              }
              toast.success(t("oauthLinkedToast"));
              router.refresh();
            } catch {
              toast.error(t("oauthLinkError"));
            }
          });
        },
        { width: 260, locale },
      );
    } catch {
      /* render fail hiếm — bỏ qua */
    }
  }, [googleStatus, locale, t, router]);

  function handleUnlink(identity: LinkedIdentity) {
    (async () => {
      const ok = await confirm({
        title: t("unlinkConfirmTitle"),
        description: t("unlinkConfirmDesc", {
          provider: PROVIDER_LABEL[identity.provider],
        }),
        confirmLabel: t("unlinkConfirmBtn"),
      });
      if (!ok) return;
      setRemovingId(identity.id);
      // Optimistic: bỏ khỏi list ngay; rollback nếu server báo lỗi.
      const prev = list;
      setList((cur) => cur.filter((i) => i.id !== identity.id));
      fireAction(
        () => unlinkOAuthIdentity(identity.id),
        () => setList(prev),
        {
          successMsg: t("oauthUnlinkedToast"),
          onSuccess: () => {
            setRemovingId(null);
            router.refresh();
          },
          onError: () => setRemovingId(null),
        },
      );
    })();
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 rounded-lg p-2">
            <ShieldCheck className="text-primary h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("linkedAccountsTitle")}</p>
            <p className="text-muted-foreground text-sm">
              {t("linkedAccountsDesc")}
            </p>
          </div>
        </div>

        {list.length > 0 ? (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {list.map((idn) => (
                <motion.li
                  key={idn.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  className="bg-muted/30 flex items-center gap-3 rounded-xl border px-3 py-2.5"
                >
                  <span className="bg-background flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold">
                    {idn.provider === "google" ? "G" : "f"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {PROVIDER_LABEL[idn.provider]}
                    </p>
                    {idn.email && (
                      <p className="text-muted-foreground truncate text-xs">
                        {idn.email}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cannotRemoveLast || removingId === idn.id}
                    onClick={() => handleUnlink(idn)}
                    className="text-destructive hover:bg-destructive/10 border-destructive/30 min-h-11 min-w-11 shrink-0 gap-1"
                  >
                    {removingId === idn.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Unlink className="h-4 w-4" />
                    )}
                    <span className="hidden sm:inline">{t("unlinkBtn")}</span>
                  </Button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noLinkedYet")}</p>
        )}

        {cannotRemoveLast && list.length > 0 && (
          <p className="text-muted-foreground text-xs">{t("lastMethodHint")}</p>
        )}

        {/* Liên kết thêm Google (đăng nhập nhiều tài khoản Google vào 1 hồ sơ) */}
        <div className="border-t pt-3">
          <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
            <Link2 className="h-3.5 w-3.5" />
            {t("linkMoreLabel")}
          </p>
          {isPending && (
            <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("linking")}
            </div>
          )}
          {googleStatus === "loading" && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("linking")}
            </div>
          )}
          {googleStatus === "ready" && (
            <div ref={googleBtnRef} className="flex" />
          )}
          {googleStatus === "failed" && (
            <p className="text-muted-foreground text-xs">
              {t("googleUnavailable")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
