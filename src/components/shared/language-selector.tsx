"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const locales = [
  { code: "vi", label: "VI" },
  { code: "en", label: "EN" },
  { code: "zh", label: "ZH" },
] as const;

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "vi";
  const match = document.cookie.match(/(?:^|; )locale=([^;]*)/);
  return match?.[1] || "vi";
}

function setLocaleCookie(locale: string) {
  document.cookie = `locale=${locale};path=/;max-age=${365 * 24 * 60 * 60}`;
  window.location.reload();
}

export function LanguageSelector() {
  const [mounted, setMounted] = useState(false);
  const [currentLocale, setCurrentLocale] = useState("vi");

  useEffect(() => {
    setMounted(true);
    setCurrentLocale(getLocaleFromCookie());
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="text-xs font-bold">
        VI
      </Button>
    );
  }

  const currentIndex = locales.findIndex((l) => l.code === currentLocale);
  const nextIndex = (currentIndex + 1) % locales.length;
  const nextLocale = locales[nextIndex];
  const current = locales[currentIndex >= 0 ? currentIndex : 0];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setLocaleCookie(nextLocale.code)}
      title={`${current.label} → ${nextLocale.label}`}
      className="text-xs font-bold"
    >
      {current.label}
    </Button>
  );
}
