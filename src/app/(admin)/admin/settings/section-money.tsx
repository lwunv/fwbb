"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { NumberStepper } from "@/components/ui/number-stepper";
import { fireAction } from "@/lib/optimistic-action";
import { updateSetting } from "@/actions/settings";
import type { AppSettings } from "@/lib/settings-registry";
import {
  computeGroupPlayRates,
  type GroupKey,
  type GroupPolicy,
} from "@/lib/group-policy";
import { formatK } from "@/lib/utils";

// Chỉ ba nhóm không phân biệt giới được cho đổi ở đây. Ba nhóm nữ
// (memberFemale, guestMemberFemale, guestAdminFemale) CHỦ Ý không có dòng
// nào trong bảng — chưa có cột gender nào trong DB nên không attendee nào có
// thể rơi vào rổ đó, hiện ô cấu hình cho nó chỉ tạo ảo giác đổi được trong
// khi không có tác dụng gì. Giá trị mặc định của ba nhóm nữ vẫn nằm nguyên
// trong object policies (spread khi lưu) — không đụng, không xoá.
const VISIBLE_GROUPS = ["member", "guestMember", "guestAdmin"] as const;
type VisibleGroupKey = (typeof VISIBLE_GROUPS)[number];

const GROUP_LABEL_KEY: Record<VisibleGroupKey, string> = {
  member: "groupMember",
  guestMember: "groupGuestMember",
  guestAdmin: "groupGuestAdmin",
};

function parseMoneyInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits === "") return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

export function SectionMoney({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");

  // Tách phẳng trước khi dùng trong effect — react-hooks/set-state-in-effect
  // chỉ nhận identifier phẳng làm dependency ổn định (xem section-operations).
  const {
    minDeductionAmount: minDeductionSetting,
    groupPolicies: groupPoliciesSetting,
  } = settings;

  const [minDeductionDraft, setMinDeductionDraft] = useState(
    String(minDeductionSetting),
  );
  const [policies, setPolicies] =
    useState<Record<GroupKey, GroupPolicy>>(groupPoliciesSetting);
  const [amountDrafts, setAmountDrafts] = useState<
    Record<VisibleGroupKey, string>
  >({
    member: String(groupPoliciesSetting.member.amount),
    guestMember: String(groupPoliciesSetting.guestMember.amount),
    guestAdmin: String(groupPoliciesSetting.guestAdmin.amount),
  });

  useEffect(() => {
    setMinDeductionDraft(String(minDeductionSetting));
  }, [minDeductionSetting]);

  useEffect(() => {
    setPolicies(groupPoliciesSetting);
    setAmountDrafts({
      member: String(groupPoliciesSetting.member.amount),
      guestMember: String(groupPoliciesSetting.guestMember.amount),
      guestAdmin: String(groupPoliciesSetting.guestAdmin.amount),
    });
  }, [groupPoliciesSetting]);

  function commitMinDeduction(raw: string) {
    const n = parseMoneyInput(raw);
    if (n === null || n < 0) {
      setMinDeductionDraft(String(minDeductionSetting));
      return;
    }
    const prev = minDeductionSetting;
    setMinDeductionDraft(String(n));
    fireAction(
      () => updateSetting("minDeductionAmount", n),
      () => setMinDeductionDraft(String(prev)),
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
      () => updateSetting("groupPolicies", nextAll),
      () => setPolicies(prevAll),
    );
  }

  function commitMode(key: VisibleGroupKey, mode: GroupPolicy["mode"]) {
    updateRow(key, { mode });
  }

  function commitCapAtEqual(key: VisibleGroupKey, capAtEqual: boolean) {
    updateRow(key, { capAtEqual });
  }

  function commitAmount(key: VisibleGroupKey, raw: string) {
    const n = parseMoneyInput(raw);
    if (n === null || n < 0) {
      setAmountDrafts((d) => ({ ...d, [key]: String(policies[key].amount) }));
      return;
    }
    setAmountDrafts((d) => ({ ...d, [key]: String(n) }));
    updateRow(key, { amount: n });
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
  const [previewHeads, setPreviewHeads] = useState<
    Record<VisibleGroupKey, number>
  >({ member: 0, guestMember: 0, guestAdmin: 0 });

  const previewRates = useMemo(() => {
    const headsByGroup: Record<GroupKey, number> = {
      member: previewHeads.member,
      memberFemale: 0,
      guestMember: previewHeads.guestMember,
      guestMemberFemale: 0,
      guestAdmin: previewHeads.guestAdmin,
      guestAdminFemale: 0,
    };
    return computeGroupPlayRates({
      totalPlayCost: previewTotal,
      headsByGroup,
      policies,
    });
  }, [previewTotal, previewHeads, policies]);

  return (
    <SectionCard tone="emerald" icon={Coins} title={t("moneyPolicy")}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-muted-foreground mb-1 block text-sm font-medium">
            {t("minDeduction")}
          </span>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="numeric"
              value={minDeductionDraft}
              className="min-h-11"
              onChange={(e) => setMinDeductionDraft(e.target.value)}
              onBlur={(e) => commitMinDeduction(e.target.value)}
            />
            <span className="text-muted-foreground shrink-0 text-sm">đ</span>
          </div>
        </label>

        <div className="space-y-3 border-t pt-3">
          <div className="text-sm font-medium">{t("groupPoliciesTitle")}</div>
          {VISIBLE_GROUPS.map((key) => {
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
                      <div className="flex items-center gap-2">
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={amountDrafts[key]}
                          className="min-h-11"
                          onChange={(e) =>
                            setAmountDrafts((d) => ({
                              ...d,
                              [key]: e.target.value,
                            }))
                          }
                          onBlur={(e) => commitAmount(key, e.target.value)}
                        />
                        <span className="text-muted-foreground shrink-0 text-sm">
                          đ
                        </span>
                      </div>
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
            {VISIBLE_GROUPS.map((key) => (
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
            {VISIBLE_GROUPS.map((key) => (
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
