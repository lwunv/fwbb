"use client";

import Link from "next/link";
import { format, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatVND } from "@/lib/utils";
import { MemberAvatar } from "@/components/shared/member-avatar";
import {
  Wallet,
  AlertTriangle,
  Users,
  CalendarDays,
  ArrowRight,
  Clock,
  MapPin,
  CheckCircle,
  Package,
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
}

interface RecentPayment {
  id: number;
  memberId: number;
  memberName: string;
  sessionDate: string;
  amount: number;
  confirmedAt: string;
}

interface DashboardClientProps {
  totalOutstanding: number;
  totalStockQua: number;
  activeMembersCount: number;
  sessionsThisMonth: number;
  upcomingSession: UpcomingSession | null;
  recentPayments: RecentPayment[];
}

function formatDateShort(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "dd/MM", { locale: vi });
  } catch {
    return dateStr;
  }
}

function formatDateFull(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE, dd/MM/yyyy", { locale: vi });
  } catch {
    return dateStr;
  }
}

export function DashboardClient({
  totalOutstanding,
  totalStockQua,
  activeMembersCount,
  sessionsThisMonth,
  upcomingSession,
  recentPayments,
}: DashboardClientProps) {
  const tf = useTranslations("finance");
  const td = useTranslations("dashboard");

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-destructive/10 p-2">
                <Wallet className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {tf("outstandingDebt")}
                </p>
                <p className="text-sm font-bold">
                  {formatVND(totalOutstanding)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={`rounded-lg p-2 ${
                totalStockQua < 12 ? "bg-red-500/10" : totalStockQua <= 40 ? "bg-amber-500/10" : "bg-green-500/10"
              }`}>
                <Package className={`h-4 w-4 ${
                  totalStockQua < 12 ? "text-red-500" : totalStockQua <= 40 ? "text-amber-500" : "text-green-500"
                }`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {tf("shuttleStock")}
                </p>
                <p className={`text-sm font-bold ${
                  totalStockQua < 12 ? "text-red-600" : totalStockQua <= 40 ? "text-amber-600" : "text-green-600"
                }`}>
                  {totalStockQua} quả
                </p>
              </div>
            </div>
            {totalStockQua < 12 && (
              <p className="text-xs text-red-500 mt-1">⚠ Mua thêm cầu!</p>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {td("members")}
                </p>
                <p className="text-sm font-bold">{activeMembersCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-accent/10 p-2">
                <CalendarDays className="h-4 w-4 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground truncate">
                  {td("sessionsThisMonth")}
                </p>
                <p className="text-sm font-bold">{sessionsThisMonth}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low stock warning detail */}
      {totalStockQua < 12 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-sm">
                  ⚠ Cầu sắp hết! Còn <strong>{totalStockQua} quả</strong> — mua thêm cầu!
                </span>
              </div>
              <Link href="/admin/inventory">
                <Button variant="ghost" size="sm">
                  {tf("view")}
                  <ArrowRight className="h-3 w-3 ml-1" />
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
              <Badge variant="outline">{upcomingSession.status}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcomingSession ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span className="capitalize">
                    {formatDateFull(upcomingSession.date)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {upcomingSession.startTime} - {upcomingSession.endTime}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {upcomingSession.courtName || td("courtNotSelected")}
                  </span>
                  {upcomingSession.courtMapLink && (
                    <a
                      href={upcomingSession.courtMapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-xs hover:underline"
                    >
                      📍 Chỉ đường
                    </a>
                  )}
                </div>
                <div className="flex gap-4 text-sm pt-1">
                  <span>🏸 Cầu lông: <strong>{upcomingSession.playerCount}</strong> người</span>
                  <span>🍻 Nhậu: <strong>{upcomingSession.dinerCount}</strong> người</span>
                </div>
              </div>
              <Link href={`/admin/sessions/${upcomingSession.id}`}>
                <Button size="sm" className="w-full">
                  {td("manageSession")}
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {td("noUpcoming")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{tf("recentPayments")}</span>
            <Link href="/admin/finance">
              <Button variant="ghost" size="sm">
                {tf("viewAll")}
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {tf("noPayments")}
            </p>
          ) : (
            <div className="space-y-2">
              {recentPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-1.5 border-b last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <MemberAvatar memberId={p.memberId} size={24} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {p.memberName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {tf("session")} {formatDateShort(p.sessionDate)}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-green-600 shrink-0 ml-2">
                    {formatVND(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/admin/sessions">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{td("manageSessions")}</span>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/finance">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <Wallet className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{td("financeLink")}</span>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
