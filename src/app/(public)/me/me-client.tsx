"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
  Wallet,
  Sun,
  Moon,
  Heart,
  Banknote,
  PiggyBank,
  ChevronRight,
  ChevronDown,
  Pencil,
  Loader2,
  Check,
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
  memberUsername: string | null;
  memberPhone: string | null;
  memberEmail: string | null;
  defaultWithPartner: boolean;
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
  memberUsername,
  memberPhone,
  memberEmail,
  defaultWithPartner,
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

  // Username / SĐT / Email drafts — cùng pattern sync-on-prop-change.
  const [usernameDraft, setUsernameDraft] = useState(memberUsername ?? "");
  const [prevUsername, setPrevUsername] = useState(memberUsername);
  if (memberUsername !== prevUsername) {
    setPrevUsername(memberUsername);
    setUsernameDraft(memberUsername ?? "");
  }
  const [phoneDraft, setPhoneDraft] = useState(memberPhone ?? "");
  const [prevPhone, setPrevPhone] = useState(memberPhone);
  if (memberPhone !== prevPhone) {
    setPrevPhone(memberPhone);
    setPhoneDraft(memberPhone ?? "");
  }
  const [emailDraft, setEmailDraft] = useState(memberEmail ?? "");
  const [prevEmail, setPrevEmail] = useState(memberEmail);
  if (memberEmail !== prevEmail) {
    setPrevEmail(memberEmail);
    setEmailDraft(memberEmail ?? "");
  }

  // "Đi 2 người" mặc định của acc — sync theo prop sau revalidate (cùng pattern).
  const [withPartner, setWithPartner] = useState(defaultWithPartner);
  const [prevWithPartner, setPrevWithPartner] = useState(defaultWithPartner);
  if (defaultWithPartner !== prevWithPartner) {
    setPrevWithPartner(defaultWithPartner);
    setWithPartner(defaultWithPartner);
  }

  // Pending + "đã lưu" feedback cho nút Lưu: trước đây bấm xong im lặng (không
  // spinner, không toast) → user không biết đã lưu chưa.
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Gom cụm sửa thông tin vào toggle (mặc định thu gọn) — trang /me gọn hơn,
  // các field chỉ hiện khi user chủ động bấm "Sửa thông tin".
  const [editOpen, setEditOpen] = useState(false);

  function handleProfileSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setJustSaved(false);
    const fd = new FormData();
    fd.set("nickname", nicknameDraft);
    fd.set("withPartner", withPartner ? "1" : "0");
    fd.set("username", usernameDraft);
    fd.set("phoneNumber", phoneDraft);
    fd.set("email", emailDraft);
    fireAction(
      async () => {
        const r: UpdateMyProfileState = await updateMyProfile(null, fd);
        if (r && "error" in r) return { error: r.error };
        return { success: true as const };
      },
      () => setNicknameDraft(memberNickname ?? ""),
      {
        successMsg: tMe("profileSaved"),
        onSuccess: () => {
          setSaving(false);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
          router.refresh();
        },
        onError: () => setSaving(false),
      },
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
          </div>

          {/* Toggle mở cụm sửa thông tin — mặc định thu gọn cho gọn trang. */}
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            aria-expanded={editOpen}
            className="hover:bg-muted/30 -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Pencil className="text-muted-foreground h-4 w-4 shrink-0" />
              {tMe("editProfileToggle")}
            </span>
            <ChevronDown
              className={cn(
                "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
                editOpen && "rotate-180",
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {editOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <form onSubmit={handleProfileSubmit} className="space-y-3 pt-1">
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
                  <div className="space-y-1.5">
                    <Label htmlFor="me-username">{tMe("usernameLabel")}</Label>
                    <Input
                      id="me-username"
                      name="username"
                      type="text"
                      value={usernameDraft}
                      onChange={(e) => setUsernameDraft(e.target.value)}
                      autoComplete="username"
                      placeholder={tMe("usernamePlaceholder")}
                      maxLength={32}
                    />
                    <p className="text-muted-foreground text-xs">
                      {tMe("usernameHint")}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="me-phone">{tMe("phoneLabel")}</Label>
                    <Input
                      id="me-phone"
                      name="phoneNumber"
                      type="tel"
                      inputMode="tel"
                      value={phoneDraft}
                      onChange={(e) => setPhoneDraft(e.target.value)}
                      autoComplete="tel"
                      placeholder={tMe("phonePlaceholder")}
                      maxLength={20}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="me-email">{tMe("emailLabel")}</Label>
                    <Input
                      id="me-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      autoComplete="email"
                      placeholder={tMe("emailPlaceholder")}
                      maxLength={200}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setWithPartner((v) => !v)}
                    aria-pressed={withPartner}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                      withPartner
                        ? "border-primary bg-primary/[0.06]"
                        : "border-border bg-background hover:border-primary/40",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-lg leading-none" aria-hidden>
                        👫
                      </span>
                      {tMe("withPartnerLabel")}
                    </span>
                    <span
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                        withPartner ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
                          withPartner ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </button>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={saving}
                    aria-live="polite"
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : justSaved ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : null}
                    {saving
                      ? tMe("saving")
                      : justSaved
                        ? tMe("profileSaved")
                        : tMe("saveProfile")}
                  </Button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
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
              <p className="inline-flex max-w-[7rem] items-center justify-center gap-0.5 text-sm leading-snug font-medium text-yellow-700 dark:text-yellow-400/90">
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
              <p className="text-primary/80 inline-flex max-w-[7rem] items-center justify-center gap-0.5 text-sm leading-snug font-medium">
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
              <p className="text-destructive inline-flex max-w-[7rem] items-center justify-center gap-0.5 text-sm leading-snug font-medium">
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
