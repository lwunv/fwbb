/**
 * Chốt sổ đẩy member quá hạn mức nợ → phiếu ở buổi còn mở vote tự bị bỏ.
 * Spec: docs/superpowers/specs/2026-11-06-debt-vote-block-design.md mục 4.3.
 * Hạn mức dùng mặc định của setting `voteBlockDebtThreshold` (100.000) vì
 * bảng app_settings rỗng.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  votes,
  financialTransactions,
  admins as adminsTable,
} from "@/db/schema";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
  getAdminFromCookie: vi.fn(async () => ({ sub: "1", role: "admin" })),
}));
import { requireAdmin } from "@/lib/auth";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/messenger", () => ({
  sendGroupMessage: vi.fn(),
  buildDebtReminderMessage: vi.fn(() => ""),
  buildNewSessionMessage: vi.fn(),
  buildConfirmedMessage: vi.fn(),
}));
vi.mock("@/lib/user-identity", () => ({
  getUserFromCookie: vi.fn(async () => null),
}));

// Mail báo admin khi member vừa âm quỹ (9/11/2026): `after()` gom việc lại,
// test tự chạy SAU khi action trả kết quả (giống Next chạy sau response).
const afterQueue: Array<() => unknown> = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    afterQueue.push(fn);
  },
}));
const mailMock = vi.hoisted(() => ({
  sendAdminDebtAlertEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/mailer", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailer")>()),
  sendAdminDebtAlertEmail: mailMock.sendAdminDebtAlertEmail,
}));
async function flushAfter() {
  while (afterQueue.length) await afterQueue.shift()!();
}

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSession } = await import("./finance");
const { unlockSession } = await import("./sessions");
const { recordContribution } = await import("./fund");

async function reset() {
  for (const t of [
    "payment_notifications",
    "financial_transactions",
    "session_min_deduction_exemptions",
    "session_debts",
    "session_attendees",
    "session_shuttlecocks",
    "votes",
    "sessions",
    "admins",
    "members",
    "app_settings",
  ]) {
    await client.execute(`DELETE FROM ${t}`);
  }
}

function deadline(days: number): string {
  const d = new Date(Date.now() + 7 * 3600_000 + days * 86400_000);
  return d.toISOString().slice(0, 16);
}

async function seed(thanhBalance: number) {
  const [adminMember, thanh, bob] = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin" },
      { name: "Thanh", facebookId: "fb-thanh" },
      { name: "Bob", facebookId: "fb-bob" },
    ])
    .returning({ id: members.id });
  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({
      username: "Admin",
      passwordHash: "x",
      memberId: adminMember.id,
      email: "admin@fwbb.test",
    })
    .returning({ id: adminsTable.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  await testDb.insert(financialTransactions).values([
    // Số dư ban đầu của Thanh: âm = khoản trừ, dương = khoản nạp.
    thanhBalance < 0
      ? {
          type: "fund_deduction" as const,
          direction: "out" as const,
          amount: -thanhBalance,
          memberId: thanh.id,
        }
      : {
          type: "fund_contribution" as const,
          direction: "in" as const,
          amount: thanhBalance,
          memberId: thanh.id,
        },
    {
      type: "fund_contribution",
      direction: "in",
      amount: 500_000,
      memberId: bob.id,
    },
  ]);

  // Buổi X đã chơi (chốt sổ): 90K / 3 người = 30K mỗi người.
  const [x] = await testDb
    .insert(sessions)
    .values({
      date: "2026-11-02",
      status: "confirmed",
      courtPrice: 90_000,
      // Tắt sàn thiếu quỹ để phần mỗi người đúng 30K (sàn mặc định bật).
      useMinDeduction: false,
    })
    .returning({ id: sessions.id });
  // Buổi Y sắp tới, còn mở vote; Thanh đã vote.
  const [y] = await testDb
    .insert(sessions)
    .values({ date: "2026-11-09", status: "voting", voteDeadline: deadline(2) })
    .returning({ id: sessions.id });
  await testDb.insert(votes).values({
    sessionId: y.id,
    memberId: thanh.id,
    willPlay: true,
    willDine: false,
  });

  const attendees = [adminMember.id, thanh.id, bob.id].map((memberId) => ({
    memberId,
    guestName: null,
    invitedById: null,
    isGuest: false,
    attendsPlay: true,
    attendsDine: false,
  }));
  return {
    thanhId: thanh.id,
    adminMemberId: adminMember.id,
    xId: x.id,
    yId: y.id,
    attendees,
  };
}

async function hasVote(sessionId: number, memberId: number) {
  const all = await testDb.select().from(votes);
  return all.some((v) => v.sessionId === sessionId && v.memberId === memberId);
}

describe("finalizeSession + chặn vote khi nợ", () => {
  beforeEach(reset);

  it("chốt sổ đẩy member quá hạn mức → phiếu buổi sau (đang mở vote) bị xoá", async () => {
    // -80K − 30K = -110K ≤ -100K → bị chặn.
    const { thanhId, xId, yId, attendees } = await seed(-80_000);
    const r = await finalizeSession(xId, attendees, 0);
    expect(r).not.toHaveProperty("error");
    expect(await hasVote(yId, thanhId)).toBe(false);
  });

  it("chốt sổ lại, số dư cuối vẫn trên hạn mức → phiếu buổi sau còn nguyên", async () => {
    // -60K − 30K = -90K, chốt lại vẫn -90K → không chặn.
    const { thanhId, xId, yId, attendees } = await seed(-60_000);
    expect(await finalizeSession(xId, attendees, 0)).not.toHaveProperty(
      "error",
    );
    expect(await finalizeSession(xId, attendees, 0)).not.toHaveProperty(
      "error",
    );
    expect(await hasVote(yId, thanhId)).toBe(true);
  });

  it("nạp quỹ cho member vẫn còn quá hạn mức: không lỗi, phiếu còn sót bị dọn", async () => {
    const { thanhId, yId } = await seed(-200_000);
    const r = await recordContribution(thanhId, 50_000, "nạp", "key-thanh-1");
    expect(r).toEqual({ success: true, replayed: false });
    // Kiểm theo TRẠNG THÁI sau thao tác, không theo chiều tiền: -150K vẫn quá
    // hạn mức nên phiếu sót (vote từ trước khi có tính năng) bị dọn luôn.
    expect(await hasVote(yId, thanhId)).toBe(false);
  });
});

describe("không xoá nhầm phiếu (review cuối 6/11/2026)", () => {
  beforeEach(reset);

  it("mở khoá buổi đã chốt cho member vẫn nợ quá hạn mức → phiếu của CHÍNH buổi đó còn nguyên", async () => {
    // Mở khoá đưa buổi về 'voting' không hạn; nếu xoá phiếu ở đây thì lần
    // chốt lại sẽ không tính tiền cho member nợ (finalize lấy người từ votes).
    const { thanhId, xId, attendees } = await seed(-200_000);
    await testDb.insert(votes).values({
      sessionId: xId,
      memberId: thanhId,
      willPlay: true,
      willDine: false,
    });
    expect(await finalizeSession(xId, attendees, 0)).not.toHaveProperty(
      "error",
    );
    expect(await unlockSession(xId)).not.toHaveProperty("error");
    expect(await hasVote(xId, thanhId)).toBe(true);
  });

  it("member là admin nợ quá hạn mức → phiếu không bị tự bỏ", async () => {
    // Số dư admin lên xuống theo tiền pass sân / tiền sân; admin vốn tự vote hộ.
    const { adminMemberId, xId, yId, attendees } = await seed(-10_000);
    await testDb.insert(financialTransactions).values({
      type: "fund_deduction",
      direction: "out",
      amount: 500_000,
      memberId: adminMemberId,
    });
    await testDb.insert(votes).values({
      sessionId: yId,
      memberId: adminMemberId,
      willPlay: true,
      willDine: false,
    });
    expect(await finalizeSession(xId, attendees, 0)).not.toHaveProperty(
      "error",
    );
    expect(await hasVote(yId, adminMemberId)).toBe(true);
  });
});

describe("mail báo admin khi member vừa âm quỹ (9/11/2026)", () => {
  beforeEach(async () => {
    await reset();
    afterQueue.length = 0;
    mailMock.sendAdminDebtAlertEmail.mockClear();
  });

  it("chốt sổ đẩy member từ +10.000 xuống âm → 1 mail tới email admin", async () => {
    const { xId, attendees } = await seed(10_000);
    expect(await finalizeSession(xId, attendees, 0)).not.toHaveProperty(
      "error",
    );
    await flushAfter();
    expect(mailMock.sendAdminDebtAlertEmail).toHaveBeenCalledTimes(1);
    const [to, input] = mailMock.sendAdminDebtAlertEmail.mock
      .calls[0] as unknown as [
      string[],
      {
        memberName: string;
        balanceBefore: number;
        balanceAfter: number;
        link: string;
      },
    ];
    expect(to).toEqual(["admin@fwbb.test"]);
    expect(input.memberName).toBe("Thanh");
    expect(input.balanceBefore).toBe(10_000);
    expect(input.balanceAfter).toBe(-20_000);
    expect(input.link).toContain("/admin/fund/transactions?q=Thanh");
  });

  it("chốt sổ lại khi member đã âm từ trước → không gửi thêm", async () => {
    const { xId, attendees } = await seed(10_000);
    await finalizeSession(xId, attendees, 0);
    await flushAfter();
    mailMock.sendAdminDebtAlertEmail.mockClear();
    await finalizeSession(xId, attendees, 0);
    await flushAfter();
    expect(mailMock.sendAdminDebtAlertEmail).not.toHaveBeenCalled();
  });

  it("member đã âm sẵn bị trừ thêm → không gửi (chỉ báo lần vừa âm)", async () => {
    const { xId, attendees } = await seed(-60_000);
    await finalizeSession(xId, attendees, 0);
    await flushAfter();
    expect(mailMock.sendAdminDebtAlertEmail).not.toHaveBeenCalled();
  });
});
