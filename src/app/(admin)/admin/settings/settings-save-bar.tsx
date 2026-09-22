"use client";

import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsDraft } from "./settings-draft";

/**
 * Thanh Lưu, chỉ hiện khi CÓ thay đổi chưa lưu.
 *
 * Dính đáy màn hình: đây là app dùng chủ yếu trên điện thoại, nút chính phải
 * nằm trong tầm ngón cái (rubric mobile-first). Ẩn khi không có gì để lưu để
 * không che nội dung một cách vô ích.
 */
export function SettingsSaveBar() {
  const { dirtyKeys, saving, save, discard } = useSettingsDraft();
  const count = dirtyKeys.length;
  if (count === 0) return null;

  return (
    <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span className="text-muted-foreground min-w-0 flex-1 text-sm">
          {count} thay đổi chưa lưu
        </span>
        <Button
          variant="outline"
          onClick={discard}
          disabled={saving}
          className="min-h-11"
        >
          Hoàn tác
        </Button>
        <Button onClick={save} disabled={saving} className="min-h-11">
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Lưu
        </Button>
      </div>
    </div>
  );
}
