"use client";

import { useActionState, useEffect, useLayoutEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { formatK } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { AvatarPickerDialog } from "@/components/shared/avatar-picker-dialog";
import { LanguageCardPicker } from "@/components/shared/language-selector";
import { updateMyProfile } from "@/actions/members";
import { usePolling } from "@/lib/use-polling";
import {
  LogOut,
  Beer,
  Wallet,
  Sun,
  Moon,
  Heart,
  Banknote,
} from "lucide-react";

/** Đồng bộ `globals.css` — nền full thẻ + màu chữ/icon khi chưa chọn */
const THEME_CARD = {
  light: {
    bg: "#FFFFFF",
    fg: "#1E293B",
    primary: "#6366F1",
    border: "#E2E8F0",
  },
  dark: {
    bg: "#0F172A",
    fg: "#F1F5F9",
    primary: "#818CF8",
    border: "#334155",
  },
  pink: {
    bg: "#FFF0F5",
    fg: "#831843",
    primary: "#EC4899",
    border: "#FBCFE8",
  },
} as const;

type ThemeKey = "light" | "dark" | "pink";

/** Nguồn đúng cho UI: class trên `<html>` (next-themes). Context đôi khi vẫn "light" khi DOM đã `dark`. */
function inferThemeFromHtml(): ThemeKey {
  if (typeof document === "undefined") return "light";
  const c = document.documentElement.classList;
  if (c.contains("pink")) return "pink";
  if (c.contains("dark")) return "dark";
  return "light";
}

interface MeClientProps {
  memberId: number;
  avatarKey: string | null;
  memberName: string;
  memberNickname: string | null;
  totalPlayed: number;
  totalDined: number;
  totalSpent: number;
  outstandingDebt: number;
}

export function MeClient({
  memberId,
  avatarKey,
  memberName,
  memberNickname,
  totalPlayed,
  totalDined,
  totalSpent,
  outstandingDebt,
}: MeClientProps) {
  const { setTheme } = useTheme();
  const [activeTheme, setActiveTheme] = useState<ThemeKey>("light");
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const syncThemeFromDom = useCallback(() => {
    setActiveTheme(inferThemeFromHtml());
  }, []);

  useLayoutEffect(() => {
    syncThemeFromDom();
  }, [syncThemeFromDom]);

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => syncThemeFromDom());
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [syncThemeFromDom]);

  const router = useRouter();
  const tThemes = useTranslations("themes");
  const tMe = useTranslations("me");
  const tStats = useTranslations("stats");

  usePolling();

  const [profileState, profileAction, profilePending] = useActionState(
    updateMyProfile,
    null,
  );

  useEffect(() => {
    if (profileState && "success" in profileState && profileState.success) {
      router.refresh();
    }
  }, [profileState, router]);

  const themes = [
    { key: "light", label: tThemes("light"), icon: Sun },
    { key: "dark", label: tThemes("dark"), icon: Moon },
    { key: "pink", label: tThemes("pink"), icon: Heart },
  ] as const;

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <AvatarPickerDialog
        memberId={memberId}
        currentAvatarKey={avatarKey}
        open={avatarPickerOpen}
        onOpenChange={setAvatarPickerOpen}
      />
      {/* Profile Card */}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setAvatarPickerOpen(true)}
              className="rounded-full ring-offset-background shrink-0 transition-[box-shadow,transform] hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
              aria-label={tMe("changeAvatar")}
            >
              <MemberAvatar memberId={memberId} avatarKey={avatarKey} size={48} />
            </button>
            <p
              className="min-w-0 flex-1 truncate text-xl font-medium text-foreground"
              aria-label={tMe("legalNameLabel")}
            >
              {memberName}
            </p>
            <form action="/api/reset-identity" method="POST" className="shrink-0">
              <Button type="submit" variant="outline" size="sm" className="whitespace-nowrap gap-1">
                <LogOut className="h-4 w-4 shrink-0" />
                {tMe("signOut")}
              </Button>
            </form>
          </div>

          <form action={profileAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="me-nickname">
                {tMe("nicknameLabel")}</Label>
              <Input
                id="me-nickname"
                name="nickname"
                type="text"
                defaultValue={memberNickname ?? ""}
                autoComplete="nickname"
                placeholder={tMe("nicknamePlaceholder")}
                maxLength={40}
                disabled={profilePending}
              />
            </div>
            {profileState && "error" in profileState && (
              <p className="text-sm text-destructive">{profileState.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={profilePending}>
              {profilePending ? tMe("savingProfile") : tMe("saveProfile")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardContent className="space-y-4">
          <div className="flex gap-2" role="radiogroup" aria-label={tMe("appearance")}>
            {themes.map((th) => {
              const Icon = th.icon;
              const isActive = activeTheme === th.key;
              const s = THEME_CARD[th.key as keyof typeof THEME_CARD];
              return (
                <button
                  key={th.key}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => {
                    setTheme(th.key);
                    setActiveTheme(th.key);
                  }}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-1.5 py-2.5 text-xs font-medium transition-colors min-h-[4.25rem]",
                    isActive
                      ? "border-primary ring-2 ring-primary/35 ring-offset-2 ring-offset-background text-primary"
                      : "text-muted-foreground hover:border-primary/40",
                  )}
                  style={{
                    backgroundColor: s.bg,
                    borderColor: isActive ? "var(--primary)" : s.border,
                  }}
                >
                  <Icon
                    className="h-5 w-5 shrink-0"
                    style={{ color: isActive ? undefined : s.primary }}
                  />
                  <span
                    className="leading-tight text-center"
                    style={{ color: isActive ? undefined : s.fg }}
                  >
                    {th.label}
                  </span>
                </button>
              );
            })}
          </div>
          <LanguageCardPicker />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-3">
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl leading-none select-none"
                aria-hidden
              >
                🏸
              </div>
              <p className="text-lg font-bold tabular-nums leading-none text-violet-600 dark:text-violet-400">
                {totalPlayed}
              </p>
              <p className="min-h-8 max-w-[7rem] text-[11px] leading-snug text-muted-foreground">
                {tStats("sessionsPlayed")}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                <Beer className="h-5 w-5 text-amber-500 dark:text-amber-400" />
              </div>
              <p className="text-lg font-bold tabular-nums leading-none text-orange-600 dark:text-orange-400">
                {totalDined}
              </p>
              <p className="min-h-8 max-w-[7rem] text-[11px] leading-snug text-muted-foreground">
                {tStats("sessionsDined")}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15 dark:bg-yellow-500/20">
                <Wallet className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              </div>
              <p className="text-lg font-bold tabular-nums leading-none text-yellow-600 dark:text-yellow-400">
                {formatK(totalSpent)}
              </p>
              <p className="min-h-8 max-w-[7rem] text-[11px] font-medium leading-snug text-yellow-700 dark:text-yellow-400/90">
                {tStats("totalSpent")}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                <Banknote className="h-5 w-5 shrink-0 text-destructive" />
              </div>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums leading-none",
                  outstandingDebt > 0
                    ? "text-destructive"
                    : "text-destructive/50 dark:text-destructive/60",
                )}
              >
                {formatK(outstandingDebt)}
              </p>
              <p className="min-h-8 max-w-[7rem] text-[11px] font-medium leading-snug text-destructive">
                {tStats("outstandingDebt")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
