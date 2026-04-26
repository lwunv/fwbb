"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LocaleFlag,
  type LocaleFlagCountry,
} from "@/components/shared/locale-flag";

export const LOCALE_CODES = ["vi", "en", "zh"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

export function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "vi";
  const match = document.cookie.match(/(?:^|; )locale=([^;]*)/);
  const raw = match?.[1];
  if (raw && LOCALE_CODES.includes(raw as LocaleCode)) return raw;
  return "vi";
}

export function setLocaleCookie(locale: string) {
  document.cookie = `locale=${locale};path=/;max-age=${365 * 24 * 60 * 60}`;
  window.location.reload();
}

const LANG_CARDS: { code: LocaleCode; country: LocaleFlagCountry }[] = [
  { code: "vi", country: "vn" },
  { code: "en", country: "gb" },
  { code: "zh", country: "cn" },
];

function countryForLocale(code: string): LocaleFlagCountry {
  return LANG_CARDS.find((x) => x.code === code)?.country ?? "vn";
}

/** Chọn ngôn ngữ dạng thẻ (trang /me) */
export function LanguageCardPicker({ className }: { className?: string }) {
  const t = useTranslations("language");
  const [mounted, setMounted] = useState(false);
  const [locale, setLocale] = useState<string>("vi");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cookie locale is only readable on the client after hydration.
    setMounted(true);
    setLocale(getLocaleFromCookie());
  }, []);

  if (!mounted) {
    return (
      <div
        className={cn("flex gap-2", className)}
        role="group"
        aria-label={t("label")}
      >
        {LANG_CARDS.map((item) => (
          <div
            key={item.code}
            className="bg-muted/60 h-[4.25rem] flex-1 animate-pulse rounded-lg"
            aria-hidden
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn("flex gap-2", className)}
      role="radiogroup"
      aria-label={t("label")}
    >
      {LANG_CARDS.map(({ code, country }) => {
        const isActive = locale === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => {
              if (code !== locale) setLocaleCookie(code);
            }}
            className={cn(
              "flex min-h-[4.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1.5 py-2.5 text-xs font-medium transition-colors",
              isActive
                ? "border-primary ring-primary/35 ring-offset-background text-primary ring-2 ring-offset-2"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            <LocaleFlag
              country={country}
              className="h-7 w-[42px] border border-black/10 dark:border-white/15"
            />
            <span className="text-center leading-tight">{t(code)}</span>
          </button>
        );
      })}
    </div>
  );
}

interface LanguageSelectorProps {
  className?: string;
}

/** Header: menu tùy chỉnh (thay thế select mặc định của trình duyệt) */
export function LanguageSelector({ className }: LanguageSelectorProps) {
  const t = useTranslations("language");
  const [mounted, setMounted] = useState(false);
  const [locale, setLocale] = useState<string>("vi");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cookie locale is only readable on the client after hydration.
    setMounted(true);
    setLocale(getLocaleFromCookie());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted) {
    return (
      <div
        className={cn(
          "bg-muted/60 h-9 w-[8.25rem] animate-pulse rounded-xl",
          className,
        )}
        aria-hidden
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative w-[min(11rem,calc(100vw-8.5rem))] shrink-0",
        className,
      )}
    >
      <button
        type="button"
        id="header-language-trigger"
        aria-label={t("label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "border-border bg-card text-foreground flex h-9 w-full items-center justify-between gap-1.5 rounded-xl border px-2.5 text-left text-sm font-medium shadow-sm",
          "hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-ring/40 transition-colors outline-none focus-visible:ring-2",
          open && "border-primary/50 bg-muted/40",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <LocaleFlag
            country={countryForLocale(locale)}
            className="h-4 w-6 border border-black/10 dark:border-white/15"
          />
          <span className="truncate">{t(locale as LocaleCode)}</span>
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-labelledby="header-language-trigger"
          className={cn(
            "border-border bg-popover text-popover-foreground absolute top-[calc(100%+6px)] right-0 left-0 z-[100] overflow-hidden rounded-xl border py-1 shadow-lg",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150",
          )}
        >
          {LOCALE_CODES.map((code) => {
            const active = code === locale;
            return (
              <button
                key={code}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-foreground hover:bg-muted/80",
                )}
                onClick={() => {
                  setOpen(false);
                  if (code !== locale) setLocaleCookie(code);
                }}
              >
                <LocaleFlag
                  country={countryForLocale(code)}
                  className="h-4 w-6 border border-black/10 dark:border-white/15"
                />
                <span className="truncate">{t(code)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
