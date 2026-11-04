process.env.TZ = "UTC";

/**
 * Chứng minh `computeCourtRentReport` / `runReconcile` (tách ra `src/lib` cho
 * cron) trả ĐÚNG như hai action trước khi tách. File fixture được chụp bằng
 * chính các action CŨ, trên dữ liệu dựng ở đây, trước khi chuyển thân hàm:
 *
 *   CAPTURE_FINANCE_PARITY=1 TZ=UTC pnpm exec vitest run src/lib/finance-cores.parity
 *
 * Không chụp lại sau khi tách (sẽ tự so với chính nó). Đổi dữ liệu dựng thì
 * phải chụp lại từ commit trước khi tách.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createTestDb } from "@/db/test-db";
import {
  appSettings,
  courts,
  financialTransactions,
  members,
  paymentNotifications,
  sessionDebts,
  sessions,
} from "@/db/schema";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { sub: "1", role: "admin" } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getCourtRentReport } = await import("@/actions/court-rent");
const { reconcileFund } = await import("@/actions/reconcile-fund");
const { computeCourtRentReport } = await import("@/lib/court-rent-report");
const { runReconcile } = await import("@/lib/reconcile-core");

const FIXTURE = path.join(
  __dirname,
  "__fixtures__",
  "finance-cores-before-extract.json",
);
const CAPTURE = process.env.CAPTURE_FINANCE_PARITY === "1";
// Đồng hồ cố định: report sân dùng "hôm nay" để bỏ tháng tương lai,
// reconcile ghi `generatedAt`.
const FROZEN_NOW = new Date("2026-11-04T05:00:00.000Z");

async function seed() {
  const [court] = await testDb
    .insert(courts)
    .values({
      name: "Sân Tây Mỗ",
      pricePerSession: 200_000,
      pricePerSessionRetail: 220_000,
    })
    .returning({ id: courts.id });
  const [other] = await testDb
    .insert(courts)
    .values({ name: "Sân phụ", pricePerSession: 180_000 })
    .returning({ id: courts.id });
  await testDb.insert(appSettings).values([
    { key: "defaultCourtId", value: String(court.id) },
    { key: "sessionDaysOfWeek", value: "1,3,5" },
  ]);

  const sessionRows = await testDb
    .insert(sessions)
    .values([
      // Tháng 5: trước mốc tính tiền sân, phải bị bỏ.
      {
        date: "2026-05-04",
        status: "completed",
        courtId: court.id,
        courtPrice: 200_000,
      },
      {
        date: "2026-06-01",
        status: "completed",
        courtId: court.id,
        courtPrice: 200_000,
      },
      {
        date: "2026-06-03",
        status: "completed",
        courtId: court.id,
        courtPrice: 400_000,
        courtQuantity: 2,
      },
      {
        date: "2026-06-07",
        status: "completed",
        courtId: other.id,
        courtPrice: 180_000,
      },
      {
        date: "2026-08-05",
        status: "cancelled",
        courtId: court.id,
        courtPrice: 200_000,
        passRevenue: 150_000,
      },
      {
        date: "2026-10-02",
        status: "completed",
        courtId: court.id,
        courtPrice: 150_000,
      },
      {
        date: "2026-10-05",
        status: "completed",
        courtId: court.id,
        courtPrice: 200_000,
      },
      {
        date: "2026-11-02",
        status: "completed",
        courtId: court.id,
        courtPrice: 200_000,
      },
      {
        date: "2026-12-07",
        status: "voting",
        courtId: court.id,
        courtPrice: 200_000,
      },
    ])
    .returning({ id: sessions.id, date: sessions.date });

  const memberRows = await testDb
    .insert(members)
    .values([
      { name: "An", facebookId: "fb-parity-1" },
      { name: "Bình", facebookId: "fb-parity-2" },
      { name: "Chi", facebookId: "fb-parity-3", isActive: false },
      { name: "Dũng", facebookId: "fb-parity-4", approvalStatus: "pending" },
    ])
    .returning({ id: members.id });
  const [a, b, c] = memberRows.map((m) => m.id);
  const sid = sessionRows.find((s) => s.date === "2026-10-05")!.id;

  const [debtA, debtB] = await testDb
    .insert(sessionDebts)
    .values([
      {
        sessionId: sid,
        memberId: a,
        totalAmount: 80_000,
        memberConfirmed: true,
        adminConfirmed: true,
      },
      // Có bank_payment_received mà thiếu cờ: I8 báo lỗi.
      {
        sessionId: sid,
        memberId: b,
        totalAmount: 60_000,
        memberConfirmed: true,
        adminConfirmed: false,
      },
    ])
    .returning({ id: sessionDebts.id });

  const tx = (
    v: Omit<typeof financialTransactions.$inferInsert, "idempotencyKey">,
    key: string,
  ) => ({ ...v, idempotencyKey: `parity-${key}` });
  const [contribA, , dedB] = await testDb
    .insert(financialTransactions)
    .values([
      tx(
        {
          type: "fund_contribution",
          direction: "in",
          amount: 500_000,
          memberId: a,
          createdAt: "2026-10-01 01:00:00",
        },
        "1",
      ),
      tx(
        {
          type: "fund_deduction",
          direction: "out",
          amount: 80_000,
          memberId: a,
          sessionId: sid,
          debtId: debtA.id,
          createdAt: "2026-10-05 15:00:00",
        },
        "2",
      ),
      tx(
        {
          type: "fund_deduction",
          direction: "out",
          amount: 60_000,
          memberId: b,
          sessionId: sid,
          debtId: debtB.id,
          createdAt: "2026-10-05 15:00:00",
        },
        "3",
      ),
      tx(
        {
          type: "fund_contribution",
          direction: "in",
          amount: 100_000,
          memberId: c,
          createdAt: "2026-10-06 02:00:00",
        },
        "4",
      ),
      tx(
        {
          type: "fund_refund",
          direction: "out",
          amount: 20_000,
          memberId: a,
          createdAt: "2026-10-07 02:00:00",
        },
        "5",
      ),
      tx(
        {
          type: "bank_payment_received",
          direction: "in",
          amount: 60_000,
          memberId: b,
          debtId: debtB.id,
          createdAt: "2026-10-08 02:00:00",
        },
        "6",
      ),
      tx(
        {
          type: "debt_member_confirmed",
          direction: "neutral",
          amount: 0,
          memberId: b,
          debtId: debtB.id,
          createdAt: "2026-10-08 02:00:00",
        },
        "7",
      ),
      tx(
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 600_000,
          metadataJson: JSON.stringify({
            targetMonth: "2026-06",
            bucket: "fixed",
          }),
          createdAt: "2026-07-01 02:00:00",
        },
        "8",
      ),
      tx(
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 380_000,
          metadataJson: JSON.stringify({
            targetMonth: "2026-06",
            bucket: "extra",
          }),
          createdAt: "2026-07-01 02:00:00",
        },
        "9",
      ),
      tx(
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 2_000_000,
          metadataJson: JSON.stringify({ targetMonth: "2026-10" }),
          createdAt: "2026-11-01 02:00:00",
        },
        "10",
      ),
      tx(
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 50_000,
          description: "không rõ tháng",
          createdAt: "2026-11-02 02:00:00",
        },
        "11",
      ),
      tx(
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 999_000,
          metadataJson: JSON.stringify({ targetMonth: "2025-12" }),
          createdAt: "2026-01-02 02:00:00",
        },
        "12",
      ),
    ])
    .returning({ id: financialTransactions.id });

  // Cặp đảo: huỷ khoản trừ của Bình và một lần trả tiền sân tháng 10.
  const [rentOct] = await testDb
    .insert(financialTransactions)
    .values(
      tx(
        {
          type: "court_rent_payment",
          direction: "out",
          amount: 300_000,
          metadataJson: JSON.stringify({
            targetMonth: "2026-10",
            bucket: "extra",
          }),
          createdAt: "2026-11-01 03:00:00",
        },
        "13",
      ),
    )
    .returning({ id: financialTransactions.id });
  await testDb.insert(financialTransactions).values([
    tx(
      {
        type: "fund_contribution",
        direction: "in",
        amount: 60_000,
        memberId: b,
        reversalOfId: dedB.id,
        createdAt: "2026-10-09 02:00:00",
      },
      "14",
    ),
    tx(
      {
        type: "court_rent_payment",
        direction: "in",
        amount: 300_000,
        reversalOfId: rentOct.id,
        metadataJson: JSON.stringify({
          targetMonth: "2026-10",
          bucket: "extra",
        }),
        createdAt: "2026-11-01 04:00:00",
      },
      "15",
    ),
  ]);

  await testDb.insert(paymentNotifications).values([
    {
      gmailMessageId: "parity-g1",
      status: "matched",
      matchedTransactionId: contribA.id,
    },
    // matched mà không tx nào trỏ tới: I3 cảnh báo.
    { gmailMessageId: "parity-g2", status: "matched" },
    { gmailMessageId: "parity-g3", status: "pending" },
  ]);
}

type Captured = {
  courtRent2026: unknown;
  courtRent2025: unknown;
  reconcile: unknown;
};

async function runActions(): Promise<Captured> {
  return {
    courtRent2026: await getCourtRentReport(2026),
    courtRent2025: await getCourtRentReport(2025),
    reconcile: await reconcileFund(),
  };
}

describe("finance cores extracted from the actions", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
    await client.execute("PRAGMA foreign_keys=ON");
    await seed();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it.runIf(CAPTURE)(
    "captures the action outputs before extraction",
    async () => {
      writeFileSync(
        FIXTURE,
        `${JSON.stringify(await runActions(), null, 2)}\n`,
      );
      expect(existsSync(FIXTURE)).toBe(true);
    },
  );

  it.skipIf(CAPTURE)(
    "computeCourtRentReport and runReconcile return exactly what the actions returned before",
    async () => {
      const before = JSON.parse(readFileSync(FIXTURE, "utf8")) as Captured;
      // Fixture phải thật sự phủ các nhánh: có lỗi I8, có cảnh báo, có tiền sân.
      expect(JSON.stringify(before.reconcile)).toContain(
        "I8_bank_paid_partial_flags",
      );
      expect(JSON.stringify(before.reconcile)).toContain(
        "I3_matched_without_tx",
      );
      expect(JSON.stringify(before.reconcile)).toContain("I10_frozen_balance");
      expect(JSON.stringify(before.courtRent2026)).toContain("no_target_month");

      // Lõi gọi thẳng với db trả y như action cũ.
      expect({
        courtRent2026: await computeCourtRentReport(testDb, 2026),
        courtRent2025: await computeCourtRentReport(testDb, 2025),
        reconcile: await runReconcile(testDb),
      }).toEqual(before);
      // Action sau khi tách (auth + gọi lõi) cũng vẫn trả y như trước.
      expect(await runActions()).toEqual(before);
    },
  );
});
