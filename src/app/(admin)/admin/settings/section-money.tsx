"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { MoneyInput } from "@/components/shared/money-input";
import { Switch } from "@/components/ui/switch";
import { useSettingsDraft } from "./settings-draft";
import { CustomSelect } from "@/components/ui/custom-select";
import { NumberStepper } from "@/components/ui/number-stepper";
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
  unsetGenderCount = 0,
}: {
  /** Số thành viên còn hoạt động chưa khai giới tính (chỉ con số, không tên). */
  unsetGenderCount?: number;
}) {
  const t = useTranslations("adminSettings");
  // Mọi thay đổi ở đây chỉ vào bản nháp chung; server nhận khi bấm Lưu.
  const { get, set } = useSettingsDraft();

  const genderOn = get("genderPricingEnabled");
  const policies = get("groupPolicies");
  const minDeductionSetting = get("minDeductionAmount");

  const visibleGroups: readonly VisibleGroupKey[] = genderOn
    ? [...BASE_GROUPS, ...FEMALE_GROUPS]
    : BASE_GROUPS;

  function toggleGender(next: boolean) {
    set("genderPricingEnabled", next);
  }

  function commitMinDeduction(n: number) {
    set("minDeductionAmount", n);
  }

  // Ghi `groupPolicies` LUÔN gửi cả sáu nhóm — schema `.strict()` ở registry
  // chặn patch một phần, thiếu nhóm sẽ bị coi là lỗi và rơi về default (xem
  // comment trên `groupPolicies` trong settings-registry.ts). `policies` luôn
  // đủ sáu nhóm (nháp hoặc giá trị server, cả hai đều đủ nhờ resolveGlobal),
  // nên spread rồi đổi đúng một nhóm là đủ để không bao giờ gửi thiếu.
  function updateRow(key: VisibleGroupKey, patch: Partial<GroupPolicy>) {
    set("groupPolicies", {
      ...policies,
      [key]: { ...policies[key], ...patch },
    });
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

  // Đọc policies qua `get` NGAY TRONG memo thay vì phụ thuộc vào biến
  // `policies` ở trên: `get` đổi mỗi khi bản nháp hoặc giá trị server đổi, tức
  // đúng lúc cần tính lại, mà không bắt eslint phải tin một object lấy từ hàm
  // ngoài là bất biến.
  const previewRates = useMemo(
    () =>
      computeGroupPlayRates({
        totalPlayCost: previewTotal,
        headsByGroup: previewHeads,
        policies: get("groupPolicies"),
      }),
    [previewTotal, previewHeads, get],
  );

  /** Một thẻ cấu hình cho MỘT nhóm. Dùng chung cho ba nhóm thường và ba nhóm
   *  nữ để hai chỗ không bao giờ lệch nhau về cách hiển thị. */
  function groupRow(key: VisibleGroupKey) {
    const policy = policies[key];
    const groupLabel = t(GROUP_LABEL_KEY[key]);
    return (
      <div key={key} className="bg-card rounded-lg border p-3">
        <div className="mb-2 text-sm font-semibold">{groupLabel}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-muted-foreground mb-1 block text-sm font-medium">
              {t("modeLabel", { group: groupLabel })}
            </span>
            <CustomSelect
              value={policy.mode}
              onChange={(v) => commitMode(key, v as GroupPolicy["mode"])}
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
  }

  return (
    <SectionCard tone="emerald" icon={Coins} title={t("moneyPolicy")}>
      <div className="space-y-4">
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
          {BASE_GROUPS.map(groupRow)}
        </div>

        {/* Cụm giới tính: công tắc và ba nhóm nữ nằm liền nhau trong MỘT khung
            riêng. Trước đây công tắc ở trên cùng còn ba nhóm nữ lẫn vào danh
            sách nhóm thường, nhìn không ra chúng là một tính năng và tắt công
            tắc thì cả cụm hết tác dụng. Khung có nền riêng để phân biệt với
            các cài đặt luôn-có-hiệu-lực ở trên. */}
        <div className="border-primary/30 bg-primary/5 space-y-3 rounded-xl border p-3">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{t("genderPricing")}</div>
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

          {/* Chỉ cảnh báo khi công tắc ĐANG BẬT. Tắt thì cột gender không ai
              đọc, nhắc chỉ gây nhiễu. */}
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

          {genderOn && (
            <div className="space-y-3">
              <div className="text-sm font-medium">
                {t("genderGroupsTitle")}
              </div>
              {FEMALE_GROUPS.map(groupRow)}
            </div>
          )}
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
