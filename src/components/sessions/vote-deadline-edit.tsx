"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setVoteDeadline, extendVoteDeadline } from "@/actions/sessions";
import { fireAction } from "@/lib/optimistic-action";
import { Calendar } from "lucide-react";

interface VoteDeadlineEditProps {
  sessionId: number;
  /** Current deadline to seed the picker. NULL = empty. */
  current: string | null;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  // <input type="datetime-local"> expects "YYYY-MM-DDTHH:MM" (no seconds).
  return iso.slice(0, 16);
}

export function VoteDeadlineEdit({
  sessionId,
  current,
}: VoteDeadlineEditProps) {
  const t = useTranslations("voting");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => toDatetimeLocalValue(current));

  function handleSet() {
    // datetime-local returns "YYYY-MM-DDTHH:MM"; pad seconds to match stored
    // format `YYYY-MM-DDTHH:MM:SS`.
    const deadline = value ? `${value}:00` : null;
    setOpen(false);
    fireAction(() => setVoteDeadline(sessionId, deadline));
  }

  function handleClear() {
    setOpen(false);
    fireAction(() => setVoteDeadline(sessionId, null));
  }

  function handleExtend(hours: 2 | 24) {
    setOpen(false);
    fireAction(() => extendVoteDeadline(sessionId, hours));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5" />
        }
      >
        <Calendar className="h-4 w-4" />
        {t("voteDeadlineSet")}
      </DialogTrigger>
      <DialogContent className="max-w-sm space-y-3">
        <DialogHeader>
          <DialogTitle>{t("voteDeadlineSet")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button onClick={handleSet} className="min-h-11 w-full">
            {t("voteDeadlineSet")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleExtend(2)}
            className="min-h-11 flex-1"
          >
            {t("voteDeadlineExtend2h")}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExtend(24)}
            className="min-h-11 flex-1"
          >
            {t("voteDeadlineExtend24h")}
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={handleClear}
          className="text-destructive min-h-11 w-full"
        >
          {t("voteDeadlineClear")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
