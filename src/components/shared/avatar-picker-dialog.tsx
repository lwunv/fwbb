"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { BRAND_PRESET_LIST } from "@/lib/member-avatar-presets";
import {
  AVATAR_EMOJI_COUNT,
  AVATAR_EMOJI_LIST,
  emojiAvatarKey,
} from "@/lib/member-avatar-emoji";
import { updateMyAvatar } from "@/actions/members";
import { fireAction } from "@/lib/optimistic-action";
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
  const [error, setError] = useState("");

  function select(key: string | null) {
    setError("");
    onOpenChange(false);
    fireAction(
      () => updateMyAvatar(key),
      () => {
        onOpenChange(true);
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("avatarPickerTitle")}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="max-h-[min(65vh,28rem)] space-y-4 overflow-y-auto pr-1">
          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t("avatarAutoTitle")}
            </h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => select(null)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-colors",
                  !currentAvatarKey
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/60",
                )}
              >
                <MemberAvatar memberId={memberId} avatarKey={null} size={44} />
                <span className="text-center text-xs leading-tight font-medium">
                  {t("avatarDefault")}
                </span>
              </button>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
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
                    onClick={() => select(key)}
                    title={AVATAR_EMOJI_LIST[i]}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-xl border-2 p-1 transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <MemberAvatar
                      memberId={memberId}
                      avatarKey={key}
                      size={36}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t("avatarBrandTitle")}
            </h3>
            <div className="grid grid-cols-3 gap-2 pb-1 sm:grid-cols-4">
              {BRAND_PRESET_LIST.map((p) => {
                const active = currentAvatarKey === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => select(p.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-colors",
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <MemberAvatar
                      memberId={memberId}
                      avatarKey={p.id}
                      size={44}
                    />
                    <span className="text-center text-xs leading-tight font-medium">
                      {p.label}
                    </span>
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
