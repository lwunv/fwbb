"use client";

import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Sun, Moon, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

const themes = ["light", "dark", "pink"] as const;

const themeIcons = {
  light: Sun,
  dark: Moon,
  pink: Heart,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations("themes");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes value is only stable after client hydration.
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const currentTheme = (theme as (typeof themes)[number]) || "light";
  const currentIndex = themes.indexOf(currentTheme);
  const nextIndex = (currentIndex + 1) % themes.length;
  const nextTheme = themes[nextIndex];

  const Icon = themeIcons[currentTheme] || Sun;

  const cycle = () => {
    setTheme(nextTheme);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      title={`${t(currentTheme)} → ${t(nextTheme)}`}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">{t(nextTheme)}</span>
    </Button>
  );
}
