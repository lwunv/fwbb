"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { identifyUser } from "@/actions/identify";
import { Card, CardContent } from "@/components/ui/card";
import { CircleDot } from "lucide-react";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

export function IdentifyGate({ members }: { members: Member[] }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const t = useTranslations("identify");

  function handleSelectMember(memberId: number) {
    setSelectedId(memberId);
    setError("");

    startTransition(async () => {
      const formData = new FormData();
      formData.set("memberId", String(memberId));
      formData.set("phone", "");

      const result = await identifyUser(formData);
      if (result.error) {
        setError(result.error);
        setSelectedId(null);
      }
      // On success, layout will re-render with user identified
    });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <CircleDot className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-xl font-bold">FWBB</h1>
          <p className="text-sm text-muted-foreground">
            {t("selectYourName")}
          </p>
        </div>

        {/* Member grid — tap to login */}
        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
          {members.map((member) => {
            const isSelected = selectedId === member.id;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => handleSelectMember(member.id)}
                disabled={isPending}
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 scale-95"
                    : "border-border hover:bg-accent"
                } ${isPending && !isSelected ? "opacity-50" : ""}`}
              >
                <MemberAvatar memberId={member.id} size={28} />
                <span className="truncate font-medium">{member.name}</span>
                {isSelected && isPending && (
                  <span className="ml-auto text-xs text-primary animate-pulse">...</span>
                )}
              </button>
            );
          })}
        </div>

        {members.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("noMembers")}
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
