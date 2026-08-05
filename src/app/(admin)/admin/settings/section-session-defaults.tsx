"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Settings2, X } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";
import { formatK, cn } from "@/lib/utils";

interface CourtOpt {
  id: number;
  name: string;
  pricePerSession: number;
}
interface BrandOpt {
  id: number;
  name: string;
  pricePerTube: number;
}

// Hiển thị T2..T7, CN. dow theo chuẩn JS (CN=0, T2=1, …, T7=6).
const DAY_PILLS: { dow: number; label: string }[] = [
  { dow: 1, label: "T2" },
  { dow: 2, label: "T3" },
  { dow: 3, label: "T4" },
  { dow: 4, label: "T5" },
  { dow: 5, label: "T6" },
  { dow: 6, label: "T7" },
  { dow: 0, label: "CN" },
];

export function SectionSessionDefaults({
  settings,
  courts,
  brands,
}: {
  settings: AppSettings;
  courts: CourtOpt[];
  brands: BrandOpt[];
}) {
  const t = useTranslations("adminSettings");
  const td = useTranslations("dashboard");

  const [courtId, setCourtId] = useState(
    settings.defaultCourtId ? String(settings.defaultCourtId) : "",
  );
  const [brandId, setBrandId] = useState(
    settings.defaultBrandId ? String(settings.defaultBrandId) : "",
  );
  const [sessionDays, setSessionDays] = useState<Set<number>>(
    new Set(settings.sessionDaysOfWeek),
  );
  const [startTime, setStartTime] = useState(settings.defaultStartTime);
  const [endTime, setEndTime] = useState(settings.defaultEndTime);
  const [courtQty, setCourtQty] = useState(settings.defaultCourtQuantity);
  const [deadlineHours, setDeadlineHours] = useState(
    settings.voteDeadlineOffsetHours,
  );
  const [maxPlayers, setMaxPlayers] = useState(settings.defaultMaxPlayers);
  const [options, setOptions] = useState<number[]>(settings.maxPlayersOptions);
  const [draft, setDraft] = useState("");

  function handleCourtChange(v: string) {
    const prev = courtId;
    setCourtId(v);
    const id = parseInt(v, 10);
    if (!Number.isFinite(id)) return;
    fireAction(
      () => updateSetting("defaultCourtId", id),
      () => setCourtId(prev),
    );
  }

  function handleBrandChange(v: string) {
    const prev = brandId;
    setBrandId(v);
    const id = parseInt(v, 10);
    if (!Number.isFinite(id)) return;
    fireAction(
      () => updateSetting("defaultBrandId", id),
      () => setBrandId(prev),
    );
  }

  function toggleDay(dow: number) {
    const prev = new Set(sessionDays);
    const next = new Set(sessionDays);
    if (next.has(dow)) next.delete(dow);
    else next.add(dow);
    if (next.size === 0) return; // ít nhất 1 ngày — khớp validate registry
    setSessionDays(next);
    fireAction(
      () => updateSetting("sessionDaysOfWeek", Array.from(next).sort()),
      () => setSessionDays(prev),
    );
  }

  function commitTime(
    key: "defaultStartTime" | "defaultEndTime",
    next: string,
    prev: string,
    set: (v: string) => void,
  ) {
    set(next);
    fireAction(
      () => updateSetting(key, next),
      () => set(prev),
    );
  }

  function commitNumber(
    key:
      | "defaultCourtQuantity"
      | "voteDeadlineOffsetHours"
      | "defaultMaxPlayers",
    next: number,
    prev: number,
    set: (v: number) => void,
  ) {
    if (!Number.isInteger(next) || next < 0) return;
    set(next);
    fireAction(
      () => updateSetting(key, next),
      () => set(prev),
    );
  }

  function commitOptions(next: number[]) {
    if (next.length === 0) return; // registry bắt buộc ít nhất một mức
    const prev = options;
    setOptions(next);
    fireAction(
      () => updateSetting("maxPlayersOptions", next),
      () => setOptions(prev),
    );
  }

  function addOption() {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || n > 100 || options.includes(n)) return;
    setDraft("");
    commitOptions([...options, n].sort((a, b) => a - b));
  }

  function removeOption(n: number) {
    commitOptions(options.filter((x) => x !== n));
  }

  return (
    <SectionCard tone="primary" icon={Settings2} title={t("sessionDefaults")}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {td("defaultsCourtLabel")}
            </span>
            <CustomSelect
              value={courtId}
              onChange={handleCourtChange}
              placeholder={td("defaultsCourtPlaceholder")}
              options={courts.map((c) => ({
                value: String(c.id),
                label: c.name,
                rightLabel: c.pricePerSession
                  ? formatK(c.pricePerSession)
                  : undefined,
              }))}
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {td("defaultsBrandLabel")}
            </span>
            <CustomSelect
              value={brandId}
              onChange={handleBrandChange}
              placeholder={td("defaultsBrandPlaceholder")}
              options={brands.map((b) => ({
                value: String(b.id),
                label: b.name,
                rightLabel: b.pricePerTube
                  ? `${formatK(b.pricePerTube)}${td("defaultsBrandPriceSuffix")}`
                  : undefined,
              }))}
            />
          </label>
        </div>

        <div>
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {td("defaultsDaysLabel")}
          </span>
          <div className="grid grid-cols-7 gap-1">
            {DAY_PILLS.map(({ dow, label }) => {
              const active = sessionDays.has(dow);
              return (
                <button
                  key={dow}
                  type="button"
                  onClick={() => toggleDay(dow)}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center rounded-md border px-1 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("startTime")}
            </span>
            <Input
              type="time"
              value={startTime}
              className="min-h-11"
              onChange={(e) =>
                commitTime(
                  "defaultStartTime",
                  e.target.value,
                  startTime,
                  setStartTime,
                )
              }
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("endTime")}
            </span>
            <Input
              type="time"
              value={endTime}
              className="min-h-11"
              onChange={(e) =>
                commitTime(
                  "defaultEndTime",
                  e.target.value,
                  endTime,
                  setEndTime,
                )
              }
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("courtQuantity")}
            </span>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={courtQty}
              className="min-h-11"
              onChange={(e) =>
                commitNumber(
                  "defaultCourtQuantity",
                  Number(e.target.value),
                  courtQty,
                  setCourtQty,
                )
              }
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("deadlineHours")}
            </span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={deadlineHours}
              className="min-h-11"
              onChange={(e) =>
                commitNumber(
                  "voteDeadlineOffsetHours",
                  Number(e.target.value),
                  deadlineHours,
                  setDeadlineHours,
                )
              }
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-xs font-medium">
              {t("maxPlayers")}
            </span>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={maxPlayers}
              className="min-h-11"
              onChange={(e) =>
                commitNumber(
                  "defaultMaxPlayers",
                  Number(e.target.value),
                  maxPlayers,
                  setMaxPlayers,
                )
              }
            />
          </label>
        </div>

        <div>
          <span className="text-muted-foreground mb-1 block text-xs font-medium">
            {t("maxPlayersOptions")}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {options.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => removeOption(n)}
                className="border-border bg-muted/30 hover:bg-muted inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
              >
                {n}
                <X className="h-3.5 w-3.5" />
              </button>
            ))}
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={draft}
              placeholder={t("addOption")}
              className="min-h-11 w-24"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addOption();
                }
              }}
            />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
