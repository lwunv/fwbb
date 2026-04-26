"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NumberStepper } from "@/components/ui/number-stepper";
import { CustomSelect } from "@/components/ui/custom-select";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { formatK } from "@/lib/utils";
import {
  calculateSessionCosts,
  type AttendeeInput,
  type ShuttlecockInput,
  type CostBreakdown,
} from "@/lib/cost-calculator";
import { finalizeSession, type FinalizeAttendee } from "@/actions/finance";
import { fireAction } from "@/lib/optimistic-action";
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
  const votedPlayerIds = new Set(
    votes.filter((v) => v.willPlay).map((v) => v.memberId),
  );
  const votedDinerIds = new Set(
    votes.filter((v) => v.willDine).map((v) => v.memberId),
  );

  const [playerIds, setPlayerIds] = useState<Set<number>>(
    new Set(votedPlayerIds),
  );
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
  const [newGuestInviterId, setNewGuestInviterId] = useState<number | null>(
    null,
  );
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

  function handleFinalize() {
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

    fireAction(
      () => finalizeSession(sessionId, finalAttendees, diningBill),
      () => {
        setIsLoading(false);
      },
      { retry: false },
    );
  }

  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    {
      key: "players",
      label: t("players"),
      icon: <Users className="h-4 w-4" />,
    },
    {
      key: "diners",
      label: t("diners"),
      icon: <UtensilsCrossed className="h-4 w-4" />,
    },
    { key: "guests", label: t("guests"), icon: <Plus className="h-4 w-4" /> },
    {
      key: "dining-bill",
      label: t("diningBill"),
      icon: <Calculator className="h-4 w-4" />,
    },
    {
      key: "preview",
      label: t("confirm"),
      icon: <CheckCircle className="h-4 w-4" />,
    },
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
      {/* Step indicator — 44px tap target */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            className={`flex min-h-11 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              i === currentStepIndex
                ? "bg-primary text-primary-foreground"
                : i < currentStepIndex
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {s.icon}
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Step: Players */}
      {step === "players" && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Users className="h-4 w-4" />
              {t("selectPlayers")} ({playerIds.size})
            </h3>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="hover:bg-muted flex min-h-11 cursor-pointer items-center gap-3 rounded-lg p-2"
                >
                  <input
                    type="checkbox"
                    checked={playerIds.has(m.id)}
                    onChange={() => togglePlayer(m.id)}
                    className="accent-primary h-6 w-6 rounded"
                    aria-label={m.name}
                  />
                  <MemberAvatar
                    memberId={m.id}
                    avatarKey={m.avatarKey}
                    avatarUrl={m.avatarUrl}
                    size={32}
                  />
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
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <UtensilsCrossed className="h-4 w-4" />
              {t("selectDiners")} ({dinerIds.size})
            </h3>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="hover:bg-muted flex min-h-11 cursor-pointer items-center gap-3 rounded-lg p-2"
                >
                  <input
                    type="checkbox"
                    checked={dinerIds.has(m.id)}
                    onChange={() => toggleDiner(m.id)}
                    className="accent-primary h-6 w-6 rounded"
                    aria-label={m.name}
                  />
                  <MemberAvatar
                    memberId={m.id}
                    avatarKey={m.avatarKey}
                    avatarUrl={m.avatarUrl}
                    size={32}
                  />
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
          <CardContent className="space-y-4 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Plus className="h-4 w-4" />
              {t("guestExchange")} ({guests.length})
            </h3>

            {/* Existing guests */}
            {guests.length > 0 && (
              <div className="space-y-2">
                {guests.map((g, i) => (
                  <div
                    key={i}
                    className="bg-muted/50 flex items-center gap-2 rounded-lg p-2 text-sm"
                  >
                    <span className="flex-1 font-medium">{g.name}</span>
                    <span className="text-muted-foreground text-xs">
                      ({g.invitedByName})
                    </span>
                    <div className="flex gap-1">
                      {g.attendsPlay && (
                        <Badge variant="outline" className="text-xs">
                          {t("play")}
                        </Badge>
                      )}
                      {g.attendsDine && (
                        <Badge variant="outline" className="text-xs">
                          {t("dine")}
                        </Badge>
                      )}
                    </div>
                    <button
                      onClick={() => removeGuest(i)}
                      className="text-destructive hover:text-destructive/80 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add guest form */}
            <div className="space-y-3 border-t pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>{t("guestName")}</Label>
                  <Input
                    value={newGuestName}
                    onChange={(e) => setNewGuestName(e.target.value)}
                    placeholder={t("enterName")}
                  />
                </div>
                <div>
                  <Label>{t("invitedBy")}</Label>
                  <CustomSelect
                    value={String(newGuestInviterId ?? "")}
                    onChange={(v) => setNewGuestInviterId(Number(v) || null)}
                    placeholder={t("select")}
                    options={members.map((m) => ({
                      value: String(m.id),
                      label: m.name,
                    }))}
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newGuestPlays}
                    onChange={(e) => setNewGuestPlays(e.target.checked)}
                    className="accent-primary h-4 w-4 rounded"
                  />
                  {t("playBadminton")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newGuestDines}
                    onChange={(e) => setNewGuestDines(e.target.checked)}
                    className="accent-primary h-4 w-4 rounded"
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
                <Plus className="mr-1 h-4 w-4" />
                {t("addGuest")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Dining Bill */}
      {step === "dining-bill" && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Calculator className="h-4 w-4" />
              {t("diningBillTitle")}
            </h3>
            <div>
              <Label>{t("totalDiningVND")}</Label>
              <NumberStepper
                value={diningBill}
                onChange={setDiningBill}
                min={0}
                step={50000}
              />
              {diningBill > 0 && (
                <p className="text-muted-foreground mt-1 text-sm">
                  {formatK(diningBill)}
                </p>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
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
            <CardContent className="space-y-3 p-4">
              <h3 className="font-semibold">{t("costSummary")}</h3>
              <div className="grid grid-cols-2 gap-2 text-base">
                <span className="text-muted-foreground text-sm">
                  {t("courtCost")}:
                </span>
                <span className="text-right font-semibold">
                  {formatK(preview.courtPrice)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t("shuttlecockCost")}:
                </span>
                <span className="text-right font-semibold">
                  {formatK(preview.totalShuttlecockCost)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t("diningCost")}:
                </span>
                <span className="text-right font-semibold">
                  {formatK(preview.diningBill)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t pt-2 text-base">
                <span className="text-muted-foreground text-sm">
                  {t("playerCount")}:
                </span>
                <span className="text-right font-semibold">
                  {preview.totalPlayers}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t("dinerCount")}:
                </span>
                <span className="text-right font-semibold">
                  {preview.totalDiners}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t pt-2 text-base">
                <span className="text-muted-foreground text-sm">
                  {t("costPerPlayer")}:
                </span>
                <span className="text-primary text-right font-semibold">
                  {formatK(preview.playCostPerHead)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t("costPerDiner")}:
                </span>
                <span className="text-primary text-right font-semibold">
                  {formatK(preview.dineCostPerHead)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Per-member breakdown */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h3 className="font-semibold">{t("debtDetail")}</h3>
              <div className="space-y-3">
                {preview.memberDebts.map((debt) => {
                  const member = members.find((m) => m.id === debt.memberId);
                  return (
                    <div
                      key={debt.memberId}
                      className="bg-muted/50 flex items-start gap-3 rounded-lg p-2"
                    >
                      <MemberAvatar
                        memberId={debt.memberId}
                        avatarKey={member?.avatarKey}
                        avatarUrl={member?.avatarUrl}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold">
                          {member?.name ?? `ID ${debt.memberId}`}
                        </div>
                        <div className="text-muted-foreground mt-1 space-y-0.5 text-sm">
                          {debt.playAmount > 0 && (
                            <div>
                              {t("play")}: {formatK(debt.playAmount)}
                            </div>
                          )}
                          {debt.dineAmount > 0 && (
                            <div>
                              {t("dine")}: {formatK(debt.dineAmount)}
                            </div>
                          )}
                          {debt.guestPlayAmount > 0 && (
                            <div>
                              {t("guestPlay")}: {formatK(debt.guestPlayAmount)}
                            </div>
                          )}
                          {debt.guestDineAmount > 0 && (
                            <div>
                              {t("guestDine")}: {formatK(debt.guestDineAmount)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-primary text-sm font-bold">
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
      <div className="bg-background/95 fixed right-0 bottom-0 left-0 z-30 border-t p-4 backdrop-blur sm:relative sm:border-t-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-lg gap-3">
          {currentStepIndex > 0 && (
            <Button variant="outline" onClick={goPrev} className="flex-1">
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t("back")}
            </Button>
          )}
          {currentStepIndex < steps.length - 1 && (
            <Button onClick={goNext} className="flex-1">
              {t("next")}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === "preview" && (
            <Button
              onClick={handleFinalize}
              disabled={isLoading}
              className="flex-1"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {isLoading ? tCommon("processing") : t("completeSession")}
            </Button>
          )}
        </div>
      </div>
      {/* Spacer for mobile to not hide content under sticky bar */}
      <div className="h-16 sm:hidden" />

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
