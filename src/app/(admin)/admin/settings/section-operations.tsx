"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cog } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";

export function SectionOperations({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");
  const [autoCreate, setAutoCreate] = useState(settings.autoCreateSessions);
  const [appName, setAppName] = useState(settings.appName);

  function toggleAutoCreate(next: boolean) {
    const prev = autoCreate;
    setAutoCreate(next);
    fireAction(
      () => updateSetting("autoCreateSessions", next),
      () => setAutoCreate(prev),
    );
  }

  function commitAppName(next: string) {
    const trimmed = next.trim();
    if (!trimmed) return;
    const prev = appName;
    setAppName(next);
    fireAction(
      () => updateSetting("appName", trimmed),
      () => setAppName(prev),
    );
  }

  return (
    <SectionCard tone="slate" icon={Cog} title={t("operations")}>
      <div className="space-y-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t("autoCreate")}</div>
            <p className="text-muted-foreground text-xs">
              {t("autoCreateHint")}
            </p>
          </div>
          <Switch checked={autoCreate} onCheckedChange={toggleAutoCreate} />
        </div>
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t("appName")}
          </span>
          <Input
            value={appName}
            className="min-h-11"
            onChange={(e) => setAppName(e.target.value)}
            onBlur={(e) => commitAppName(e.target.value)}
          />
        </label>
      </div>
    </SectionCard>
  );
}
