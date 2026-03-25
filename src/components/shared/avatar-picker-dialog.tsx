"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { BRAND_PRESET_LIST } from "@/lib/member-avatar-presets";
import { AVATAR_EMOJI_COUNT, AVATAR_EMOJI_LIST, emojiAvatarKey } from "@/lib/member-avatar-emoji";
import { updateMyAvatar } from "@/actions/members";
import { cn } from "@/lib/utils";

interface AvatarPickerDialogProps {
  memberId: number;
  currentAvatarKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AvatarPickerDialog({
  memberId,
  currentAvatarKey,
  open,
  onOpenChange,
}: AvatarPickerDialogProps) {
  const t = useTranslations("me");
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function select(key: string | null) {
    setError("");
    startTransition(async () => {
      const result = await updateMyAvatar(key);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{t("avatarPickerTitle")}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-[min(65vh,28rem)] overflow-y-auto space-y-4 pr-1">
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("avatarAutoTitle")}
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => select(null)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-colors",
                  !currentAvatarKey
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/60",
                )}
              >
                <MemberAvatar memberId={memberId} avatarKey={null} size={44} />
                <span className="text-[10px] font-medium text-center leading-tight">{t("avatarDefault")}</span>
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("avatarEmojiTitle")}
            </h3>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {Array.from({ length: AVATAR_EMOJI_COUNT }, (_, i) => {
                const key = emojiAvatarKey(i);
                const active = currentAvatarKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={pending}
                    onClick={() => select(key)}
                    title={AVATAR_EMOJI_LIST[i]}
                    className={cn(
                      "flex items-center justify-center rounded-xl border-2 p-1 transition-colors aspect-square",
                      active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60",
                    )}
                  >
                    <MemberAvatar memberId={memberId} avatarKey={key} size={36} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("avatarBrandTitle")}
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 pb-1">
              {BRAND_PRESET_LIST.map((p) => {
                const active = currentAvatarKey === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={pending}
                    onClick={() => select(p.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-colors",
                      active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60",
                    )}
                  >
                    <MemberAvatar memberId={memberId} avatarKey={p.id} size={44} />
                    <span className="text-[10px] font-medium text-center leading-tight">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
