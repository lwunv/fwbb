"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  type FormEvent,
} from "react";
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
import { LanguageCardPicker } from "@/components/shared/language-selector";
import { updateMyProfile, type UpdateMyProfileState } from "@/actions/members";
import { fireAction } from "@/lib/optimistic-action";
import { usePolling } from "@/lib/use-polling";
import {
  LogOut,
  Wallet,
  Sun,
  Moon,
  Heart,
  Banknote,
  PiggyBank,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

/** Đồng bộ `globals.css` — nền full thẻ + màu chữ/icon khi chưa chọn */
const THEME_CARD = {
  light: {
    bg: "var(--theme-preview-light-bg)",
    fg: "var(--theme-preview-light-fg)",
    primary: "var(--theme-preview-light-primary)",
    border: "var(--theme-preview-light-border)",
  },
  dark: {
    bg: "var(--theme-preview-dark-bg)",
    fg: "var(--theme-preview-dark-fg)",
    primary: "var(--theme-preview-dark-primary)",
    border: "var(--theme-preview-dark-border)",
  },
  pink: {
    bg: "var(--theme-preview-pink-bg)",
    fg: "var(--theme-preview-pink-fg)",
    primary: "var(--theme-preview-pink-primary)",
    border: "var(--theme-preview-pink-border)",
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
  avatarUrl: string | null;
  memberName: string;
  memberNickname: string | null;
  totalSpentThisMonth: number;
  outstandingDebt: number;
  fundBalance: number | null;
}

export function MeClient({
  memberId,
  avatarKey,
  avatarUrl,
  memberName,
  memberNickname,
  totalSpentThisMonth,
  outstandingDebt,
  fundBalance,
}: MeClientProps) {
  const { setTheme } = useTheme();
  const [activeTheme, setActiveTheme] = useState<ThemeKey>("light");

  const syncThemeFromDom = useCallback(() => {
    setActiveTheme(inferThemeFromHtml());
  }, []);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- DOM class is the source of truth for next-themes hydration.
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

  // "Adjusting state on a prop change" pattern from React docs — avoids the
  // cascade-render warning of doing setState inside useEffect. We compare the
  // previous prop value during render and reset draft synchronously when it
  // changes.
  const [nicknameDraft, setNicknameDraft] = useState(memberNickname ?? "");
  const [prevMemberNickname, setPrevMemberNickname] = useState(memberNickname);
  if (memberNickname !== prevMemberNickname) {
    setPrevMemberNickname(memberNickname);
    setNicknameDraft(memberNickname ?? "");
  }

  function handleProfileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("nickname", nicknameDraft);
    fireAction(
      async () => {
        const r: UpdateMyProfileState = await updateMyProfile(null, fd);
        if (r && "error" in r) return { error: r.error };
        return { success: true as const };
      },
      () => setNicknameDraft(memberNickname ?? ""),
      { onSuccess: () => router.refresh() },
    );
  }

  const themes = [
    { key: "light", label: tThemes("light"), icon: Sun },
    { key: "dark", label: tThemes("dark"), icon: Moon },
    { key: "pink", label: tThemes("pink"), icon: Heart },
  ] as const;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {/* Profile Card */}
      <Card>
        <CardContent className="space-y-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="shrink-0">
              <MemberAvatar
                memberId={memberId}
                avatarKey={avatarKey}
                avatarUrl={avatarUrl}
                size={48}
              />
            </div>
            <p
              className="text-foreground min-w-0 flex-1 truncate text-xl font-medium"
              aria-label={tMe("legalNameLabel")}
            >
              {memberName}
            </p>
            <form
              action="/api/reset-identity"
              method="POST"
              className="shrink-0"
            >
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="gap-1 whitespace-nowrap"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                {tMe("signOut")}
              </Button>
            </form>
          </div>

          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="me-nickname">{tMe("nicknameLabel")}</Label>
              <Input
                id="me-nickname"
                name="nickname"
                type="text"
                value={nicknameDraft}
                onChange={(e) => setNicknameDraft(e.target.value)}
                autoComplete="nickname"
                placeholder={tMe("nicknamePlaceholder")}
                maxLength={40}
              />
            </div>
            <Button type="submit" className="w-full">
              {tMe("saveProfile")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardContent className="space-y-4">
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label={tMe("appearance")}
          >
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
                    "flex min-h-[4.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "border-primary ring-primary/35 ring-offset-background text-primary ring-2 ring-offset-2"
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
                    className="text-center leading-tight"
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
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Link
              href="/history"
              className="hover:bg-foreground/[0.04] grid grid-rows-[2.5rem_1.5rem_2.5rem] place-items-center gap-1.5 rounded-lg p-1 text-center transition-colors active:scale-[0.98]"
              aria-label={tStats("totalSpentThisMonth")}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15 dark:bg-yellow-500/20">
                <Wallet className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              </div>
              <p className="text-lg leading-none font-bold text-yellow-600 tabular-nums dark:text-yellow-400">
                {formatK(totalSpentThisMonth)}
              </p>
              <p className="inline-flex max-w-[7rem] items-center justify-center gap-0.5 text-xs leading-snug font-medium text-yellow-700 dark:text-yellow-400/90">
                {tStats("totalSpentThisMonth")}
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
              </p>
            </Link>
            <Link
              href="/my-fund"
              className="hover:bg-foreground/[0.04] grid grid-rows-[2.5rem_1.5rem_2.5rem] place-items-center gap-1.5 rounded-lg p-1 text-center transition-colors active:scale-[0.98]"
              aria-label={tMe("myFund")}
            >
              <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <PiggyBank className="h-5 w-5 shrink-0" />
              </div>
              <p className="text-primary text-lg leading-none font-bold tabular-nums">
                {formatK(fundBalance ?? 0)}
              </p>
              <p className="text-primary/80 inline-flex max-w-[7rem] items-center justify-center gap-0.5 text-xs leading-snug font-medium">
                {tMe("myFund")}
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
              </p>
            </Link>
            <Link
              href="/my-fund"
              className="hover:bg-foreground/[0.04] grid grid-rows-[2.5rem_1.5rem_2.5rem] place-items-center gap-1.5 rounded-lg p-1 text-center transition-colors active:scale-[0.98]"
              aria-label={tStats("outstandingDebt")}
            >
              <div className="bg-destructive/15 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                <Banknote className="text-destructive h-5 w-5 shrink-0" />
              </div>
              <p
                className={cn(
                  "text-lg leading-none font-bold tabular-nums",
                  outstandingDebt > 0
                    ? "text-destructive"
                    : "text-destructive/50 dark:text-destructive/60",
                )}
              >
                {formatK(outstandingDebt)}
              </p>
              <p className="text-destructive inline-flex max-w-[7rem] items-center justify-center gap-0.5 text-xs leading-snug font-medium">
                {tStats("outstandingDebt")}
                <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
              </p>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
