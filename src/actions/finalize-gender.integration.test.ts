/**
 * Chặng 2 giai đoạn 3: giới tính thật đi vào đường chốt sổ.
 *
 * Ca số 1 là ca quan trọng nhất của cả chặng: công tắc TẮT (mặc định) thì số
 * tiền phải y hệt như trước khi chặng này tồn tại. Mọi ca còn lại chỉ có nghĩa
 * khi ca đó xanh.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  votes,
  sessionDebts,
  sessionAttendees,
  financialTransactions,
  appSettings,
  admins as adminsTable,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { defaultSettings } from "@/lib/settings-registry";

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

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { finalizeSessionAuto } = await import("./finance");
const { adminSetVote } = await import("./votes");

async function reset() {
  await client.execute("DELETE FROM payment_notifications");
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_min_deduction_exemptions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM session_attendees");
  await client.execute("DELETE FROM session_shuttlecocks");
  await client.execute("DELETE FROM votes");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM app_settings");
  await client.execute("DELETE FROM admins");
  await client.execute("DELETE FROM members");
}

async function setSetting(key: string, value: unknown) {
  await testDb
    .insert(appSettings)
    .values({ key, value: JSON.stringify(value) });
}

/** Bật công tắc + đặt nhóm nữ về mức cố định `amount`. */
async function enableGenderPricing(amount: number) {
  const base = defaultSettings().groupPolicies;
  await setSetting("genderPricingEnabled", true);
  await setSetting("groupPolicies", {
    ...base,
    memberFemale: { mode: "fixed", amount, capAtEqual: false },
    guestMemberFemale: { mode: "fixed", amount, capAtEqual: false },
    guestAdminFemale: { mode: "fixed", amount, capAtEqual: false },
  });
}

async function seedActors() {
  const inserted = await testDb
    .insert(members)
    .values([
      { name: "Admin", facebookId: "fb-admin" },
      { name: "Nam", facebookId: "fb-nam", gender: "male" },
      { name: "Nữ", facebookId: "fb-nu", gender: "female" },
      { name: "Chưa khai", facebookId: "fb-chuakhai" },
    ])
    .returning({ id: members.id });
  const [adminMember, nam, nu, chuaKhai] = inserted;

  const [adminRow] = await testDb
    .insert(adminsTable)
    .values({ username: "Admin", passwordHash: "x", memberId: adminMember.id })
    .returning({ id: adminsTable.id });
  vi.mocked(requireAdmin).mockResolvedValue({
    admin: { sub: String(adminRow.id), role: "admin" },
  } as never);

  return {
    adminMemberId: adminMember.id,
    namId: nam.id,
    nuId: nu.id,
    chuaKhaiId: chuaKhai.id,
  };
}

let dateCounter = 0;
async function seedSession(
  courtPrice: number,
  extra: Record<string, unknown> = {},
) {
  dateCounter += 1;
  const date = `2026-10-${String(dateCounter).padStart(2, "0")}`;
  const [s] = await testDb
    .insert(sessions)
    .values({
      date,
      status: "confirmed",
      courtPrice,
      // TẮT sàn min-deduction mặc định (cột `use_min_deduction` default TRUE).
      // Không tắt thì sàn 60K nâng mọi mức nữ thấp hơn 60K lên, và test tưởng
      // là phần giới tính hỏng trong khi hỏng ở chỗ khác. Tương tác giữa hai
      // cơ chế có ca riêng bên dưới.
      useMinDeduction: false,
      ...extra,
    })
    .returning({ id: sessions.id });
  return s.id;
}

async function vote(
  sessionId: number,
  memberId: number,
  extra: Record<string, unknown> = {},
) {
  await testDb
    .insert(votes)
    .values({ sessionId, memberId, willPlay: true, willDine: false, ...extra });
}

async function debtsByMember(sessionId: number) {
  const rows = await testDb.query.sessionDebts.findMany({
    where: eq(sessionDebts.sessionId, sessionId),
  });
  return Object.fromEntries(rows.map((r) => [r.memberId, r.totalAmount]));
}

/**
 * I1: Σ fund_deduction khớp Σ debt, KHÔNG tính nợ của chính admin.
 *
 * Phải trừ admin ra vì `finalizeSession` cố ý không trừ quỹ phần của admin
 * (`fundDeductionAmount` luôn 0 cho admin): khách do admin mời là quỹ chung
 * đãi, nên buổi nào có khách-admin thì Σ nợ lớn hơn Σ trừ quỹ đúng bằng phần
 * admin gánh. Đây là mô hình có chủ ý, không phải lệch sổ. Bản đầu của helper
 * này so tổng thẳng và báo đỏ ở ca có khách-admin, và cái sai nằm ở helper.
 *
 * I8: không dòng nợ nào mang cờ confirmed mà thiếu dòng ledger.
 */
async function expectMoneyInvariants(sessionId: number, adminMemberId: number) {
  const debts = await testDb.query.sessionDebts.findMany({
    where: eq(sessionDebts.sessionId, sessionId),
  });
  const txs = await testDb.query.financialTransactions.findMany({
    where: eq(financialTransactions.sessionId, sessionId),
  });
  const deductions = txs.filter((t) => t.type === "fund_deduction");
  const sumDebt = debts
    .filter((d) => d.memberId !== adminMemberId)
    .reduce((n, d) => n + d.totalAmount, 0);
  const sumDeduction = deductions.reduce((n, t) => n + t.amount, 0);
  expect(sumDeduction).toBe(sumDebt);

  // Nợ của admin luôn mang cờ confirmed mà KHÔNG có dòng trừ quỹ, đúng thiết
  // kế (quỹ chung đãi khách admin). Loại ra khỏi phép kiểm I8.
  for (const d of debts.filter(
    (x) => x.memberConfirmed && x.memberId !== adminMemberId,
  )) {
    expect(
      deductions.some((t) => t.memberId === d.memberId),
      `debt của member ${d.memberId} có cờ confirmed nhưng thiếu dòng ledger (I8)`,
    ).toBe(true);
  }
}

describe("chốt sổ với giới tính", () => {
  beforeEach(reset);

  it("CÔNG TẮC TẮT: tiền y hệt cách chia cũ, không ai được ưu đãi", async () => {
    const { adminMemberId, namId, nuId, chuaKhaiId } = await seedActors();
    // 300K sân, 3 người chơi, 1 người dắt 2 khách (1 nữ).
    const sid = await seedSession(300_000);
    await vote(sid, namId);
    await vote(sid, nuId);
    await vote(sid, chuaKhaiId, { guestPlayCount: 2, guestPlayFemaleCount: 1 });

    const r = await finalizeSessionAuto(sid);
    expect(r).not.toHaveProperty("error");

    // 5 đầu người (3 member + 2 khách), 300.000 / 5 = 60.000 mỗi đầu.
    // Khách do "Chưa khai" mời nên người đó gánh 2 suất khách.
    const d = await debtsByMember(sid);
    expect(d[namId]).toBe(60_000);
    expect(d[nuId]).toBe(60_000);
    expect(d[chuaKhaiId]).toBe(180_000);
    await expectMoneyInvariants(sid, adminMemberId);
  });

  it("CÔNG TẮC BẬT: member nữ trả mức cố định, phần thiếu chia lại cho nhóm chia đều", async () => {
    const { adminMemberId, namId, nuId } = await seedActors();
    await enableGenderPricing(40_000);
    // 200K sân, 2 người chơi: 1 nam 1 nữ. Nữ cố định 40K → nam gánh 160K.
    const sid = await seedSession(200_000);
    await vote(sid, namId);
    await vote(sid, nuId);

    const r = await finalizeSessionAuto(sid);
    expect(r).not.toHaveProperty("error");

    const d = await debtsByMember(sid);
    expect(d[nuId]).toBe(40_000);
    expect(d[namId]).toBe(160_000);
    await expectMoneyInvariants(sid, adminMemberId);
  });

  it("khách nữ của member và khách nữ của admin vào hai nhóm khác nhau", async () => {
    const { adminMemberId, namId } = await seedActors();
    await enableGenderPricing(40_000);
    const sid = await seedSession(300_000, {
      adminGuestPlayCount: 1,
      adminGuestPlayFemaleCount: 1,
    });
    await vote(sid, namId, { guestPlayCount: 1, guestPlayFemaleCount: 1 });

    const r = await finalizeSessionAuto(sid);
    expect(r).not.toHaveProperty("error");

    const rows = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sid),
    });
    const khachNuCuaMember = rows.filter(
      (a) => a.isGuest && a.gender === "female" && a.invitedById === namId,
    );
    const khachNuCuaAdmin = rows.filter(
      (a) =>
        a.isGuest && a.gender === "female" && a.invitedById === adminMemberId,
    );
    expect(khachNuCuaMember).toHaveLength(1);
    expect(khachNuCuaAdmin).toHaveLength(1);
    await expectMoneyInvariants(sid, adminMemberId);
  });

  it("member chưa khai giới tính: tính như không-nữ, không lỗi, không ưu đãi", async () => {
    const { adminMemberId, namId, chuaKhaiId } = await seedActors();
    await enableGenderPricing(40_000);
    const sid = await seedSession(200_000);
    await vote(sid, namId);
    await vote(sid, chuaKhaiId);

    const r = await finalizeSessionAuto(sid);
    expect(r).not.toHaveProperty("error");

    const d = await debtsByMember(sid);
    // Cả hai đều vào nhóm chia đều → 100K mỗi người, không ai được mức 40K.
    expect(d[namId]).toBe(100_000);
    expect(d[chuaKhaiId]).toBe(100_000);
    await expectMoneyInvariants(sid, adminMemberId);
  });

  it("số khách nữ hỏng (lớn hơn tổng) KHÔNG đẻ thêm khách ma", async () => {
    const { adminMemberId, namId } = await seedActors();
    await enableGenderPricing(40_000);
    const sid = await seedSession(200_000);
    // Dòng dữ liệu lệch, kiểu chỉ có thể tới từ data cũ hoặc một đường ghi bị
    // bỏ sót. Ghi thẳng vào DB để vượt qua zod, đúng như đời thật.
    //
    // Thứ được canh ở đây là BIÊN VÒNG LẶP khi bung khách, không phải cái
    // `Math.min` trong `pushGuests`: gỡ `Math.min` ra thì ca này vẫn xanh (đã
    // thử bằng mutation). Biên vòng lặp mới là thứ chặn việc chia tiền cho
    // người không tồn tại, nên nó đáng được khoá lại bằng test.
    await vote(sid, namId, { guestPlayCount: 1, guestPlayFemaleCount: 5 });

    const r = await finalizeSessionAuto(sid);
    expect(r).not.toHaveProperty("error");

    const rows = await testDb.query.sessionAttendees.findMany({
      where: eq(sessionAttendees.sessionId, sid),
    });
    // Đúng 1 khách được tạo, không phải 5.
    expect(rows.filter((a) => a.isGuest)).toHaveLength(1);
    await expectMoneyInvariants(sid, adminMemberId);
  });

  it("mức nữ thấp hơn sàn min-deduction thì bị sàn nâng lên, không phải lỗi", async () => {
    const { adminMemberId, namId, nuId } = await seedActors();
    await enableGenderPricing(40_000);
    // Bật lại sàn min-deduction (mặc định thật của app) để soi tương tác.
    const sid = await seedSession(200_000, { useMinDeduction: true });
    await vote(sid, namId);
    await vote(sid, nuId);

    const r = await finalizeSessionAuto(sid);
    expect(r).not.toHaveProperty("error");

    // Nữ đáng ra trả 40K theo chính sách nhóm, nhưng balance quỹ bằng 0 nên
    // sàn 60K nâng lên. Đây là hành vi ĐÚNG và admin cần biết: đặt mức nữ
    // thấp hơn sàn thì với người hết quỹ, mức đó không có tác dụng.
    const d = await debtsByMember(sid);
    expect(d[nuId]).toBe(60_000);
    await expectMoneyInvariants(sid, adminMemberId);
  });

  it("tắt cờ chơi thì zero CẢ tổng khách lẫn số khách nữ", async () => {
    const { namId } = await seedActors();
    const sid = await seedSession(200_000);
    await vote(sid, namId, { guestPlayCount: 3, guestPlayFemaleCount: 2 });

    await adminSetVote(sid, namId, false, false);

    const row = await testDb.query.votes.findFirst({
      where: eq(votes.memberId, namId),
    });
    expect(row?.guestPlayCount).toBe(0);
    // Đây là chỗ dễ sót nhất: zero tổng mà quên zero phần nữ thì còn khách nữ
    // ma nhiều hơn tổng khách.
    expect(row?.guestPlayFemaleCount).toBe(0);
  });
});
