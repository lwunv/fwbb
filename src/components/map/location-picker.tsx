"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MapPin, MapPinOff } from "lucide-react";
import type { LatLng } from "@/lib/geo";
import { useIsMobile } from "@/lib/use-is-mobile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LazyMapView } from "./lazy-map-view";

/** Hà Nội: tâm mặc định khi form chưa có toạ độ. */
export const DEFAULT_PICKER_CENTER: LatLng = { lat: 21.0285, lng: 105.8542 };

type LocationPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Toạ độ đang có; `null` thì bắt đầu ở Hà Nội. */
  initial: LatLng | null;
  onPick: (p: LatLng) => void;
};

const PICKER_PRECISE_ZOOM = 16;

/**
 * Chọn vị trí sân trên bản đồ: ghim cố định giữa khung, người dùng kéo bản
 * đồ, "Dùng vị trí này" trả về tâm hiện tại. Bottom sheet trên mobile, hộp
 * thoại từ `sm:`. Không có WebGL thì chỉ hiện thông báo; ô toạ độ trong form
 * vẫn nhập tay được.
 */
export function LocationPicker(props: LocationPickerProps) {
  const isMobile = useIsMobile();
  const t = useTranslations("venues");
  const { open, onOpenChange } = props;
  // Phần thân chỉ mount khi mở (portal), nên mỗi lần mở bắt đầu lại từ `initial`.
  const body = <PickerBody {...props} />;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-3 p-4">
          <SheetHeader className="p-0">
            <SheetTitle className="text-base">{t("pickerTitle")}</SheetTitle>
            <SheetDescription className="text-sm">
              {t("pickerHint")}
            </SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">{t("pickerTitle")}</DialogTitle>
          <DialogDescription className="text-sm">
            {t("pickerHint")}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  onOpenChange,
  initial,
  onPick,
}: Pick<LocationPickerProps, "onOpenChange" | "initial" | "onPick">) {
  const t = useTranslations("venues");
  const [start] = useState<LatLng>(initial ?? DEFAULT_PICKER_CENTER);
  // Tâm hiện tại; bản đồ chỉ báo khi NGƯỜI DÙNG kéo, nên khởi đầu là `start`.
  const [center, setCenter] = useState<LatLng>(start);
  const [unsupported, setUnsupported] = useState(false);

  return (
    <div className="space-y-3">
      {unsupported ? (
        <div className="bg-muted/50 flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center">
          <MapPinOff className="text-muted-foreground size-6" aria-hidden />
          <p className="text-base">{t("pickerUnsupported")}</p>
        </div>
      ) : (
        <div className="relative">
          <LazyMapView
            center={start}
            points={[]}
            // Có toạ độ sẵn thì người dùng đang chỉnh vị trí chính xác: mở sát
            // mặt đường. Chưa có thì giữ zoom mặc định để tìm khu vực.
            zoom={initial ? PICKER_PRECISE_ZOOM : undefined}
            onMoveEnd={setCenter}
            onUnsupported={() => setUnsupported(true)}
            className="h-[50dvh] sm:h-96"
          />
          {/* Ghim cố định: chóp ghim nằm đúng tâm khung (dịch lên nửa chiều cao). */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <MapPin className="fill-primary stroke-background size-10 -translate-y-5 drop-shadow-md" />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="min-h-11 flex-1"
          onClick={() => onOpenChange(false)}
        >
          {t("cancel")}
        </Button>
        {!unsupported && (
          <Button
            type="button"
            size="lg"
            className="min-h-11 flex-1"
            onClick={() => {
              onPick(center);
              onOpenChange(false);
            }}
          >
            {t("useThisLocation")}
          </Button>
        )}
      </div>
    </div>
  );
}
