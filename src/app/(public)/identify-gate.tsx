"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { identifyUser } from "@/actions/identify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CircleDot, LogIn } from "lucide-react";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

export function IdentifyGate({ members }: { members: Member[] }) {
  const [selectedMemberId, setSelectedMemberId] = useState<number | "">("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const t = useTranslations("identify");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMemberId) {
      setError(t("pleaseSelectName"));
      return;
    }
    setIsLoading(true);
    setError("");

    const formData = new FormData();
    formData.set("memberId", String(selectedMemberId));
    formData.set("phone", phone);

    const result = await identifyUser(formData);
    if (result.error) {
      setError(result.error);
      setIsLoading(false);
      return;
    }
    // Page will revalidate and re-render the layout
  }

  const selectedMember = members.find((m) => m.id === selectedMemberId);

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="p-6 space-y-6">
        <div className="text-center space-y-2">
          <CircleDot className="h-10 w-10 text-primary mx-auto" />
          <h1 className="text-xl font-bold">FWBB</h1>
          <p className="text-sm text-muted-foreground">
            {t("selectNameAndPhone")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{t("selectYourName")}</Label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedMemberId(member.id)}
                  className={`flex items-center gap-2 p-2 rounded-lg border text-left text-sm transition-colors ${
                    selectedMemberId === member.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent"
                  }`}
                >
                  <MemberAvatar memberId={member.id} size={24} />
                  <span className="truncate">{member.name}</span>
                </button>
              ))}
            </div>
            {members.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("noMembers")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="0912345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              minLength={10}
              maxLength={11}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !selectedMemberId}
          >
            <LogIn className="h-4 w-4 mr-2" />
            {isLoading ? t("confirming") : t("confirm")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
