"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { MoneyInput } from "@/components/shared/money-input";
import { Switch } from "@/components/ui/switch";
import { CustomSelect } from "@/components/ui/custom-select";
import { NumberStepper } from "@/components/ui/number-stepper";
import { fireAction } from "@/lib/optimistic-action";
import { useWriteQueue } from "@/lib/use-write-queue";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";
import {
  computeGroupPlayRates,
  type GroupKey,
  type GroupPolicy,
} from "@/lib/group-policy";
import { formatK } from "@/lib/utils";

// Ba nhóm không phân biệt giới: LUÔN hiện.
const BASE_GROUPS = ["member", "guestMember", "guestAdmin"] as const;
// Ba nhóm nữ: chỉ hiện khi công tắc `genderPricingEnabled` BẬT. Tắt thì không
// attendee nào rơi vào rổ đó được, hiện ô cấu hình chỉ tạo ảo giác đổi được
// trong khi không có tác dụng gì. Giá trị của chúng vẫn nằm nguyên trong
// object policies dù đang ẩn (spread khi lưu) — không đụng, không xoá.
const FEMALE_GROUPS = [
  "memberFemale",
  "guestMemberFemale",
  "guestAdminFemale",
] as const;
type VisibleGroupKey =
  | (typeof BASE_GROUPS)[number]
  | (typeof FEMALE_GROUPS)[number];

const GROUP_LABEL_KEY: Record<VisibleGroupKey, string> = {
  member: "groupMember",
  guestMember: "groupGuestMember",
  guestAdmin: "groupGuestAdmin",
  memberFemale: "groupMemberFemale",
  guestMemberFemale: "groupGuestMemberFemale",
  guestAdminFemale: "groupGuestAdminFemale",
};

export function SectionMoney({
  settings,
  unsetGenderCount = 0,
}: {
  settings: AppSettings;
  /** Số thành viên còn hoạt động chưa khai giới tính (chỉ con số, không tên). */
  unsetGenderCount?: number;
}) {
  const t = useTranslations("adminSettings");
  const [genderOn, setGenderOn] = useState(settings.genderPricingEnabled);

  // Đọc từ state cục bộ, KHÔNG từ prop: gạt công tắc là ba nhóm nữ hiện/ẩn
  // ngay, không đợi server revalidate.
  const visibleGroups: readonly VisibleGroupKey[] = genderOn
    ? [...BASE_GROUPS, ...FEMALE_GROUPS]
    : BASE_GROUPS;

  // Tách phẳng trước khi dùng trong effect — react-hooks/set-state-in-effect
  // chỉ nhận identifier phẳng làm dependency ổn định (xem section-operations).
  const {
    minDeductionAmount: minDeductionSetting,
    groupPolicies: groupPoliciesSetting,
  } = settings;

  // Không giữ chuỗi nháp ở đây nữa: `MoneyInput` tự lo phần đó, kể cả việc
  // phân biệt ô trống với số 0 và việc đồng bộ lại khi giá trị chốt đổi.
  const [policies, setPolicies] =
    useState<Record<GroupKey, GroupPolicy>>(groupPoliciesSetting);

  const enqueue = useWriteQueue();

  useEffect(() => {
    setPolicies(groupPoliciesSetting);
  }, [groupPoliciesSetting]);

  useEffect(() => {
    setGenderOn(settings.genderPricingEnabled);
  }, [settings.genderPricingEnabled]);

  function toggleGender(next: boolean) {
    const prev = genderOn;
    setGenderOn(next);
    fireAction(
      () =>
        enqueue("genderPricingEnabled", () =>
          updateSetting("genderPricingEnabled", next),
        ),
      () => setGenderOn(prev),
    );
  }

  function commitMinDeduction(n: number) {
    fireAction(() =>
      enqueue("minDeductionAmount", () =>
        updateSetting("minDeductionAmount", n),
      ),
    );
  }

  // Ghi `groupPolicies` LUÔN gửi cả sáu nhóm — schema `.strict()` ở registry
  // chặn patch một phần, thiếu nhóm sẽ bị coi là lỗi và rơi về default (xem
  // comment trên `groupPolicies` trong settings-registry.ts). `policies` ở
  // đây luôn là object đủ sáu nhóm (khởi tạo + đồng bộ từ settings prop, vốn
  // luôn đủ sáu nhóm nhờ resolveGlobal), nên spread rồi đổi đúng một nhóm là
  // đủ để không bao giờ gửi thiếu.
  function updateRow(key: VisibleGroupKey, patch: Partial<GroupPolicy>) {
    const prevAll = policies;
    const nextAll: Record<GroupKey, GroupPolicy> = {
      ...policies,
      [key]: { ...policies[key], ...patch },
    };
    setPolicies(nextAll);
    fireAction(
      () =>
        enqueue("groupPolicies", () => updateSetting("groupPolicies", nextAll)),
      () => setPolicies(prevAll),
    );
  }

  function commitMode(key: VisibleGroupKey, mode: GroupPolicy["mode"]) {
    updateRow(key, { mode });
  }

  function commitCapAtEqual(key: VisibleGroupKey, capAtEqual: boolean) {
    updateRow(key, { capAtEqual });
  }

  function commitAmount(key: VisibleGroupKey, amount: number) {
    updateRow(key, { amount });
  }

  const MODE_OPTIONS = useMemo(
    () => [
      { value: "equal", label: t("modeEqual") },
      { value: "floor", label: t("modeFloor") },
      { value: "fixed", label: t("modeFixed") },
    ],
    [t],
  );

  // ─── Khối xem thử — gọi ĐÚNG computeGroupPlayRates mà đường chốt sổ dùng,
  // không tự tính lại bằng tay, nên không bao giờ lệch với số tiền thật.
  const [previewTotal, setPreviewTotal] = useState(0);
  // Đủ SÁU nhóm kể cả khi ba nhóm nữ đang ẩn: `computeGroupPlayRates` cần đủ
  // sáu rổ, và giữ nguyên state khi admin bật/tắt công tắc.
  const [previewHeads, setPreviewHeads] = useState<Record<GroupKey, number>>({
    member: 0,
    memberFemale: 0,
    guestMember: 0,
    guestMemberFemale: 0,
    guestAdmin: 0,
    guestAdminFemale: 0,
  });

  const previewRates = useMemo(
    () =>
      computeGroupPlayRates({
        totalPlayCost: previewTotal,
        headsByGroup: previewHeads,
        policies,
      }),
    [previewTotal, previewHeads, policies],
  );

  return (
    <SectionCard tone="emerald" icon={Coins} title={t("moneyPolicy")}>
      <div className="space-y-4">
        {/* Công tắc tính tiền theo giới tính. TẮT là mặc định, và tắt thì không
            ai đọc cột `members.gender`, ba nhóm nữ cũng không hiện — tiền chia
            y như khi chưa có tính năng này. */}
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <div className="text-sm font-medium">{t("genderPricing")}</div>
            <p className="text-muted-foreground text-xs">
              {t("genderPricingHint")}
            </p>
          </div>
          <Switch
            checked={genderOn}
            onCheckedChange={toggleGender}
            aria-label={t("genderPricing")}
          />
        </div>

        {/* Chỉ cảnh báo khi công tắc giới tính ĐANG BẬT. Tắt thì cột gender
            không ai đọc, nhắc chỉ gây nhiễu. */}
        {genderOn && unsetGenderCount > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>{t("genderUnsetWarning", { count: unsetGenderCount })}</p>
            <Link
              href="/admin/members"
              className="text-primary mt-1 inline-block min-h-11 font-medium underline underline-offset-4"
            >
              {t("genderUnsetLink")}
            </Link>
          </div>
        )}
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-sm font-medium">
            {t("minDeduction")}
          </span>
          <MoneyInput
            value={minDeductionSetting}
            onCommit={commitMinDeduction}
            suffix="đ"
          />
        </label>

        <div className="space-y-3 border-t pt-3">
          <div className="text-sm font-medium">{t("groupPoliciesTitle")}</div>
          {visibleGroups.map((key) => {
            const policy = policies[key];
            const groupLabel = t(GROUP_LABEL_KEY[key]);
            return (
              <div key={key} className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-semibold">{groupLabel}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-muted-foreground mb-1 block text-sm font-medium">
                      {t("modeLabel", { group: groupLabel })}
                    </span>
                    <CustomSelect
                      value={policy.mode}
                      onChange={(v) =>
                        commitMode(key, v as GroupPolicy["mode"])
                      }
                      options={MODE_OPTIONS}
                    />
                  </label>
                  {policy.mode !== "equal" && (
                    <label className="block">
                      <span className="text-muted-foreground mb-1 block text-sm font-medium">
                        {t("amountLabel", { group: groupLabel })}
                      </span>
                      <MoneyInput
                        value={policy.amount}
                        onCommit={(n) => commitAmount(key, n)}
                        suffix="đ"
                      />
                    </label>
                  )}
                </div>
                {policy.mode === "fixed" && (
                  <label className="hover:bg-muted mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg p-2">
                    <input
                      type="checkbox"
                      checked={policy.capAtEqual}
                      onChange={(e) => commitCapAtEqual(key, e.target.checked)}
                      className="accent-primary h-6 w-6 rounded"
                      aria-label={t("capAtEqualLabel", { group: groupLabel })}
                    />
                    <span className="text-sm">{t("capAtEqual")}</span>
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-3 border-t pt-3">
          <div>
            <div className="text-sm font-medium">{t("previewTitle")}</div>
            <p className="text-muted-foreground text-sm">{t("previewNote")}</p>
          </div>
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-sm font-medium">
              {t("previewTotalCost")}
            </span>
            <NumberStepper
              value={previewTotal}
              onChange={setPreviewTotal}
              step={10_000}
              displayFormat="vnd"
              inputClassName="text-left px-2"
              className="w-full"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            {visibleGroups.map((key) => (
              <label key={key} className="block">
                <span className="text-muted-foreground mb-1 block text-sm font-medium">
                  {t("previewHeadsLabel", { group: t(GROUP_LABEL_KEY[key]) })}
                </span>
                <NumberStepper
                  value={previewHeads[key]}
                  onChange={(v) => setPreviewHeads((h) => ({ ...h, [key]: v }))}
                  className="w-full"
                />
              </label>
            ))}
          </div>
          <div className="bg-muted/30 space-y-1 rounded-lg border p-3">
            {visibleGroups.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {t(GROUP_LABEL_KEY[key])}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatK(previewRates[key])} đ
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
