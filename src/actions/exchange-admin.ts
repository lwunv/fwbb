"use server";

import {
  and,
  desc,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import {
  abuseReports,
  exchangeEvents,
  exchangeRegistrations,
  members,
  venues,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  HOLDING_STATUSES,
  LIST_LIMIT,
  REPORT_STATUSES,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/exchange/constants";
import { cancelEventCore } from "@/lib/exchange/cancel";
import { exchangeGate } from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import { notifyEventHidden } from "@/lib/notifications/exchange-events";
import { isNotificationsEnabled } from "@/lib/notifications/notify";

// Mọi export là endpoint POST nên mỗi hàm tự kiểm: cờ, rồi admin từ cookie
// phiên (không bao giờ nhận từ input), rồi zod. Danh sách chỉ có tên, mã buổi,
// tên sân và số đếm; không có sđt/email của ai.

type Result<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { error: string };

export type AdminExchangeFilter = "upcoming" | "hidden" | "all";

export type AdminExchangeRow = {
  id: number;
  publicCode: string;
  title: string;
  status: string;
  startAt: string;
  hiddenAt: string | null;
  hostName: string;
  venueName: string;
  slotsTotal: number;
  holdingHeads: number;
};

export type AdminReportRow = {
  id: number;
  targetType: ReportTargetType;
  /** Tên buổi (target event) hoặc tên member (target member). */
  targetName: string;
  /** Mã buổi để dẫn link /giao-luu/{code}; `null` khi đối tượng là member. */
  eventCode: string | null;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  reporterName: string;
  createdAt: string;
  resolvedAt: string | null;
};

const filterSchema = z.enum(["upcoming", "hidden", "all"]);
const eventIdSchema = z.object({ eventId: z.number().int().positive() });
const hideSchema = eventIdSchema.extend({ hidden: z.boolean() });
const statusSchema = z.enum(REPORT_STATUSES);
const resolveSchema = z.object({
  reportId: z.number().int().positive(),
  status: z.enum(["resolved", "dismissed"]),
});

/** Cờ, rồi admin, rồi zod; trả dữ liệu đã parse hoặc `{ error }` đã dịch. */
async function guard<S extends z.ZodType>(
  schema: S,
  input: unknown,
): Promise<{ data: z.infer<S> } | { error: string }> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };
  const t = await getTranslations("exchange.errors");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  return { data: parsed.data };
}

export async function adminListExchanges(
  filter: unknown,
): Promise<Result<AdminExchangeRow[]>> {
  const g = await guard(filterSchema, filter);
  if ("error" in g) return g;

  const nowIso = new Date().toISOString();
  const where =
    g.data === "hidden"
      ? isNotNull(exchangeEvents.hiddenAt)
      : g.data === "upcoming"
        ? and(
            isNull(exchangeEvents.hiddenAt),
            inArray(exchangeEvents.status, ["open", "full", "locked"]),
            gte(exchangeEvents.startAt, nowIso),
          )
        : undefined;

  const rows = await db
    .select({
      id: exchangeEvents.id,
      publicCode: exchangeEvents.publicCode,
      title: exchangeEvents.title,
      status: exchangeEvents.status,
      startAt: exchangeEvents.startAt,
      hiddenAt: exchangeEvents.hiddenAt,
      hostName: members.name,
      venueName: venues.name,
      slotsTotal: exchangeEvents.slotsTotal,
    })
    .from(exchangeEvents)
    .innerJoin(members, eq(members.id, exchangeEvents.hostMemberId))
    .innerJoin(venues, eq(venues.id, exchangeEvents.venueId))
    .where(where)
    .orderBy(
      g.data === "upcoming"
        ? asc(exchangeEvents.startAt)
        : desc(exchangeEvents.startAt),
    )
    .limit(LIST_LIMIT);

  const heads = new Map<number, number>();
  if (rows.length > 0) {
    const regs = await db
      .select({
        eventId: exchangeRegistrations.eventId,
        maleCount: exchangeRegistrations.maleCount,
        femaleCount: exchangeRegistrations.femaleCount,
      })
      .from(exchangeRegistrations)
      .where(
        and(
          inArray(
            exchangeRegistrations.eventId,
            rows.map((r) => r.id),
          ),
          inArray(exchangeRegistrations.status, [...HOLDING_STATUSES]),
        ),
      );
    for (const r of regs)
      heads.set(
        r.eventId,
        (heads.get(r.eventId) ?? 0) + r.maleCount + r.femaleCount,
      );
  }

  return {
    success: true,
    data: rows.map((r) => ({ ...r, holdingHeads: heads.get(r.id) ?? 0 })),
  };
}

/** Ẩn báo host (chỉ lần chuyển từ hiện sang ẩn); hiện lại thì xoá `hiddenAt`. */
export async function adminSetExchangeHidden(input: unknown): Promise<Result> {
  const g = await guard(hideSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { eventId, hidden } = g.data;

  let outcome: Result;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<Result> => {
        const [ev] = await tx
          .select()
          .from(exchangeEvents)
          .where(eq(exchangeEvents.id, eventId))
          .limit(1);
        if (!ev) return { error: t("notFound") };

        const now = new Date();
        const nowIso = now.toISOString();
        if (!hidden) {
          await tx
            .update(exchangeEvents)
            .set({ hiddenAt: null, updatedAt: nowIso })
            .where(eq(exchangeEvents.id, eventId));
          return { success: true };
        }
        // Điều kiện hiddenAt IS NULL chặn gửi tin lần hai khi bấm lặp.
        const changed = await tx
          .update(exchangeEvents)
          .set({ hiddenAt: nowIso, updatedAt: nowIso })
          .where(
            and(
              eq(exchangeEvents.id, eventId),
              isNull(exchangeEvents.hiddenAt),
            ),
          )
          .returning({ id: exchangeEvents.id });
        if (changed.length > 0) {
          const notifyOn = await isNotificationsEnabled(tx);
          await notifyEventHidden(tx, { event: ev, now }, notifyOn);
        }
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] admin", { action: "hide", eventId });
    return { error: t("saveFailed") };
  }
  if ("success" in outcome) updateTag("exchange");
  return outcome;
}

/** Admin huỷ buổi: dùng chung lõi với host, tin cho người đã đăng ký. */
export async function adminCancelExchange(input: unknown): Promise<Result> {
  const g = await guard(eventIdSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const { eventId } = g.data;

  let outcome: Result;
  try {
    outcome = await runSerial(() =>
      db.transaction(async (tx): Promise<Result> => {
        const [ev] = await tx
          .select()
          .from(exchangeEvents)
          .where(eq(exchangeEvents.id, eventId))
          .limit(1);
        if (!ev) return { error: t("notFound") };
        const notifyOn = await isNotificationsEnabled(tx);
        if (!(await cancelEventCore(tx, ev, new Date(), notifyOn)))
          return { error: t("eventClosed") };
        return { success: true };
      }),
    );
  } catch {
    console.error("[Exchange] admin", { action: "cancel", eventId });
    return { error: t("saveFailed") };
  }
  if ("success" in outcome) updateTag("exchange");
  return outcome;
}

export async function adminListReports(
  status: unknown,
): Promise<Result<AdminReportRow[]>> {
  const g = await guard(statusSchema, status);
  if ("error" in g) return g;

  const reports = await db
    .select({
      id: abuseReports.id,
      targetType: abuseReports.targetType,
      targetId: abuseReports.targetId,
      reason: abuseReports.reason,
      note: abuseReports.note,
      status: abuseReports.status,
      reporterName: members.name,
      createdAt: abuseReports.createdAt,
      resolvedAt: abuseReports.resolvedAt,
    })
    .from(abuseReports)
    .innerJoin(members, eq(members.id, abuseReports.reporterMemberId))
    .where(eq(abuseReports.status, g.data))
    .orderBy(desc(abuseReports.createdAt))
    .limit(LIST_LIMIT);

  const eventIds = reports
    .filter((r) => r.targetType === "event")
    .map((r) => r.targetId);
  const memberIds = reports
    .filter((r) => r.targetType === "member")
    .map((r) => r.targetId);
  const [evs, mems] = await Promise.all([
    eventIds.length
      ? db
          .select({
            id: exchangeEvents.id,
            code: exchangeEvents.publicCode,
            title: exchangeEvents.title,
          })
          .from(exchangeEvents)
          .where(inArray(exchangeEvents.id, eventIds))
      : [],
    memberIds.length
      ? db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, memberIds))
      : [],
  ]);
  const evById = new Map(evs.map((e) => [e.id, e]));
  const memById = new Map(mems.map((m) => [m.id, m.name]));

  return {
    success: true,
    data: reports.map(({ targetId, ...r }) => {
      const ev = r.targetType === "event" ? evById.get(targetId) : undefined;
      return {
        ...r,
        targetName:
          r.targetType === "event"
            ? (ev?.title ?? "")
            : (memById.get(targetId) ?? ""),
        eventCode: ev?.code ?? null,
      };
    }),
  };
}

export async function adminResolveReport(input: unknown): Promise<Result> {
  const g = await guard(resolveSchema, input);
  if ("error" in g) return g;
  const t = await getTranslations("exchange.errors");
  const updated = await db
    .update(abuseReports)
    .set({ status: g.data.status, resolvedAt: new Date().toISOString() })
    .where(eq(abuseReports.id, g.data.reportId))
    .returning({ id: abuseReports.id });
  if (updated.length === 0) return { error: t("notFound") };
  return { success: true };
}
