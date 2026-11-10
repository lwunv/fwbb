"use server";

import { and, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db } from "@/db";
import { hostFeedback, peerFeedback } from "@/db/schema";
import type { DbOrTx } from "@/db/tx";
import { checkBotAndRate, exchangeGate } from "@/lib/exchange/guards";
import { runSerial } from "@/lib/exchange/serial";
import { requireExchangeMember } from "@/lib/member-auth";
import {
  FEEDBACK_MAX_PEERS,
  MAX_PEER_TAGS,
  PEER_TAGS,
  RL_FEEDBACK,
  TS_FEEDBACK,
  type PeerTag,
} from "@/lib/reputation/constants";
import {
  loadFeedbackContext,
  raterWeight5,
  type FeedbackContext,
  type FeedbackPeer,
} from "@/lib/reputation/eligibility";
import { SKILL_LEVELS, type SkillLevel } from "@/lib/skill-level";

// Chỉ export action tự kiểm quyền: người chấm luôn lấy từ cookie phiên, input
// không có memberId. Điểm chỉ đổi khi cửa sổ chấm đóng (C1), nên không action
// nào ở đây gọi updateTag: cache hồ sơ tự hết hạn.

type PeerAnswer = {
  playAgain: boolean;
  tags: PeerTag[];
  skill: SkillLevel | null;
};

export type FeedbackForm = {
  state: "notYet" | "open" | "closed" | "notEligible";
  closesAt: string;
  host: FeedbackContext["host"];
  hostAnswer: { asDescribed: boolean; feeAsPromised: boolean } | null;
  peers: (Omit<FeedbackPeer, "memberId"> & { mine: PeerAnswer | null })[];
};

type FormResult = { success: true; data: FeedbackForm } | { error: string };
type SubmitResult =
  | { success: true; data: { saved: number } }
  | { error: string };

const codeSchema = z.string().min(1).max(64);

const submitSchema = z.object({
  code: codeSchema,
  // Hai câu về host bắt buộc (quyết định 7).
  host: z.object({ asDescribed: z.boolean(), feeAsPromised: z.boolean() }),
  peers: z
    .array(
      z.object({
        registrationId: z.number().int().positive(),
        playAgain: z.boolean(),
        tags: z
          .array(z.enum(PEER_TAGS))
          .max(MAX_PEER_TAGS)
          .refine((t) => new Set(t).size === t.length),
        skill: z.enum(SKILL_LEVELS).nullable(),
      }),
    )
    .max(FEEDBACK_MAX_PEERS)
    .refine((p) => new Set(p.map((x) => x.registrationId)).size === p.length),
  idempotencyKey: z.string().uuid(),
  turnstileToken: z.string().min(1).max(4096),
});

/** Trong `ON CONFLICT DO UPDATE` của `host_feedback`: hai câu trả lời không đổi. */
const hostAnswersSame = sql`${hostFeedback.asDescribed} IS excluded.as_described
  AND ${hostFeedback.feeAsPromised} IS excluded.fee_as_promised`;

/** Tag lưu theo thứ tự `PEER_TAGS`; dữ liệu lạ trong cột bị bỏ qua. */
function sortTags(tags: readonly string[]): PeerTag[] {
  return PEER_TAGS.filter((t) => tags.includes(t));
}
function parseTags(raw: string): PeerTag[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? sortTags(v.filter((x): x is string => typeof x === "string"))
      : [];
  } catch {
    return [];
  }
}

/**
 * Lần gửi cũ cùng khoá của chính người này. Tra theo `host_feedback_from_idx`
 * rồi lọc khoá; đứng trước kiểm cửa sổ để gửi lại sau khi vừa đóng vẫn trả kết
 * quả cũ thay vì báo lỗi.
 */
async function isReplay(
  q: DbOrTx,
  memberId: number,
  idempotencyKey: string,
): Promise<boolean> {
  const [row] = await q
    .select({ id: hostFeedback.id })
    .from(hostFeedback)
    .where(
      and(
        eq(hostFeedback.fromMemberId, memberId),
        eq(hostFeedback.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return !!row;
}

export async function getEventFeedbackForm(code: string): Promise<FormResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) return { error: t("invalidInput") };

  const ctx = await loadFeedbackContext(db, parsed.data, member.id, new Date());
  if (!ctx) return { error: t("feedbackNotFound") };

  if (ctx.myRegistrationId === null) {
    return {
      success: true,
      data: {
        state: "notEligible",
        closesAt: ctx.closesAt,
        host: ctx.host,
        hostAnswer: null,
        peers: [],
      },
    };
  }

  const [hostRow] = await db
    .select({
      asDescribed: hostFeedback.asDescribed,
      feeAsPromised: hostFeedback.feeAsPromised,
    })
    .from(hostFeedback)
    .where(
      and(
        eq(hostFeedback.eventId, ctx.event.id),
        eq(hostFeedback.fromMemberId, member.id),
      ),
    )
    .limit(1);
  // Chỉ dòng của chính người xem (theo khoá unique event+from).
  const mineRows = await db
    .select({
      toMemberId: peerFeedback.toMemberId,
      playAgain: peerFeedback.playAgain,
      tags: peerFeedback.tags,
      skill: peerFeedback.skillLevel,
    })
    .from(peerFeedback)
    .where(
      and(
        eq(peerFeedback.eventId, ctx.event.id),
        eq(peerFeedback.fromMemberId, member.id),
      ),
    );
  const mineBy = new Map(mineRows.map((r) => [r.toMemberId, r]));

  return {
    success: true,
    data: {
      state: ctx.state,
      closesAt: ctx.closesAt,
      host: ctx.host,
      hostAnswer: hostRow
        ? {
            asDescribed: hostRow.asDescribed,
            feeAsPromised: hostRow.feeAsPromised,
          }
        : null,
      // memberId ở lại server: client chỉ biết registrationId.
      peers: ctx.peers.map(({ memberId, ...peer }) => {
        const m = mineBy.get(memberId);
        return {
          ...peer,
          mine: m
            ? {
                playAgain: m.playAgain,
                tags: parseTags(m.tags),
                skill: m.skill,
              }
            : null,
        };
      }),
    },
  };
}

export async function submitEventFeedback(
  input: unknown,
): Promise<SubmitResult> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const auth = await requireExchangeMember();
  if ("error" in auth) return { error: auth.error };
  const { member } = auth;

  const t = await getTranslations("exchange.errors");
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { error: t("invalidInput") };
  const f = parsed.data;

  // Gửi lại sau khi mất phản hồi: token Turnstile đã dùng, nên trả kết quả cũ
  // trước khi hỏi Cloudflare và không tốn lượt rate limit. Chỉ đọc.
  if (await isReplay(db, member.id, f.idempotencyKey))
    return { success: true, data: { saved: 0 } };

  const bot = await checkBotAndRate({
    token: f.turnstileToken,
    action: TS_FEEDBACK,
    rateKey: `exchange-feedback:${member.id}`,
    limit: RL_FEEDBACK.limit,
    windowMs: RL_FEEDBACK.windowMs,
  });
  if ("error" in bot) return bot;

  let eventId = 0;
  try {
    return await runSerial(() =>
      db.transaction(async (tx): Promise<SubmitResult> => {
        // Hai tab cùng khoá: tab sau thấy dòng của tab trước ở đây.
        if (await isReplay(tx, member.id, f.idempotencyKey))
          return { success: true, data: { saved: 0 } };

        const now = new Date();
        const ctx = await loadFeedbackContext(tx, f.code, member.id, now);
        if (!ctx) return { error: t("feedbackNotFound") };
        eventId = ctx.event.id;
        if (ctx.state === "notYet") return { error: t("feedbackNotYet") };
        if (ctx.state === "closed") return { error: t("feedbackClosed") };
        if (ctx.myRegistrationId === null)
          return { error: t("feedbackNotAllowed") };

        // Một đăng ký lạ (buổi khác, của chính mình, chưa điểm danh, nick bị
        // khoá, host) làm hỏng cả lần gửi: phiếu đã cũ, không ghi một phần.
        const memberOf = new Map(
          ctx.peers.map((p) => [p.registrationId, p.memberId]),
        );
        if (f.peers.some((p) => !memberOf.has(p.registrationId)))
          return { error: t("invalidInput") };

        const w5 = await raterWeight5(tx, member.id);
        const stamp = now.toISOString();
        let saved = 0;

        for (const p of f.peers) {
          const toMemberId = memberOf.get(p.registrationId) as number;
          const pair = and(
            eq(peerFeedback.eventId, ctx.event.id),
            eq(peerFeedback.fromMemberId, member.id),
            eq(peerFeedback.toMemberId, toMemberId),
          );
          // Bỏ trống hết cho một người thì xoá lượt chấm người đó (quyết định 6).
          if (!p.playAgain && p.tags.length === 0 && p.skill === null) {
            await tx.delete(peerFeedback).where(pair);
            continue;
          }
          const tags = JSON.stringify(sortTags(p.tags));
          await tx
            .insert(peerFeedback)
            .values({
              eventId: ctx.event.id,
              fromMemberId: member.id,
              toMemberId,
              playAgain: p.playAgain,
              tags,
              skillLevel: p.skill,
              raterWeight: w5,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .onConflictDoUpdate({
              target: [
                peerFeedback.eventId,
                peerFeedback.fromMemberId,
                peerFeedback.toMemberId,
              ],
              set: {
                playAgain: p.playAgain,
                tags,
                skillLevel: p.skill,
                raterWeight: w5,
                updatedAt: stamp,
              },
              // Chỉ ghi khi câu trả lời đổi. Phần tổng hợp lấy dòng mới nhất
              // của mỗi người chấm qua mọi buổi (quyết định 3): đóng dấu lại
              // dòng không đổi (vd chỉ sửa câu về host) sẽ cho dòng của buổi
              // cũ vượt dòng của buổi mới hơn.
              setWhere: sql`${peerFeedback.playAgain} IS NOT excluded.play_again
                OR ${peerFeedback.tags} IS NOT excluded.tags
                OR ${peerFeedback.skillLevel} IS NOT excluded.skill_level`,
            });
          saved += 1;
        }

        await tx
          .insert(hostFeedback)
          .values({
            eventId: ctx.event.id,
            fromMemberId: member.id,
            asDescribed: f.host.asDescribed,
            feeAsPromised: f.host.feeAsPromised,
            raterWeight: w5,
            idempotencyKey: f.idempotencyKey,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .onConflictDoUpdate({
            target: [hostFeedback.eventId, hostFeedback.fromMemberId],
            // Key luôn được lưu (kiểm gửi lặp), còn trọng số và mốc sửa chỉ
            // đổi khi câu trả lời đổi, cùng lý do với dòng chấm người chơi.
            set: {
              asDescribed: f.host.asDescribed,
              feeAsPromised: f.host.feeAsPromised,
              raterWeight: sql`CASE WHEN ${hostAnswersSame} THEN ${hostFeedback.raterWeight} ELSE excluded.rater_weight END`,
              idempotencyKey: f.idempotencyKey,
              updatedAt: sql`CASE WHEN ${hostAnswersSame} THEN ${hostFeedback.updatedAt} ELSE excluded.updated_at END`,
            },
          });
        saved += 1;

        return { success: true, data: { saved } };
      }),
    );
  } catch {
    console.error("[Reputation] feedback_failed", { eventId });
    return { error: t("feedbackSaveFailed") };
  }
}
