"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { formatVND } from "@/lib/utils";
import { cn } from "@/lib/utils";
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
  memberName: string;
  memberPhone: string;
  totalPlayed: number;
  totalDined: number;
  totalSpent: number;
}

export function MeClient({
  memberName,
  memberPhone,
  totalPlayed,
  totalDined,
  totalSpent,
}: MeClientProps) {
  const { theme, setTheme } = useTheme();

  const themes = [
    { key: "light", label: "Sang", icon: Sun },
    { key: "dark", label: "Toi", icon: Moon },
    { key: "pink", label: "Hong", icon: Heart },
  ] as const;

  const maskedPhone = memberPhone.slice(0, 4) + "****" + memberPhone.slice(-2);

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Ho so
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary">
              {memberName.charAt(0).toUpperCase()}
            </div>
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
              Doi nguoi dung
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Cai dat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Giao dien</label>
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
          <CardTitle>Thong ke nhanh</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <p className="text-lg font-bold">{totalPlayed}</p>
              <p className="text-[11px] text-muted-foreground">Buoi choi</p>
            </div>
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                <UtensilsCrossed className="h-5 w-5 text-accent" />
              </div>
              <p className="text-lg font-bold">{totalDined}</p>
              <p className="text-[11px] text-muted-foreground">Buoi an</p>
            </div>
            <div className="text-center space-y-1">
              <div className="mx-auto w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-destructive" />
              </div>
              <p className="text-sm font-bold">{formatVND(totalSpent)}</p>
              <p className="text-[11px] text-muted-foreground">Tong chi</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
