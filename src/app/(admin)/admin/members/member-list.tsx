"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createMember, updateMember, toggleMemberActive } from "@/actions/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, UserX, UserCheck } from "lucide-react";
import { MemberAvatar } from "@/components/shared/member-avatar";
import type { InferSelectModel } from "drizzle-orm";
import type { members as membersTable } from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;

export function MemberList({ members }: { members: Member[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const t = useTranslations("adminMembers");
  const tCommon = useTranslations("common");

  async function handleSubmit(formData: FormData) {
    if (editingMember) {
      await updateMember(editingMember.id, formData);
    } else {
      await createMember(formData);
    }
    setDialogOpen(false);
    setEditingMember(null);
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-muted-foreground">{t("count", { count: members.length })}</p>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingMember(null);
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="h-4 w-4 mr-2" /> {t("addMember")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingMember ? t("editMember") : t("addNewMember")}
              </DialogTitle>
            </DialogHeader>
            <form action={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("name")}</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={editingMember?.name ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{t("phone")}</Label>
                <Input
                  id="phone"
                  name="phone"
                  defaultValue={editingMember?.phone ?? ""}
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {editingMember ? t("update") : tCommon("add")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {members.map((member) => (
          <Card key={member.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <MemberAvatar memberId={member.id} size={36} />
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-sm text-muted-foreground">{member.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={member.isActive ? "default" : "secondary"}>
                  {member.isActive ? t("active") : t("inactive")}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingMember(member);
                    setDialogOpen(true);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <form action={async () => { await toggleMemberActive(member.id); }}>
                  <Button variant="ghost" size="icon" type="submit">
                    {member.isActive ? (
                      <UserX className="h-4 w-4" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
