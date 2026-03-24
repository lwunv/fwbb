"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { formatVND } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
import {
  User,
  Phone,
  LogOut,
  UtensilsCrossed,
  Wallet,
  Sun,
  Moon,
  Heart,
  Users,
} from "lucide-react";

interface MeClientProps {
  memberId: number;
  memberName: string;
  memberPhone: string;
  totalPlayed: number;
  totalDined: number;
  totalSpent: number;
}

export function MeClient({
  memberId,
  memberName,
  memberPhone,
  totalPlayed,
  totalDined,
  totalSpent,
}: MeClientProps) {
  const { theme, setTheme } = useTheme();
  const tThemes = useTranslations("themes");
  const tMe = useTranslations("me");
  const tStats = useTranslations("stats");

  const themes = [
    { key: "light", label: tThemes("light"), icon: Sun },
    { key: "dark", label: tThemes("dark"), icon: Moon },
    { key: "pink", label: tThemes("pink"), icon: Heart },
  ] as const;

  const maskedPhone = memberPhone.slice(0, 4) + "****" + memberPhone.slice(-2);

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            {tMe("profile")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <MemberAvatar memberId={memberId} size={48} />
            <div>
              <p className="font-medium">{memberName}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {maskedPhone}
              </p>
            </div>
          </div>
          <form action="/api/reset-identity" method="POST">
            <Button variant="outline" size="sm" className="w-full">
              <LogOut className="h-4 w-4 mr-1" />
              {tMe("switchUser")}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>{tMe("settings")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{tMe("appearance")}</label>
            <div className="flex gap-2">
              {themes.map((t) => {
                const Icon = t.icon;
                const isActive = theme === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTheme(t.key)}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition-colors",
                      isActive
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats Card */}
      <Card>
        <CardHeader>
          <CardTitle>{tStats("quickStats")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <p className="text-lg font-bold">{totalPlayed}</p>
              <p className="text-[11px] text-muted-foreground">{tStats("sessionsPlayed")}</p>
            </div>
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <UtensilsCrossed className="h-5 w-5 text-accent" />
              </div>
              <p className="text-lg font-bold">{totalDined}</p>
              <p className="text-[11px] text-muted-foreground">{tStats("sessionsDined")}</p>
            </div>
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-destructive" />
              </div>
              <p className="text-sm font-bold">{formatVND(totalSpent)}</p>
              <p className="text-[11px] text-muted-foreground">{tStats("totalSpent")}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
