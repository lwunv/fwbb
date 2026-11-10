import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import {
  venues,
  courts,
  sessions,
  sessionAttendees,
  exchangeEvents,
  exchangeRegistrations,
  members,
} from "@/db/schema";
import type {
  ExchangeEventStatus,
  ExchangeRegStatus,
} from "@/lib/exchange/constants";

const { db: testDb } = await createTestDb();
const {
  raterWeight5,
  raterWeightQueries,
  establishedMemberSql,
  loadFeedbackContext,
  venueReviewEligible,
} = await import("./eligibility");

const NOW = "2026-11-05T00:00:00.000Z";
const END = "2026-11-01T12:00:00.000Z";
const START = "2026-11-01T10:00:00.000Z";
const DAY = 86_400_000;

async function seedVenue() {
  const [v] = await testDb
    .insert(venues)
    .values({ name: "V", lat: 10, lng: 106 })
    .returning({ id: venues.id });
  return v.id;
}
const venueId = await seedVenue();

let codeSeq = 0;
let sessionDay = 0;
async function seedMember(
  o: {
    approvalStatus?: "approved" | "pending";
    name?: string;
    publicCode?: string | null;
  } = {},
) {
  const [m] = await testDb
    .insert(members)
    .values({
      name: o.name ?? "m",
      approvalStatus: o.approvalStatus ?? "pending",
      publicCode: o.publicCode ?? null,
      avatarKey: "k",
    })
    .returning({ id: members.id });
  return m.id;
}
async function seedEvent(
  o: {
    status?: ExchangeEventStatus;
    hiddenAt?: string | null;
    venue?: number;
    host?: number;
    endAt?: string;
  } = {},
) {
  const host = o.host ?? (await seedMember({ approvalStatus: "approved" }));
  const code = `ev${String(++codeSeq).padStart(8, "0")}`;
  const [e] = await testDb
    .insert(exchangeEvents)
    .values({
      publicCode: code,
      hostMemberId: host,
      venueId: o.venue ?? venueId,
      title: "t",
      startAt: START,
      endAt: o.endAt ?? END,
      slotsTotal: 10,
      feeMode: "fixed",
      registerDeadline: START,
      cancelDeadline: START,
      status: o.status ?? "done",
      hiddenAt: o.hiddenAt ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: exchangeEvents.id });
  return { id: e.id, code, host };
}
async function reg(
  eventId: number,
  memberId: number,
  status: ExchangeRegStatus,
  checkedIn: boolean,
) {
  const [r] = await testDb
    .insert(exchangeRegistrations)
    .values({
      eventId,
      memberId,
      status,
      maleCount: 1,
      checkedIn,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning({ id: exchangeRegistrations.id });
  return r.id;
}
async function seedCourt(linkedVenue: number | null) {
  const [c] = await testDb
    .insert(courts)
    .values({ name: "c", pricePerSession: 200_000, venueId: linkedVenue })
    .returning({ id: courts.id });
  return c.id;
}
async function seedSession(
  o: {
    status?: "voting" | "confirmed" | "completed" | "cancelled";
    court?: number | null;
  } = {},
) {
  const [s] = await testDb
    .insert(sessions)
    .values({
      // `sessions.date` là UNIQUE: mỗi buổi một ngày.
      date: new Date(Date.UTC(2020, 0, 1) + ++sessionDay * DAY)
        .toISOString()
        .slice(0, 10),
      status: o.status ?? "completed",
      courtId: o.court ?? null,
    })
    .returning({ id: sessions.id });
  return s.id;
}
async function attend(
  sessionId: number,
  memberId: number,
  o: { isGuest?: boolean; attendsPlay?: boolean; attendsDine?: boolean } = {},
) {
  await testDb.insert(sessionAttendees).values({
    sessionId,
    memberId,
    isGuest: o.isGuest ?? false,
    attendsPlay: o.attendsPlay ?? true,
    attendsDine: o.attendsDine ?? false,
  });
}

describe("raterWeight5", () => {
  it("weight adds valid exchange check-ins and completed group sessions and caps at 5", async () => {
    const m = await seedMember();
    expect(await raterWeight5(testDb, m)).toBe(0);
    await reg((await seedEvent()).id, m, "approved", true);
    await reg((await seedEvent()).id, m, "approved", true);
    await attend(await seedSession(), m);
    expect(await raterWeight5(testDb, m)).toBe(3);
    await attend(await seedSession(), m);
    expect(await raterWeight5(testDb, m)).toBe(4);
    for (let i = 0; i < 4; i++) {
      await reg((await seedEvent()).id, m, "approved", true);
      await attend(await seedSession(), m);
    }
    expect(await raterWeight5(testDb, m)).toBe(5);
  });

  it("check-ins at hidden or cancelled events, a merge-cancelled registration that kept checked_in, guest rows and dine-only rows do not count", async () => {
    const m = await seedMember();
    await reg((await seedEvent({ hiddenAt: NOW })).id, m, "approved", true);
    await reg(
      (await seedEvent({ status: "cancelled" })).id,
      m,
      "approved",
      true,
    );
    await reg((await seedEvent()).id, m, "cancelled", true);
    await reg((await seedEvent()).id, m, "approved", false);
    await reg((await seedEvent()).id, m, "no_show", false);
    await attend(await seedSession(), m, { isGuest: true });
    await attend(await seedSession(), m, {
      attendsPlay: false,
      attendsDine: true,
    });
    await attend(await seedSession({ status: "confirmed" }), m);
    await attend(await seedSession({ status: "cancelled" }), m);
    expect(await raterWeight5(testDb, m)).toBe(0);

    await reg((await seedEvent()).id, m, "approved", true);
    expect(await raterWeight5(testDb, m)).toBe(1);
  });

  it("each weight query reads at most 5 rows for a member with more than 5 check-ins and 5 group sessions", async () => {
    const m = await seedMember();
    for (let i = 0; i < 7; i++) {
      await reg((await seedEvent()).id, m, "approved", true);
      await attend(await seedSession(), m);
    }
    const [exchange, group] = raterWeightQueries(m);
    // Bỏ LIMIT thì mỗi câu trả 7 dòng: quota Turso tính theo dòng đọc.
    expect(await testDb.all(exchange)).toHaveLength(5);
    expect(await testDb.all(group)).toHaveLength(5);
    expect(await raterWeight5(testDb, m)).toBe(5);
  });

  it("EXPLAIN QUERY PLAN of the weight uses session_attendees_member_idx and exchange_registrations_member_checked_in_idx, no SCAN", async () => {
    const m = await seedMember();
    const details: string[] = [];
    for (const q of raterWeightQueries(m)) {
      const plan = await testDb.all<{ detail: string }>(
        sql`EXPLAIN QUERY PLAN ${q}`,
      );
      details.push(...plan.map((p) => p.detail));
    }
    expect(details.some((d) => /\bSCAN\b/.test(d))).toBe(false);
    expect(
      details.some((d) => d.includes("session_attendees_member_idx")),
    ).toBe(true);
    expect(
      details.some((d) =>
        d.includes("exchange_registrations_member_checked_in_idx"),
      ),
    ).toBe(true);
  });
});

describe("loadFeedbackContext", () => {
  async function seedFeedbackEvent(
    o: { status?: ExchangeEventStatus; hiddenAt?: string | null } = {},
  ) {
    const host = await seedMember({
      approvalStatus: "approved",
      name: "Host",
      publicCode: `host${String(++codeSeq).padStart(6, "0")}`,
    });
    const ev = await seedEvent({ host, ...o });
    const a = await seedMember({ name: "A", publicCode: null });
    const b = await seedMember({
      name: "B",
      publicCode: `bbb${String(++codeSeq).padStart(7, "0")}`,
    });
    const c = await seedMember({ name: "C" });
    const d = await seedMember({ name: "D" });
    const regA = await reg(ev.id, a, "approved", true);
    const regB = await reg(ev.id, b, "approved", true);
    const regC = await reg(ev.id, c, "approved", true);
    await reg(ev.id, d, "approved", false);
    return { ev, host, a, b, c, d, regA, regB, regC };
  }

  it("context window: notYet before endAt, open at endAt and 1 ms before endAt plus 7 days, closed at exactly endAt plus 7 days", async () => {
    const { ev, a } = await seedFeedbackEvent();
    const end = Date.parse(END);
    const at = (t: number) =>
      loadFeedbackContext(testDb, ev.code, a, new Date(t));
    expect((await at(end - 1))?.state).toBe("notYet");
    expect((await at(end))?.state).toBe("open");
    expect((await at(end + 7 * DAY - 1))?.state).toBe("open");
    // Đúng mốc endAt + 7 ngày thì lượt chấm đã được cộng (windowClosed), nên
    // phiếu cũng phải đóng: không lần ghi nào lọt vào cửa sổ đã tổng hợp.
    expect((await at(end + 7 * DAY))?.state).toBe("closed");
    expect((await at(end + 7 * DAY + 1))?.state).toBe("closed");
    const ctx = await at(end);
    expect(ctx?.closesAt).toBe(new Date(end + 7 * DAY).toISOString());
    expect(ctx?.event).toEqual({
      id: ev.id,
      publicCode: ev.code,
      title: "t",
      hostMemberId: ev.host,
      endAt: END,
    });
  });

  it("context is null for a hidden or cancelled event and an unknown code", async () => {
    const now = new Date(Date.parse(END) + DAY);
    const hidden = await seedFeedbackEvent({ hiddenAt: NOW });
    const cancelled = await seedFeedbackEvent({ status: "cancelled" });
    expect(
      await loadFeedbackContext(testDb, hidden.ev.code, hidden.a, now),
    ).toBeNull();
    expect(
      await loadFeedbackContext(testDb, cancelled.ev.code, cancelled.a, now),
    ).toBeNull();
    expect(
      await loadFeedbackContext(testDb, "nosuchcode", hidden.a, now),
    ).toBeNull();
  });

  it("a viewer not checked in gets no peers", async () => {
    const now = new Date(Date.parse(END) + DAY);
    const { ev, d } = await seedFeedbackEvent();
    const stranger = await seedMember();
    for (const viewer of [d, stranger]) {
      const ctx = await loadFeedbackContext(testDb, ev.code, viewer, now);
      expect(ctx?.myRegistrationId).toBeNull();
      expect(ctx?.peers).toEqual([]);
    }
  });

  it("peers never include the viewer or the host", async () => {
    const now = new Date(Date.parse(END) + DAY);
    const { ev, host, a, b, c, regA, regB, regC } = await seedFeedbackEvent();
    // Host không đăng ký được buổi của mình qua app; dòng này kiểm hàng rào ở DB.
    await reg(ev.id, host, "approved", true);

    const ctx = await loadFeedbackContext(testDb, ev.code, a, now);
    expect(ctx?.myRegistrationId).toBe(regA);
    expect(ctx?.peers).toEqual([
      {
        registrationId: regB,
        memberId: b,
        name: "B",
        avatarUrl: null,
        avatarKey: "k",
        code: expect.stringMatching(/^bbb/),
      },
      {
        registrationId: regC,
        memberId: c,
        name: "C",
        avatarUrl: null,
        avatarKey: "k",
        code: null,
      },
    ]);
    expect(ctx?.host).toEqual({
      name: "Host",
      avatarUrl: null,
      avatarKey: "k",
      code: expect.stringMatching(/^host/),
    });

    const asHost = await loadFeedbackContext(testDb, ev.code, host, now);
    expect(asHost?.myRegistrationId).toBeNull();
    expect(asHost?.peers).toEqual([]);
  });

  it("peers are capped at 50 in registration id order", async () => {
    const now = new Date(Date.parse(END) + DAY);
    const ev = await seedEvent();
    const viewer = await seedMember();
    const regs: number[] = [];
    for (let i = 0; i < 52; i++) {
      regs.push(await reg(ev.id, await seedMember(), "approved", true));
    }
    // Người xem đăng ký sau cùng: không chiếm chỗ trong 50 người.
    await reg(ev.id, viewer, "approved", true);
    const ctx = await loadFeedbackContext(testDb, ev.code, viewer, now);
    expect(ctx?.peers.map((p) => p.registrationId)).toEqual(regs.slice(0, 50));
  });

  it("a locked or rejected co-player is never a peer", async () => {
    const now = new Date(Date.parse(END) + DAY);
    const { ev, a, regB, regC } = await seedFeedbackEvent();
    const locked = await seedMember({ name: "L" });
    await testDb
      .update(members)
      .set({ isActive: false })
      .where(sql`${members.id} = ${locked}`);
    const rejected = await seedMember({ name: "R" });
    await testDb
      .update(members)
      .set({ approvalStatus: "rejected" })
      .where(sql`${members.id} = ${rejected}`);
    await reg(ev.id, locked, "approved", true);
    await reg(ev.id, rejected, "approved", true);
    const ctx = await loadFeedbackContext(testDb, ev.code, a, now);
    expect(ctx?.peers.map((p) => p.registrationId)).toEqual([regB, regC]);
  });
});

describe("venueReviewEligible", () => {
  it("venue eligibility: check-in there yes, at another venue no, registered not checked in no, group session at a linked court yes, unlinked court no, session not completed no", async () => {
    const venue = await seedVenue();
    const other = await seedVenue();

    const checkedThere = await seedMember();
    await reg((await seedEvent({ venue })).id, checkedThere, "approved", true);
    expect(await venueReviewEligible(testDb, venue, checkedThere)).toBe(true);

    const checkedElsewhere = await seedMember();
    await reg(
      (await seedEvent({ venue: other })).id,
      checkedElsewhere,
      "approved",
      true,
    );
    expect(await venueReviewEligible(testDb, venue, checkedElsewhere)).toBe(
      false,
    );

    const registeredOnly = await seedMember();
    await reg(
      (await seedEvent({ venue })).id,
      registeredOnly,
      "approved",
      false,
    );
    expect(await venueReviewEligible(testDb, venue, registeredOnly)).toBe(
      false,
    );

    const hiddenThere = await seedMember();
    await reg(
      (await seedEvent({ venue, hiddenAt: NOW })).id,
      hiddenThere,
      "approved",
      true,
    );
    expect(await venueReviewEligible(testDb, venue, hiddenThere)).toBe(false);

    // Đăng ký bị huỷ do gộp tài khoản vẫn giữ cờ điểm danh: không tính là đã đến.
    const mergeCancelled = await seedMember();
    await reg(
      (await seedEvent({ venue })).id,
      mergeCancelled,
      "cancelled",
      true,
    );
    expect(await venueReviewEligible(testDb, venue, mergeCancelled)).toBe(
      false,
    );

    const linkedCourt = await seedCourt(venue);
    const unlinkedCourt = await seedCourt(null);

    const groupLinked = await seedMember({ approvalStatus: "approved" });
    await attend(await seedSession({ court: linkedCourt }), groupLinked);
    expect(await venueReviewEligible(testDb, venue, groupLinked)).toBe(true);

    const groupUnlinked = await seedMember({ approvalStatus: "approved" });
    await attend(await seedSession({ court: unlinkedCourt }), groupUnlinked);
    expect(await venueReviewEligible(testDb, venue, groupUnlinked)).toBe(false);

    const notCompleted = await seedMember({ approvalStatus: "approved" });
    await attend(
      await seedSession({ court: linkedCourt, status: "confirmed" }),
      notCompleted,
    );
    expect(await venueReviewEligible(testDb, venue, notCompleted)).toBe(false);

    const dineOnly = await seedMember({ approvalStatus: "approved" });
    await attend(await seedSession({ court: linkedCourt }), dineOnly, {
      attendsPlay: false,
      attendsDine: true,
    });
    expect(await venueReviewEligible(testDb, venue, dineOnly)).toBe(false);
  });
});

describe("establishedMemberSql", () => {
  it("established: approved yes, pending with a check-in yes, pending without no", async () => {
    const approved = await seedMember({ approvalStatus: "approved" });
    const pendingChecked = await seedMember();
    await reg((await seedEvent()).id, pendingChecked, "approved", true);
    const pendingNot = await seedMember();
    await reg((await seedEvent()).id, pendingNot, "approved", false);

    const established = async (id: number) => {
      const rows = await testDb
        .select({ ok: sql<number>`1` })
        .from(members)
        .where(
          sql`${members.id} = ${id} AND ${establishedMemberSql(members.id, members.approvalStatus)}`,
        );
      return rows.length === 1;
    };
    expect(await established(approved)).toBe(true);
    expect(await established(pendingChecked)).toBe(true);
    expect(await established(pendingNot)).toBe(false);
  });
});
