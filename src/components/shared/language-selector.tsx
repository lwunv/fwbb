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
  // Mở UP khi trigger nằm sát đáy viewport (vd LanguageSelector trong admin
  // sidebar bottom) — `top: 100%` mặc định sẽ tràn dưới + bị Next.js dev
  // indicator che. Tính lúc mở, không cần listen scroll vì dropdown đóng khi
  // user cuộn / blur.
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cookie locale is only readable on the client after hydration.
    setMounted(true);
    setLocale(getLocaleFromCookie());
  }, []);

  useEffect(() => {
    if (!open) return;
    // Tính direction tại thời điểm mở: nếu dưới trigger còn < ~180px thì dropUp.
    // 180px = đủ chứa 3 option × ~52px + padding.
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot direction calc on open.
      setDropUp(below < 180);
    }
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
          "bg-muted/60 h-11 w-11 animate-pulse rounded-xl sm:h-9 sm:w-[8.25rem]",
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
        "relative shrink-0 sm:w-[min(11rem,calc(100vw-8.5rem))]",
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
          // Mobile: chỉ icon cờ (vuông, canh giữa). sm+: mở rộng full-width có
          // nhãn ngôn ngữ + mũi tên.
          "border-border bg-card text-foreground flex h-11 w-11 items-center justify-center rounded-xl border text-left text-sm font-medium shadow-sm sm:h-11 sm:w-full sm:justify-between sm:gap-1.5 sm:px-2.5",
          "hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-ring/40 transition-colors outline-none focus-visible:ring-2",
          open && "border-primary/50 bg-muted/40",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 sm:flex-1">
          <LocaleFlag
            country={countryForLocale(locale)}
            className="h-4 w-6 border border-black/10 dark:border-white/15"
          />
          <span className="hidden truncate sm:inline">
            {t(locale as LocaleCode)}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground hidden h-4 w-4 shrink-0 transition-transform sm:block",
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
            // Mobile: trigger chỉ rộng bằng icon → neo phải + min-width để 3
            // dòng ngôn ngữ đọc được. sm+: bám full-width trigger (left-0).
            "border-border bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 absolute right-0 z-[100] min-w-[11rem] overflow-hidden rounded-xl border py-1 shadow-lg duration-150 sm:left-0",
            dropUp
              ? "slide-in-from-bottom-1 bottom-[calc(100%+6px)]"
              : "slide-in-from-top-1 top-[calc(100%+6px)]",
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
                  "flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium transition-colors",
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
