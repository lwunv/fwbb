"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { MoneyInput } from "@/components/shared/money-input";
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

export function SectionMoney({ settings }: { settings: AppSettings }) {
  const t = useTranslations("adminSettings");

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

  // Hàng đợi ghi tuần tự — `updateSetting` là upsert last-write-wins đơn
  // thuần, không có version check. Đổi mode rồi gõ số tiền ngay sau (thao
  // tác bình thường: đổi "cố định" để lộ ô số tiền, rồi điền số) là HAI lần
  // ghi cả object groupPolicies liên tiếp. Nếu bắn cả hai request song song,
  // request đầu (đổi mode) có thể về CHẬM hơn request sau (điền số tiền) —
  // mobile giật, retry, tái dùng connection — và đè lên bằng snapshot cũ hơn
  // nhưng vẫn hợp schema (`.strict()` không bắt được vì cả hai payload đều
  // đủ sáu nhóm). Chọn cách "giữ 1 promise trong ref, nối request sau vào
  // đuôi request trước" thay vì đánh số thứ tự rồi bỏ qua kết quả cũ hơn —
  // đơn giản hơn: không cần so sánh số thứ tự ở nơi nhận kết quả, và tự
  // nhiên tương thích với logic retry sẵn có của `fireAction` (retry gọi lại
  // `action()`, action đó vẫn đi qua `enqueueWrite` nên vẫn xếp hàng đúng
  // chỗ). Không đụng `fireAction`/`updateSetting` — chỉ nối request ở tầng
  // gọi, UI vẫn optimistic ngay lập tức, rollback vẫn đúng theo kết quả của
  // CHÍNH lần ghi đó.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  function enqueueWrite<T>(action: () => Promise<T>): Promise<T> {
    const run = writeQueueRef.current.then(action, action);
    // Chuẩn hoá về "luôn resolve" bất kể lần ghi này lỗi hay không — một lần
    // ghi lỗi không được phép chặn đứng các lần ghi sau xếp hàng phía sau nó.
    writeQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  useEffect(() => {
    setPolicies(groupPoliciesSetting);
  }, [groupPoliciesSetting]);

  function commitMinDeduction(n: number) {
    fireAction(() =>
      enqueueWrite(() => updateSetting("minDeductionAmount", n)),
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
      () => enqueueWrite(() => updateSetting("groupPolicies", nextAll)),
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
          <MoneyInput
            value={minDeductionSetting}
            onCommit={commitMinDeduction}
            suffix="đ"
          />
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
