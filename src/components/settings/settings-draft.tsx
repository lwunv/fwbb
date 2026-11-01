"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { updateSetting } from "@/actions/settings";
import type { AppSettings, SettingKey } from "@/lib/settings-registry";

type Draft = Partial<AppSettings>;

interface SettingsDraftValue {
  /** Giá trị đang hiển thị: bản nháp nếu có, không thì giá trị từ server. */
  get: <K extends SettingKey>(key: K) => AppSettings[K];
  /** Ghi vào bản nháp. KHÔNG gửi server — chờ bấm Lưu. */
  set: <K extends SettingKey>(key: K, value: AppSettings[K]) => void;
  /** Bỏ một khoá khỏi nháp, ô quay về đúng giá trị server. */
  reset: (key: SettingKey) => void;
  /** Những khoá đang khác giá trị server. */
  dirtyKeys: SettingKey[];
  saving: boolean;
  save: () => void;
  discard: () => void;
}

const Ctx = createContext<SettingsDraftValue | null>(null);

export function useSettingsDraft(): SettingsDraftValue {
  const v = useContext(Ctx);
  if (!v)
    throw new Error("useSettingsDraft phải nằm trong SettingsDraftProvider");
  return v;
}

/** So sánh giá trị setting: có khoá là object/mảng nên không so bằng `===`. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Gom mọi thay đổi trên trang Cài đặt vào MỘT bản nháp, chỉ ghi xuống server
 * khi admin bấm Lưu.
 *
 * Trước đây mỗi ô tự ghi ngay khi đổi. Cách đó phản hồi nhanh nhưng admin
 * không có bước xem lại: gạt nhầm một công tắc là nó nằm trong DB luôn, mà đây
 * là trang quyết định cách chia tiền. Chuyển sang có nút Lưu là quyết định của
 * user (22/9/2026), cố ý đánh đổi tức-thì lấy khả-năng-xem-lại.
 *
 * Lưu TUẦN TỰ từng khoá thay vì song song: `updateSetting` validate và ghi
 * riêng từng khoá, chạy song song thì lỗi ở khoá này không nói được gì về khoá
 * kia, và thứ tự ghi cũng không xác định. Tuần tự thì báo được đúng khoá nào
 * hỏng và giữ lại đúng phần nháp đó.
 */
export function SettingsDraftProvider({
  settings,
  children,
}: {
  settings: AppSettings;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const get = useCallback(
    <K extends SettingKey>(key: K): AppSettings[K] =>
      key in draft ? (draft[key] as AppSettings[K]) : settings[key],
    [draft, settings],
  );

  const set = useCallback(
    <K extends SettingKey>(key: K, value: AppSettings[K]) => {
      setDraft((d) => {
        // Sửa rồi sửa về đúng giá trị cũ thì coi như chưa đổi gì.
        if (same(value, settings[key])) {
          if (!(key in d)) return d;
          const next = { ...d };
          delete next[key];
          return next;
        }
        return { ...d, [key]: value };
      });
    },
    [settings],
  );

  const reset = useCallback((key: SettingKey) => {
    setDraft((d) => {
      if (!(key in d)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });
  }, []);

  const dirtyKeys = useMemo(() => Object.keys(draft) as SettingKey[], [draft]);

  const save = useCallback(() => {
    if (inFlight.current || dirtyKeys.length === 0) return;
    inFlight.current = true;
    setSaving(true);
    void (async () => {
      const failed: string[] = [];
      const saved: SettingKey[] = [];
      for (const key of dirtyKeys) {
        const value = draft[key];
        try {
          const r = await updateSetting(key, value as never);
          if (r && "error" in r && r.error) failed.push(r.error);
          else saved.push(key);
        } catch (err) {
          failed.push(err instanceof Error ? err.message : String(err));
        }
      }
      // Chỉ bỏ khỏi nháp những khoá ĐÃ lưu được; khoá hỏng giữ nguyên để admin
      // thấy và thử lại, không âm thầm nuốt mất thứ họ vừa nhập.
      setDraft((d) => {
        const next = { ...d };
        for (const k of saved) delete next[k];
        return next;
      });
      if (failed.length > 0) toast.error(failed[0]);
      else toast.success("Đã lưu cài đặt");
      inFlight.current = false;
      setSaving(false);
    })();
  }, [draft, dirtyKeys]);

  const discard = useCallback(() => setDraft({}), []);

  const value = useMemo(
    () => ({ get, set, reset, dirtyKeys, saving, save, discard }),
    [get, set, reset, dirtyKeys, saving, save, discard],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
