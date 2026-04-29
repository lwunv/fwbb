"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { formatSessionDate } from "@/lib/date-format";
import type { AppLocale } from "@/lib/date-fns-locale";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/shared/stat-card";
import { Input } from "@/components/ui/input";
import { formatK } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
import { updateAppName } from "@/actions/settings";
import { fireAction } from "@/lib/optimistic-action";
import { usePolling } from "@/lib/use-polling";
import {
  Wallet,
  AlertTriangle,
  Users,
  CalendarDays,
  ArrowRight,
  Clock,
  MapPin,
  Navigation,
  Package,
  Pencil,
  Check,
} from "lucide-react";

interface UpcomingSession {
  id: number;
  date: string;
  status: string;
  courtName: string | null;
  courtMapLink: string | null;
  startTime: string;
  endTime: string;
  playerCount: number;
  dinerCount: number;
  guestPlayCount: number;
  guestDineCount: number;
}

interface OwingMember {
  memberId: number;
  memberName: string;
  memberAvatarKey: string | null;
  memberAvatarUrl: string | null;
  amount: number;
}

interface DashboardClientProps {
  appName?: string;
  totalOutstanding: number;
  owingCount: number;
  topOwingMembers: OwingMember[];
  totalStockQua: number;
  activeMembersCount: number;
  sessionsThisMonth: number;
  upcomingSession: UpcomingSession | null;
}

export function DashboardClient({
  appName = "FWBB",
  totalOutstanding,
  owingCount,
  topOwingMembers,
  totalStockQua,
  activeMembersCount,
  sessionsThisMonth,
  upcomingSession,
}: DashboardClientProps) {
  const tf = useTranslations("finance");
  const td = useTranslations("dashboard");
  const ts = useTranslations("sessions");
  const tInv = useTranslations("inventory");
  const locale = useLocale() as AppLocale;
  const formatDateFull = (d: string) =>
    formatSessionDate(d, "weekdayLong", locale);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(appName);
  const [saved, setSaved] = useState(false);
  usePolling();

  return (
    <div className="space-y-6">
      {/* App Name Editor */}
      <div className="flex items-center gap-3">
        {editingName ? (
          <form
            className="flex items-center gap-2"
            action={() => {
              setEditingName(false);
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
              fireAction(
                () => updateAppName(nameValue),
                () => {
                  setEditingName(true);
                  setSaved(false);
                },
              );
            }}
          >
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="w-48"
              autoFocus
            />
            <Button type="submit" size="sm" variant="outline">
              <Check className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-base transition-colors"
          >
            <span>
              {td("appName")}:{" "}
              <strong className="text-foreground">{appName}</strong>
            </span>
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {saved && (
          <span className="text-xs text-green-600">{td("appNameSaved")}</span>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={Wallet}
          iconClassName="bg-destructive/10 text-destructive"
          label={tf("outstandingDebt")}
          value={formatK(totalOutstanding)}
          href="/admin/fund"
        />

        <StatCard
          icon={Package}
          iconClassName={
            totalStockQua < 12
              ? "bg-red-500/10 text-red-500"
              : totalStockQua <= 40
                ? "bg-amber-500/10 text-amber-500"
                : "bg-green-500/10 text-green-500"
          }
          label={tf("shuttleStock")}
          value={
            <span
              className={
                totalStockQua < 12
                  ? "text-red-600"
                  : totalStockQua <= 40
                    ? "text-amber-600"
                    : "text-green-600"
              }
            >
              {totalStockQua} {tInv("piece")}
            </span>
          }
          href="/admin/inventory"
        />

        <StatCard
          icon={Users}
          iconClassName="bg-primary/10 text-primary"
          label={td("members")}
          value={activeMembersCount}
          href="/admin/members"
        />

        <StatCard
          icon={CalendarDays}
          iconClassName="bg-accent/10 text-accent"
          label={td("sessionsThisMonth")}
          value={sessionsThisMonth}
          href="/admin/sessions"
        />
      </div>

      {/* Low stock warning detail */}
      {totalStockQua < 12 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm">
                  {td("lowStockBanner", { count: totalStockQua })}
                </span>
              </div>
              <Link href="/admin/inventory">
                <Button variant="ghost" size="sm">
                  {tf("view")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Session */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{td("upcomingSession")}</span>
            {upcomingSession && (
              <Badge
                variant="outline"
                className={
                  upcomingSession.status === "voting"
                    ? "border-green-500 text-green-600 dark:border-green-600 dark:text-green-400"
                    : upcomingSession.status === "confirmed"
                      ? "border-green-500 text-green-600 dark:border-green-600 dark:text-green-400"
                      : upcomingSession.status === "completed"
                        ? "border-blue-500 text-blue-600 dark:border-blue-600 dark:text-blue-400"
                        : "border-destructive text-destructive"
                }
              >
                {ts(
                  upcomingSession.status as
                    | "voting"
                    | "confirmed"
                    | "completed"
                    | "cancelled",
                )}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingSession ? (
            <div className="space-y-3">
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 text-base">
                  <CalendarDays className="text-muted-foreground h-5 w-5" />
                  <span className="font-medium capitalize">
                    {formatDateFull(upcomingSession.date)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-base">
                  <Clock className="text-muted-foreground h-5 w-5" />
                  <span>
                    {upcomingSession.startTime} - {upcomingSession.endTime}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-base">
                  <MapPin className="text-muted-foreground h-5 w-5" />
                  <span>
                    {upcomingSession.courtName || td("courtNotSelected")}
                  </span>
                  {upcomingSession.courtMapLink && (
                    <a
                      href={upcomingSession.courtMapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                    >
                      <Navigation className="h-4 w-4" /> {ts("directions")}
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-base">
                  <span>
                    🏸 {ts("badminton")}:{" "}
                    <strong className="text-primary">
                      {upcomingSession.playerCount +
                        upcomingSession.guestPlayCount}
                    </strong>{" "}
                    {ts("people")}
                    {upcomingSession.guestPlayCount > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        ({upcomingSession.guestPlayCount} {ts("guest")})
                      </span>
                    )}
                  </span>
                  <span>
                    🍻 {ts("dining")}:{" "}
                    <strong className="text-orange-500 dark:text-orange-400">
                      {upcomingSession.dinerCount +
                        upcomingSession.guestDineCount}
                    </strong>{" "}
                    {ts("people")}
                    {upcomingSession.guestDineCount > 0 && (
                      <span className="tabular-nums">
                        {" "}
                        ({upcomingSession.guestDineCount} {ts("guest")})
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <Link href={`/admin/sessions/${upcomingSession.id}`}>
                <Button size="lg" className="w-full">
                  {td("manageSession")}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{td("noUpcoming")}</p>
          )}
        </CardContent>
      </Card>

      {/* Members owing — top 5 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive h-5 w-5" />
              Thành viên còn nợ quỹ
            </CardTitle>
            {owingCount > 0 && (
              <p className="text-muted-foreground mt-1 text-sm">
                <strong className="text-destructive tabular-nums">
                  {owingCount}
                </strong>{" "}
                người · tổng{" "}
                <strong className="text-destructive tabular-nums">
                  {formatK(totalOutstanding)}
                </strong>
              </p>
            )}
          </div>
          <Link href="/admin/fund">
            <Button variant="outline" size="sm">
              Xem tất cả
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="pb-4">
          {topOwingMembers.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Cả nhóm đang không nợ — quỹ ổn 🎉
            </p>
          ) : (
            <ul className="divide-y">
              {topOwingMembers.map((m) => (
                <li key={m.memberId} className="flex items-center gap-3 py-2.5">
                  <MemberAvatar
                    memberId={m.memberId}
                    avatarKey={m.memberAvatarKey}
                    avatarUrl={m.memberAvatarUrl}
                    size={32}
                  />
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {m.memberName}
                  </span>
                  <span className="text-destructive shrink-0 text-base font-bold tabular-nums">
                    −{formatK(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
