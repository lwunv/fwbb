"use client";

import { useTranslations } from "next-intl";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import {
  SettingsDraftProvider,
  useSettingsDraft,
} from "@/components/settings/settings-draft";
import { DAY_PILLS, toggleSessionDay } from "@/lib/session-days";
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

/**
 * Năm thứ admin chỉnh thường xuyên nhất trước mỗi buổi, đặt thẳng lên
 * Dashboard cạnh buổi sắp tới: ngày tạo buổi, giờ chơi, sân, hãng cầu, sĩ số.
 *
 * Panel này và mục "Mặc định cho buổi mới" bên trang Cài đặt sửa CÙNG mấy khoá
 * đó. Nó không phải bản sao thu gọn: trang Cài đặt vẫn là nơi đầy đủ (số sân,
 * hạn vote, danh sách mức sĩ số). Ở đây chỉ cắt lấy phần hay đụng tới nhất để
 * admin khỏi phải rời Dashboard.
 *
 * Giữ nguyên kiểu nháp + nút Lưu của trang Cài đặt (quyết định của user
 * 22/9/2026): gõ nhầm một ô không ghi thẳng vào DB. Panel dựng bản nháp RIÊNG
 * của nó, nên bấm Hoàn tác ở đây không đụng gì tới trang kia.
 */
export function SessionDefaultsPanel({
  settings,
  courts,
  brands,
}: {
  settings: AppSettings;
  courts: CourtOpt[];
  brands: BrandOpt[];
}) {
  return (
    <SettingsDraftProvider settings={settings}>
      <PanelBody courts={courts} brands={brands} />
    </SettingsDraftProvider>
  );
}

function PanelBody({
  courts,
  brands,
}: {
  courts: CourtOpt[];
  brands: BrandOpt[];
}) {
  const td = useTranslations("dashboard");
  const t = useTranslations("adminSettings");
  const { get, set, dirtyKeys, saving, save, discard } = useSettingsDraft();

  const sessionDays = new Set(get("sessionDaysOfWeek"));
  const courtId = get("defaultCourtId");
  const brandId = get("defaultBrandId");
  const dirty = dirtyKeys.length > 0;

  function toggleDay(dow: number) {
    const next = toggleSessionDay(get("sessionDaysOfWeek"), dow);
    if (!next) return; // registry đòi ít nhất một ngày
    set("sessionDaysOfWeek", next);
  }

  return (
    <SectionCard
      tone="primary"
      icon={Settings2}
      title={td("defaultsTitle")}
      className="flex h-full flex-col"
      contentClassName="flex flex-1 flex-col pb-4"
    >
      <div className="flex flex-1 flex-col gap-3">
        <div>
          <span className="text-muted-foreground mb-1 block text-sm font-medium">
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
                  aria-pressed={active}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center rounded-md border px-1 text-sm font-medium transition-colors",
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

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-sm font-medium">
              {t("startTime")}
            </span>
            <Input
              type="time"
              value={get("defaultStartTime")}
              className="min-h-11"
              onChange={(e) => set("defaultStartTime", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-sm font-medium">
              {t("endTime")}
            </span>
            <Input
              type="time"
              value={get("defaultEndTime")}
              className="min-h-11"
              onChange={(e) => set("defaultEndTime", e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-sm font-medium">
            {td("defaultsCourtLabel")}
          </span>
          <CustomSelect
            value={courtId ? String(courtId) : ""}
            onChange={(v) => {
              const id = parseInt(v, 10);
              if (Number.isFinite(id)) set("defaultCourtId", id);
            }}
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
          <span className="text-muted-foreground mb-1 block text-sm font-medium">
            {td("defaultsBrandLabel")}
          </span>
          <CustomSelect
            value={brandId ? String(brandId) : ""}
            onChange={(v) => {
              const id = parseInt(v, 10);
              if (Number.isFinite(id)) set("defaultBrandId", id);
            }}
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

        <label className="block">
          <span className="text-muted-foreground mb-1 block text-sm font-medium">
            {t("maxPlayers")}
          </span>
          <Input
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            value={get("defaultMaxPlayers")}
            className="min-h-11"
            onChange={(e) => {
              const n = Number(e.target.value);
              // Chặn tại chỗ thay vì để server trả lỗi: ô số cho gõ cả số âm
              // lẫn chuỗi rỗng, mà cả hai đều rớt validate của registry.
              if (!Number.isInteger(n) || n < 1 || n > 100) return;
              set("defaultMaxPlayers", n);
            }}
          />
        </label>

        {/* Hàng Lưu LUÔN hiện, cùng lý do với thanh Lưu bên trang Cài đặt:
            không thấy nút nào thì admin không đoán ra panel này lưu kiểu gì. */}
        <div className="mt-auto flex items-center gap-2 border-t pt-3">
          <span
            className="text-muted-foreground min-w-0 flex-1 text-sm"
            data-slot="defaults-dirty"
          >
            {dirty
              ? `${dirtyKeys.length} thay đổi chưa lưu`
              : "Chưa có thay đổi"}
          </span>
          {dirty && (
            <Button
              variant="outline"
              size="sm"
              onClick={discard}
              disabled={saving}
              className="min-h-11"
            >
              Hoàn tác
            </Button>
          )}
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || saving}
            className="min-h-11"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Lưu
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
