"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TimeSelect15 } from "@/components/shared/time-select-15";
import { setSessionTime } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";

const DEFAULT_START = "20:30";
const DEFAULT_END = "22:30";

/** Giờ đang chọn, kèm giờ-từ-server mà nó dựa trên. */
type Draft = { basedOn: string; start: string; end: string };

/**
 * Đổi giờ chơi của một buổi đã tạo (01/11/2026).
 *
 * Trước đó giờ chơi chỉ đặt được lúc tạo buổi, tạo nhầm thì phải xoá buổi rồi
 * tạo lại, mà xoá buổi còn kéo theo hoàn quỹ và mất sạch lượt vote.
 *
 * Mọi giá trị đều SUY RA lúc render từ prop của server, không đồng bộ bằng
 * `useEffect`. Mỗi bản nháp mang theo giá trị server mà nó dựa trên (`basedOn`)
 * nên khi server trả về giờ mới, bản nháp cũ tự hết hiệu lực. Cách này vừa bỏ
 * được effect (eslint `react-hooks/set-state-in-effect` cấm), vừa không có
 * khoảng thời gian màn hình hiện giá trị cũ.
 */
export function SessionTimeEdit({
  sessionId,
  startTime,
  endTime,
}: {
  sessionId: number;
  startTime: string | null;
  endTime: string | null;
}) {
  const t = useTranslations("sessions");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Giờ vừa bấm Lưu, hiện ngay trong lúc server chưa trả lời. */
  const [pending, setPending] = useState<Draft | null>(null);

  const fromServer = {
    start: startTime ?? DEFAULT_START,
    end: endTime ?? DEFAULT_END,
  };
  const basedOn = `${fromServer.start}|${fromServer.end}`;

  const cur = draft?.basedOn === basedOn ? draft : { basedOn, ...fromServer };
  const display = pending?.basedOn === basedOn ? pending : fromServer;

  function handleSave() {
    setOpen(false);
    setPending({ basedOn, start: cur.start, end: cur.end });
    fireAction(
      () => setSessionTime(sessionId, cur.start, cur.end),
      () => {
        // Server từ chối: trả giờ cũ về và mở lại hộp thoại để admin sửa
        // tiếp, chứ không bỏ họ lại với một cái toast lỗi và giờ sai trên thẻ.
        setPending(null);
        setOpen(true);
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={t("editTime")}
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1.5 text-sm whitespace-nowrap tabular-nums"
          />
        }
      >
        <Clock className="h-4 w-4" />
        {display.start} – {display.end}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("editTimeTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("startTime")}</Label>
            {/* `key` theo giá trị server: TimeSelect15 giữ state riêng nên
                phải dựng lại thì dropdown mới nhảy theo giờ mới. */}
            <TimeSelect15
              key={`start-${fromServer.start}`}
              defaultValue={fromServer.start}
              onValueChange={(v) =>
                setDraft({ basedOn, start: v, end: cur.end })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("endTime")}</Label>
            <TimeSelect15
              key={`end-${fromServer.end}`}
              defaultValue={fromServer.end}
              onValueChange={(v) =>
                setDraft({ basedOn, start: cur.start, end: v })
              }
            />
          </div>
          <Button onClick={handleSave} className="min-h-11 w-full">
            {t("editTimeSave")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
