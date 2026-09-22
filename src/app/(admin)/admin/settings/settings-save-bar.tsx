"use client";

import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsDraft } from "./settings-draft";

/**
 * Thanh Lưu của trang Cài đặt.
 *
 * LUÔN hiện, kể cả khi không có gì để lưu (lúc đó nút mờ đi). Bản đầu ẩn hẳn
 * thanh khi chưa sửa gì, và nó gây hiểu nhầm ngay lần đầu dùng: mở trang ra
 * không thấy nút nào thì trông y như bản cũ chưa được deploy. Thà chiếm một
 * dải đáy màn hình còn hơn để admin không biết trang này lưu bằng cách nào.
 *
 * Dính đáy màn hình vì app dùng chủ yếu trên điện thoại, nút chính phải nằm
 * trong tầm ngón cái.
 */
export function SettingsSaveBar() {
  const { dirtyKeys, saving, save, discard } = useSettingsDraft();
  const count = dirtyKeys.length;
  const dirty = count > 0;

  return (
    <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-3 backdrop-blur lg:left-60">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span className="text-muted-foreground min-w-0 flex-1 text-sm">
          {dirty ? `${count} thay đổi chưa lưu` : "Chưa có thay đổi"}
        </span>
        {dirty && (
          <Button
            variant="outline"
            onClick={discard}
            disabled={saving}
            className="min-h-11"
          >
            Hoàn tác
          </Button>
        )}
        <Button onClick={save} disabled={!dirty || saving} className="min-h-11">
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
