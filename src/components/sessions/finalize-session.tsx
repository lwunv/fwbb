"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import {
  calculateSessionCosts,
  type AttendeeInput,
  type ShuttlecockInput,
  type CostBreakdown,
} from "@/lib/cost-calculator";
import { finalizeSession, type FinalizeAttendee } from "@/actions/finance";
import {
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Users,
  UtensilsCrossed,
  Calculator,
} from "lucide-react";
import type { InferSelectModel } from "drizzle-orm";
import type {
  members as membersTable,
  votes as votesTable,
  sessionShuttlecocks as sessionShuttlecocksTable,
} from "@/db/schema";

type Member = InferSelectModel<typeof membersTable>;
type Vote = InferSelectModel<typeof votesTable> & { member: Member };
type SessionShuttlecock = InferSelectModel<typeof sessionShuttlecocksTable>;

interface AttendeeEntry {
  memberId: number | null;
  memberName: string;
  guestName: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
}

interface GuestEntry {
  name: string;
  invitedById: number;
  invitedByName: string;
  attendsPlay: boolean;
  attendsDine: boolean;
}

interface FinalizeSessionProps {
  sessionId: number;
  courtPrice: number;
  votes: Vote[];
  members: Member[];
  shuttlecocks: SessionShuttlecock[];
}

type Step = "players" | "diners" | "guests" | "dining-bill" | "preview";

export function FinalizeSession({
  sessionId,
  courtPrice,
  votes,
  members,
  shuttlecocks,
}: FinalizeSessionProps) {
  const [step, setStep] = useState<Step>("players");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const t = useTranslations("finalize");
  const tCommon = useTranslations("common");

  // Initialize from votes
  const votedPlayerIds = new Set(votes.filter((v) => v.willPlay).map((v) => v.memberId));
  const votedDinerIds = new Set(votes.filter((v) => v.willDine).map((v) => v.memberId));

  const [playerIds, setPlayerIds] = useState<Set<number>>(new Set(votedPlayerIds));
  const [dinerIds, setDinerIds] = useState<Set<number>>(new Set(votedDinerIds));
  const [guests, setGuests] = useState<GuestEntry[]>(() => {
    // Initialize guests from votes with guestPlayCount/guestDineCount
    const initial: GuestEntry[] = [];
    for (const v of votes) {
      for (let i = 0; i < (v.guestPlayCount ?? 0); i++) {
        initial.push({
          name: `${t("guests")} ${i + 1} (${v.member.name})`,
          invitedById: v.memberId,
          invitedByName: v.member.name,
          attendsPlay: true,
          attendsDine: false,
        });
      }
      for (let i = 0; i < (v.guestDineCount ?? 0); i++) {
        // Check if already matched a play guest
        const existingPlayGuest = initial.find(
          (g) =>
            g.invitedById === v.memberId &&
            g.attendsPlay &&
            !g.attendsDine &&
            i < (v.guestPlayCount ?? 0),
        );
        if (existingPlayGuest && i < (v.guestPlayCount ?? 0)) {
          existingPlayGuest.attendsDine = true;
        } else {
          initial.push({
            name: `${t("guestDine")} ${i + 1} (${v.member.name})`,
            invitedById: v.memberId,
            invitedByName: v.member.name,
            attendsPlay: false,
            attendsDine: true,
          });
        }
      }
    }
    return initial;
  });
  const [diningBill, setDiningBill] = useState(0);

  // New guest form
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestInviterId, setNewGuestInviterId] = useState<number | null>(null);
  const [newGuestPlays, setNewGuestPlays] = useState(true);
  const [newGuestDines, setNewGuestDines] = useState(false);

  function togglePlayer(memberId: number) {
    setPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }

  function toggleDiner(memberId: number) {
    setDinerIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }

  function addGuest() {
    if (!newGuestName.trim() || !newGuestInviterId) return;
    const inviter = members.find((m) => m.id === newGuestInviterId);
    setGuests((prev) => [
      ...prev,
      {
        name: newGuestName.trim(),
        invitedById: newGuestInviterId,
        invitedByName: inviter?.name ?? "",
        attendsPlay: newGuestPlays,
        attendsDine: newGuestDines,
      },
    ]);
    setNewGuestName("");
    setNewGuestPlays(true);
    setNewGuestDines(false);
  }

  function removeGuest(index: number) {
    setGuests((prev) => prev.filter((_, i) => i !== index));
  }

  // Build attendees list for preview
  const attendeeList: AttendeeEntry[] = useMemo(() => {
    const list: AttendeeEntry[] = [];

    // Add members
    const allMemberIds = new Set([...playerIds, ...dinerIds]);
    for (const memberId of allMemberIds) {
      const member = members.find((m) => m.id === memberId);
      list.push({
        memberId,
        memberName: member?.name ?? `ID ${memberId}`,
        guestName: null,
        invitedById: null,
        isGuest: false,
        attendsPlay: playerIds.has(memberId),
        attendsDine: dinerIds.has(memberId),
      });
    }

    // Add guests
    for (const g of guests) {
      list.push({
        memberId: null,
        memberName: g.name,
        guestName: g.name,
        invitedById: g.invitedById,
        isGuest: true,
        attendsPlay: g.attendsPlay,
        attendsDine: g.attendsDine,
      });
    }

    return list;
  }, [playerIds, dinerIds, guests, members]);

  // Calculate cost preview
  const preview: CostBreakdown | null = useMemo(() => {
    if (step !== "preview") return null;

    const attendeeInputs: AttendeeInput[] = attendeeList.map((a) => ({
      memberId: a.memberId,
      guestName: a.guestName,
      invitedById: a.invitedById,
      isGuest: a.isGuest,
      attendsPlay: a.attendsPlay,
      attendsDine: a.attendsDine,
    }));

    const shuttlecockInputs: ShuttlecockInput[] = shuttlecocks.map((s) => ({
      quantityUsed: s.quantityUsed,
      pricePerTube: s.pricePerTube,
    }));

    return calculateSessionCosts(
      { courtPrice, diningBill },
      attendeeInputs,
      shuttlecockInputs,
    );
  }, [step, attendeeList, shuttlecocks, courtPrice, diningBill]);

  async function handleFinalize() {
    setIsLoading(true);
    setError("");

    const finalAttendees: FinalizeAttendee[] = attendeeList.map((a) => ({
      memberId: a.memberId,
      guestName: a.guestName,
      invitedById: a.invitedById,
      isGuest: a.isGuest,
      attendsPlay: a.attendsPlay,
      attendsDine: a.attendsDine,
    }));

    const result = await finalizeSession(sessionId, finalAttendees, diningBill);
    if (result.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: "players", label: t("players"), icon: <Users className="h-4 w-4" /> },
    { key: "diners", label: t("diners"), icon: <UtensilsCrossed className="h-4 w-4" /> },
    { key: "guests", label: t("guests"), icon: <Plus className="h-4 w-4" /> },
    { key: "dining-bill", label: t("diningBill"), icon: <Calculator className="h-4 w-4" /> },
    { key: "preview", label: t("confirm"), icon: <CheckCircle className="h-4 w-4" /> },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  function goNext() {
    if (currentStepIndex < steps.length - 1) {
      setStep(steps[currentStepIndex + 1].key);
    }
  }

  function goPrev() {
    if (currentStepIndex > 0) {
      setStep(steps[currentStepIndex - 1].key);
    }
  }

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              i === currentStepIndex
                ? "bg-primary text-primary-foreground"
                : i < currentStepIndex
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {s.icon}
            <span className="hidden sm:inline">{s.label}</span>
            <span className="sm:hidden">{i + 1}</span>
          </button>
        ))}
      </div>

      {/* Step: Players */}
      {step === "players" && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              {t("selectPlayers")} ({playerIds.size})
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={playerIds.has(m.id)}
                    onChange={() => togglePlayer(m.id)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <MemberAvatar memberId={m.id} avatarKey={m.avatarKey} size={32} />
                  <span className="text-sm font-medium">{m.name}</span>
                  {votedPlayerIds.has(m.id) && (
                    <Badge variant="outline" className="ml-auto text-xs">
                      {t("voted")}
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Diners */}
      {step === "diners" && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4" />
              {t("selectDiners")} ({dinerIds.size})
            </h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={dinerIds.has(m.id)}
                    onChange={() => toggleDiner(m.id)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <MemberAvatar memberId={m.id} avatarKey={m.avatarKey} size={32} />
                  <span className="text-sm font-medium">{m.name}</span>
                  {votedDinerIds.has(m.id) && (
                    <Badge variant="outline" className="ml-auto text-xs">
                      {t("voted")}
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Guests */}
      {step === "guests" && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t("guestExchange")} ({guests.length})
            </h3>

            {/* Existing guests */}
            {guests.length > 0 && (
              <div className="space-y-2">
                {guests.map((g, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm"
                  >
                    <span className="flex-1 font-medium">{g.name}</span>
                    <span className="text-muted-foreground text-xs">
                      ({g.invitedByName})
                    </span>
                    <div className="flex gap-1">
                      {g.attendsPlay && (
                        <Badge variant="outline" className="text-xs">{t("play")}</Badge>
                      )}
                      {g.attendsDine && (
                        <Badge variant="outline" className="text-xs">{t("dine")}</Badge>
                      )}
                    </div>
                    <button
                      onClick={() => removeGuest(i)}
                      className="text-destructive hover:text-destructive/80 p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add guest form */}
            <div className="space-y-3 border-t pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("guestName")}</Label>
                  <Input
                    value={newGuestName}
                    onChange={(e) => setNewGuestName(e.target.value)}
                    placeholder={t("enterName")}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t("invitedBy")}</Label>
                  <select
                    value={newGuestInviterId ?? ""}
                    onChange={(e) => setNewGuestInviterId(Number(e.target.value) || null)}
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    <option value="">{t("select")}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newGuestPlays}
                    onChange={(e) => setNewGuestPlays(e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  {t("playBadminton")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newGuestDines}
                    onChange={(e) => setNewGuestDines(e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  {t("dineOut")}
                </label>
              </div>
              <Button
                onClick={addGuest}
                disabled={!newGuestName.trim() || !newGuestInviterId}
                size="sm"
                variant="outline"
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("addGuest")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Dining Bill */}
      {step === "dining-bill" && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              {t("diningBillTitle")}
            </h3>
            <div>
              <Label>{t("totalDiningVND")}</Label>
              <Input
                type="number"
                value={diningBill || ""}
                onChange={(e) => setDiningBill(Number(e.target.value) || 0)}
                placeholder="0"
                min={0}
                step={1000}
              />
              {diningBill > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {formatK(diningBill)}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("enterZeroIfNone")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {/* Summary */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold">{t("costSummary")}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">{t("courtCost")}:</span>
                <span className="text-right font-medium">{formatK(preview.courtPrice)}</span>
                <span className="text-muted-foreground">{t("shuttlecockCost")}:</span>
                <span className="text-right font-medium">{formatK(preview.totalShuttlecockCost)}</span>
                <span className="text-muted-foreground">{t("diningCost")}:</span>
                <span className="text-right font-medium">{formatK(preview.diningBill)}</span>
              </div>
              <div className="border-t pt-2 grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">{t("playerCount")}:</span>
                <span className="text-right font-medium">{preview.totalPlayers}</span>
                <span className="text-muted-foreground">{t("dinerCount")}:</span>
                <span className="text-right font-medium">{preview.totalDiners}</span>
              </div>
              <div className="border-t pt-2 grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">{t("costPerPlayer")}:</span>
                <span className="text-right font-medium text-primary">
                  {formatK(preview.playCostPerHead)}
                </span>
                <span className="text-muted-foreground">{t("costPerDiner")}:</span>
                <span className="text-right font-medium text-primary">
                  {formatK(preview.dineCostPerHead)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Per-member breakdown */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold">{t("debtDetail")}</h3>
              <div className="space-y-3">
                {preview.memberDebts.map((debt) => {
                  const member = members.find((m) => m.id === debt.memberId);
                  return (
                    <div
                      key={debt.memberId}
                      className="flex items-start gap-3 p-2 rounded-lg bg-muted/50"
                    >
                      <MemberAvatar
                        memberId={debt.memberId}
                        avatarKey={member?.avatarKey}
                        size={32}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          {member?.name ?? `ID ${debt.memberId}`}
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                          {debt.playAmount > 0 && (
                            <div>{t("play")}: {formatK(debt.playAmount)}</div>
                          )}
                          {debt.dineAmount > 0 && (
                            <div>{t("dine")}: {formatK(debt.dineAmount)}</div>
                          )}
                          {debt.guestPlayAmount > 0 && (
                            <div>{t("guestPlay")}: {formatK(debt.guestPlayAmount)}</div>
                          )}
                          {debt.guestDineAmount > 0 && (
                            <div>{t("guestDine")}: {formatK(debt.guestDineAmount)}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-primary">
                        {formatK(debt.totalAmount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-3">
        {currentStepIndex > 0 && (
          <Button variant="outline" onClick={goPrev} className="flex-1">
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t("back")}
          </Button>
        )}
        {currentStepIndex < steps.length - 1 && (
          <Button onClick={goNext} className="flex-1">
            {t("next")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
        {step === "preview" && (
          <Button
            onClick={handleFinalize}
            disabled={isLoading}
            className="flex-1"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {isLoading ? tCommon("processing") : t("completeSession")}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
