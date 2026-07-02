# Member Play History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nút xem lịch sử chơi của từng member (lịch + danh sách, trạng thái đã trả theo FIFO) dùng chung ở `/admin/members` và `/admin/fund`.

**Architecture:** 1 hàm pure FIFO trong `src/lib`, 1 server action read-only trả toàn bộ lịch sử 1 member, 1 client component sheet/dialog tự fetch bằng TanStack Query, mount ở 2 trang admin.

**Tech Stack:** Next.js 16 App Router, Drizzle + Turso, TanStack Query (provider đã có ở `src/components/providers.tsx`), shadcn Sheet/Dialog, date-fns, next-intl, vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-member-play-history-design.md`

## Global Constraints

- Tiền là số nguyên VND, không float. Balance PHẢI lấy qua `computeBalanceFromTransactions` (`src/lib/fund-core.ts`), không tự viết vòng lặp cộng ledger.
- Read-only: không ghi gì vào DB, không đụng logic finalize/ledger.
- Chỉ session `status = 'completed'` vào lịch sử.
- Mobile-first: vùng chạm ≥ 44px, sheet đáy trên mobile, dialog trên desktop (`useIsMobile` từ `src/lib/use-is-mobile.ts`, breakpoint mặc định 640).
- i18n đủ 3 locale vi/en/zh cho MỌI label mới (namespace mới `memberHistory`); chạy `node scripts/check-i18n-keys.mjs` sau khi thêm key.
- Không hardcode màu hex; dùng Tailwind class/CSS vars như phần còn lại của app.
- Tiền hiển thị bằng `formatK` (`src/lib/utils.ts`, thực chất là `toLocaleString("vi-VN")`).
- Ngày hiển thị bằng `formatSessionDate` (`src/lib/date-format.ts`) hoặc date-fns + `getDateFnsLocale` như history-client.
- Commit style: Conventional Commits 1 dòng, không body, không Co-Authored-By. KHÔNG chạy `git commit` khi user chưa duyệt message trong phiên tương tác; trong plan này user đã duyệt trước toàn bộ message ghi ở từng task.

---

### Task 1: FIFO paid attribution lib

**Files:**

- Create: `src/lib/fifo-paid-attribution.ts`
- Test: `src/lib/fifo-paid-attribution.test.ts`

**Interfaces:**

- Consumes: không phụ thuộc task nào.
- Produces:

  ```ts
  export type PaidStatus = "paid" | "partial" | "unpaid";
  export function attributePaidFifo(
    charges: Array<{ sessionId: number; date: string; totalAmount: number }>,
    balance: number,
  ): Record<number, PaidStatus>;
  ```

- [ ] **Step 1: Viết test fail trước**

```ts
// src/lib/fifo-paid-attribution.test.ts
import { describe, it, expect } from "vitest";
import { attributePaidFifo } from "./fifo-paid-attribution";

const charges = [
  { sessionId: 1, date: "2026-06-22", totalAmount: 40000 },
  { sessionId: 2, date: "2026-06-24", totalAmount: 50000 },
  { sessionId: 3, date: "2026-06-26", totalAmount: 60000 },
];

describe("attributePaidFifo — deficit ăn vào buổi MỚI nhất trước", () => {
  it("balance >= 0 → tất cả paid", () => {
    expect(attributePaidFifo(charges, 0)).toEqual({
      1: "paid",
      2: "paid",
      3: "paid",
    });
    expect(attributePaidFifo(charges, 120000)).toEqual({
      1: "paid",
      2: "paid",
      3: "paid",
    });
  });

  it("âm 1 phần buổi mới nhất → partial, buổi cũ paid", () => {
    expect(attributePaidFifo(charges, -20000)).toEqual({
      1: "paid",
      2: "paid",
      3: "partial",
    });
  });

  it("âm đúng bằng buổi mới nhất → buổi đó unpaid", () => {
    expect(attributePaidFifo(charges, -60000)).toEqual({
      1: "paid",
      2: "paid",
      3: "unpaid",
    });
  });

  it("âm lan sang buổi giữa → newest unpaid, giữa partial", () => {
    // deficit 90K = 60K (s3) + 30K trong 50K (s2)
    expect(attributePaidFifo(charges, -90000)).toEqual({
      1: "paid",
      2: "partial",
      3: "unpaid",
    });
  });

  it("âm vượt tổng charge (nợ ngoài buổi chơi) → tất cả unpaid, không throw", () => {
    expect(attributePaidFifo(charges, -999000)).toEqual({
      1: "unpaid",
      2: "unpaid",
      3: "unpaid",
    });
  });

  it("input rỗng → object rỗng", () => {
    expect(attributePaidFifo([], -50000)).toEqual({});
  });

  it("charge 0 đồng (buổi free) không ăn deficit, luôn paid", () => {
    const withFree = [
      ...charges,
      { sessionId: 4, date: "2026-06-28", totalAmount: 0 },
    ];
    expect(attributePaidFifo(withFree, -60000)).toEqual({
      1: "paid",
      2: "paid",
      3: "unpaid",
      4: "paid",
    });
  });

  it("không phụ thuộc thứ tự input (sort nội bộ theo date desc, tie-break id desc)", () => {
    const shuffled = [charges[2], charges[0], charges[1]];
    expect(attributePaidFifo(shuffled, -20000)).toEqual({
      1: "paid",
      2: "paid",
      3: "partial",
    });
  });
});
```

- [ ] **Step 2: Chạy để chắc chắn fail**

Run: `pnpm vitest run src/lib/fifo-paid-attribution.test.ts`
Expected: FAIL — "Cannot find module './fifo-paid-attribution'".

- [ ] **Step 3: Implement**

```ts
// src/lib/fifo-paid-attribution.ts
/**
 * Phân bổ trạng thái "đã trả" per-buổi cho mô hình Quỹ+Nợ gộp (chỉ có 1
 * balance tổng). Quy ước FIFO đã chốt với user 2026-07-02 (xem spec
 * docs/superpowers/specs/2026-07-02-member-play-history-design.md): tiền nạp
 * trừ cho buổi CŨ trước, nên phần thiếu (balance âm) ăn vào các buổi MỚI
 * nhất. Buổi 0 đồng không ăn deficit.
 *
 * KHÔNG đọc ledger ở đây — caller phải đưa balance đã tính bằng helper chuẩn
 * (computeBalanceFromTransactions) để không nhân bản semantics ledger.
 */
export type PaidStatus = "paid" | "partial" | "unpaid";

export function attributePaidFifo(
  charges: Array<{ sessionId: number; date: string; totalAmount: number }>,
  balance: number,
): Record<number, PaidStatus> {
  const result: Record<number, PaidStatus> = {};
  let deficit = Math.max(0, -balance);
  const newestFirst = [...charges].sort(
    (a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId,
  );
  for (const c of newestFirst) {
    if (deficit <= 0 || c.totalAmount <= 0) {
      result[c.sessionId] = "paid";
      continue;
    }
    if (deficit >= c.totalAmount) {
      result[c.sessionId] = "unpaid";
      deficit -= c.totalAmount;
    } else {
      result[c.sessionId] = "partial";
      deficit = 0;
    }
  }
  return result;
}
```

- [ ] **Step 4: Chạy test pass**

Run: `pnpm vitest run src/lib/fifo-paid-attribution.test.ts`
Expected: PASS 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fifo-paid-attribution.ts src/lib/fifo-paid-attribution.test.ts
git commit -m "feat(members): add FIFO paid attribution helper for play history"
```

---

### Task 2: Server action `getMemberPlayHistory`

**Files:**

- Create: `src/actions/member-history.ts`
- Test: `src/actions/member-history.integration.test.ts`

**Interfaces:**

- Consumes: `attributePaidFifo`, `PaidStatus` (Task 1); `computeBalanceFromTransactions` từ `@/lib/fund-core`; `requireAdmin` từ `@/lib/auth`.
- Produces (Task 3 dùng đúng shape này):

  ```ts
  export type MemberPlayHistoryEntry = {
    sessionId: number;
    date: string; // YYYY-MM-DD
    startTime: string; // "20:30"
    endTime: string; // "22:30"
    courtName: string | null;
    totalAmount: number;
    playAmount: number; // đã gộp guestPlayAmount
    dineAmount: number; // đã gộp guestDineAmount
    paidStatus: PaidStatus;
  };
  export type MemberPlayHistoryResult =
    | { balance: number; entries: MemberPlayHistoryEntry[] } // entries sort date DESC
    | { error: string };
  export async function getMemberPlayHistory(
    memberId: number,
  ): Promise<MemberPlayHistoryResult>;
  ```

- [ ] **Step 1: Viết integration test fail trước**

Harness copy đúng pattern `src/actions/get-session-votes-redaction.integration.test.ts` (createTestDb + vi.mock @/db), thêm mock `@/lib/auth`.

```ts
// src/actions/member-history.integration.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/db/test-db";
import {
  members,
  sessions,
  sessionDebts,
  financialTransactions,
  courts,
} from "@/db/schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ admin: { role: "admin" } })),
}));

const { db: testDb, client } = await createTestDb();
vi.mock("@/db", () => ({ db: testDb }));

const { getMemberPlayHistory } = await import("./member-history");

async function reset() {
  await client.execute("DELETE FROM financial_transactions");
  await client.execute("DELETE FROM session_debts");
  await client.execute("DELETE FROM sessions");
  await client.execute("DELETE FROM courts");
  await client.execute("DELETE FROM members");
}

describe("getMemberPlayHistory", () => {
  beforeEach(reset);

  it("chỉ trả buổi completed, sort date desc, FIFO status theo balance", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Cún" })
      .returning({ id: members.id });
    const [court] = await testDb
      .insert(courts)
      .values({ name: "THCS Tây Mỗ 3", pricePerSession: 420000 })
      .returning({ id: courts.id });
    const mkSession = async (date: string, status: string) => {
      const [s] = await testDb
        .insert(sessions)
        .values({ date, status, courtId: court.id })
        .returning({ id: sessions.id });
      return s.id;
    };
    const s1 = await mkSession("2026-06-22", "completed");
    const s2 = await mkSession("2026-06-24", "completed");
    const sVoting = await mkSession("2026-06-29", "voting"); // phải bị loại
    await testDb.insert(sessionDebts).values([
      { sessionId: s1, memberId: m.id, totalAmount: 40000, playAmount: 40000 },
      { sessionId: s2, memberId: m.id, totalAmount: 50000, playAmount: 50000 },
      {
        sessionId: sVoting,
        memberId: m.id,
        totalAmount: 60000,
        playAmount: 60000,
      },
    ]);
    // Nạp 70K, bị trừ 90K (2 buổi completed) → balance -20K → buổi mới nhất partial
    await testDb.insert(financialTransactions).values([
      {
        type: "fund_contribution",
        direction: "in",
        amount: 70000,
        memberId: m.id,
        description: "nạp",
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 40000,
        memberId: m.id,
        description: "buổi 22/6",
      },
      {
        type: "fund_deduction",
        direction: "out",
        amount: 50000,
        memberId: m.id,
        description: "buổi 24/6",
      },
    ]);

    const res = await getMemberPlayHistory(m.id);
    if ("error" in res) throw new Error(res.error);
    expect(res.balance).toBe(-20000);
    expect(res.entries.map((e) => e.sessionId)).toEqual([s2, s1]); // desc
    expect(res.entries[0].paidStatus).toBe("partial");
    expect(res.entries[1].paidStatus).toBe("paid");
    expect(res.entries[0].courtName).toBe("THCS Tây Mỗ 3");
    expect(res.entries[0].playAmount).toBe(50000);
  });

  it("member không có buổi nào → entries rỗng, vẫn có balance", async () => {
    const [m] = await testDb
      .insert(members)
      .values({ name: "Mới" })
      .returning({ id: members.id });
    await testDb
      .insert(financialTransactions)
      .values([
        {
          type: "fund_contribution",
          direction: "in",
          amount: 100000,
          memberId: m.id,
          description: "nạp",
        },
      ]);
    const res = await getMemberPlayHistory(m.id);
    if ("error" in res) throw new Error(res.error);
    expect(res.entries).toEqual([]);
    expect(res.balance).toBe(100000);
  });

  it("memberId không hợp lệ → error, không throw", async () => {
    const res = await getMemberPlayHistory(-1);
    expect("error" in res).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để fail**

Run: `pnpm vitest run src/actions/member-history.integration.test.ts`
Expected: FAIL — "Cannot find module './member-history'".

- [ ] **Step 3: Implement action**

```ts
// src/actions/member-history.ts
"use server";

import { db } from "@/db";
import { financialTransactions, sessionDebts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { computeBalanceFromTransactions } from "@/lib/fund-core";
import {
  attributePaidFifo,
  type PaidStatus,
} from "@/lib/fifo-paid-attribution";

export type MemberPlayHistoryEntry = {
  sessionId: number;
  date: string;
  startTime: string;
  endTime: string;
  courtName: string | null;
  totalAmount: number;
  playAmount: number;
  dineAmount: number;
  paidStatus: PaidStatus;
};

export type MemberPlayHistoryResult =
  | { balance: number; entries: MemberPlayHistoryEntry[] }
  | { error: string };

/**
 * Lịch sử chơi của 1 member cho admin: các buổi ĐÃ CHỐT SỔ member này bị tính
 * tiền, kèm trạng thái đã trả per-buổi theo FIFO (spec 2026-07-02). Read-only.
 */
export async function getMemberPlayHistory(
  memberId: number,
): Promise<MemberPlayHistoryResult> {
  const auth = await requireAdmin();
  if ("error" in auth) return { error: auth.error };

  const parsed = z.number().int().positive().safeParse(memberId);
  if (!parsed.success) return { error: "Invalid memberId" };

  const [debtRows, txs] = await Promise.all([
    db.query.sessionDebts.findMany({
      where: eq(sessionDebts.memberId, parsed.data),
      with: { session: { with: { court: true } } },
    }),
    db.query.financialTransactions.findMany({
      where: eq(financialTransactions.memberId, parsed.data),
      columns: { id: true, type: true, amount: true, reversalOfId: true },
    }),
  ]);

  const { balance } = computeBalanceFromTransactions(parsed.data, txs);

  const completed = debtRows.filter((d) => d.session?.status === "completed");
  const statusBySession = attributePaidFifo(
    completed.map((d) => ({
      sessionId: d.sessionId,
      date: d.session.date,
      totalAmount: d.totalAmount,
    })),
    balance,
  );

  const entries: MemberPlayHistoryEntry[] = completed
    .map((d) => ({
      sessionId: d.sessionId,
      date: d.session.date,
      startTime: d.session.startTime || "20:30",
      endTime: d.session.endTime || "22:30",
      courtName: d.session.court?.name ?? null,
      totalAmount: d.totalAmount,
      playAmount: (d.playAmount ?? 0) + (d.guestPlayAmount ?? 0),
      dineAmount: (d.dineAmount ?? 0) + (d.guestDineAmount ?? 0),
      paidStatus: statusBySession[d.sessionId],
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.sessionId - a.sessionId);

  return { balance, entries };
}
```

Lưu ý: `computeBalanceFromTransactions` trả `FundBalance` — nếu shape thực tế là `{ balance }` thì giữ như trên; nếu khác (đọc `src/lib/fund-core.ts` dòng 45-100 trước khi viết), lấy đúng field balance tổng.

- [ ] **Step 4: Chạy test pass**

Run: `pnpm vitest run src/actions/member-history.integration.test.ts`
Expected: PASS 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/actions/member-history.ts src/actions/member-history.integration.test.ts
git commit -m "feat(members): add getMemberPlayHistory action with FIFO paid status"
```

---

### Task 3: Shared sheet component + list view + nút ở /admin/members + i18n

**Files:**

- Create: `src/components/members/member-play-history-sheet.tsx`
- Modify: `src/app/(admin)/admin/members/member-list.tsx` (thêm import, state `historyTarget`, nút icon trên mỗi hàng, mount sheet)
- Modify: `src/i18n/messages/vi.json`, `en.json`, `zh.json` (namespace `memberHistory`)

**Interfaces:**

- Consumes: `getMemberPlayHistory`, `MemberPlayHistoryEntry` (Task 2); `useIsMobile`, `Sheet/Dialog`, `TabSegment`, `formatK`, `getFundStatus`.
- Produces (Task 4 + 5 dùng):

  ```ts
  export function MemberPlayHistorySheet(props: {
    memberId: number | null; // null = đóng
    memberName: string;
    onClose: () => void;
  }): JSX.Element;
  ```

  Nội bộ: `type ViewMode = "calendar" | "list"` — Task 3 render list; Task 4 thêm calendar và đặt default `"calendar"`.

- [ ] **Step 1: Thêm i18n keys (cả 3 locale)**

`vi.json` (thêm namespace mới, cạnh các namespace admin khác):

```json
"memberHistory": {
  "title": "Lịch sử chơi",
  "openHistory": "Xem lịch sử chơi",
  "tabCalendar": "Lịch",
  "tabList": "Danh sách",
  "statusPaid": "Đã trả",
  "statusPartial": "Trả một phần",
  "statusUnpaid": "Chưa trả",
  "owingLine": "Đang nợ {amount}đ",
  "fundLine": "Còn quỹ {amount}đ",
  "zeroLine": "Số dư 0đ",
  "empty": "Chưa có buổi nào được chốt sổ",
  "loadError": "Không tải được lịch sử, thử lại nhé",
  "prevPage": "Trang trước",
  "nextPage": "Trang sau",
  "pageOf": "Trang {page}/{total}",
  "detailCourt": "Sân",
  "detailTime": "Giờ chơi",
  "detailTotal": "Tổng tiền buổi",
  "detailPlay": "Tiền cầu",
  "detailDine": "Tiền nhậu",
  "sessionsInMonth": "{count} buổi trong tháng",
  "noSessionsInMonth": "Tháng này không có buổi nào"
}
```

`en.json`:

```json
"memberHistory": {
  "title": "Play history",
  "openHistory": "View play history",
  "tabCalendar": "Calendar",
  "tabList": "List",
  "statusPaid": "Paid",
  "statusPartial": "Partially paid",
  "statusUnpaid": "Unpaid",
  "owingLine": "Owing {amount}đ",
  "fundLine": "Fund balance {amount}đ",
  "zeroLine": "Balance 0đ",
  "empty": "No finalized sessions yet",
  "loadError": "Failed to load history, please retry",
  "prevPage": "Previous",
  "nextPage": "Next",
  "pageOf": "Page {page}/{total}",
  "detailCourt": "Court",
  "detailTime": "Time",
  "detailTotal": "Session total",
  "detailPlay": "Play share",
  "detailDine": "Dining share",
  "sessionsInMonth": "{count} sessions this month",
  "noSessionsInMonth": "No sessions this month"
}
```

`zh.json`:

```json
"memberHistory": {
  "title": "打球记录",
  "openHistory": "查看打球记录",
  "tabCalendar": "日历",
  "tabList": "列表",
  "statusPaid": "已付",
  "statusPartial": "部分已付",
  "statusUnpaid": "未付",
  "owingLine": "欠款 {amount}đ",
  "fundLine": "余额 {amount}đ",
  "zeroLine": "余额 0đ",
  "empty": "暂无已结算的场次",
  "loadError": "加载失败，请重试",
  "prevPage": "上一页",
  "nextPage": "下一页",
  "pageOf": "第 {page}/{total} 页",
  "detailCourt": "场地",
  "detailTime": "时间",
  "detailTotal": "本场总额",
  "detailPlay": "打球费",
  "detailDine": "聚餐费",
  "sessionsInMonth": "本月 {count} 场",
  "noSessionsInMonth": "本月没有场次"
}
```

Run: `node scripts/check-i18n-keys.mjs`
Expected: pass, không thiếu key locale nào.

- [ ] **Step 2: Viết component sheet (list view trước)**

```tsx
// src/components/members/member-play-history-sheet.tsx
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getMemberPlayHistory,
  type MemberPlayHistoryEntry,
} from "@/actions/member-history";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TabSegment } from "@/components/shared/tab-segment";
import { useIsMobile } from "@/lib/use-is-mobile";
import { cn, formatK } from "@/lib/utils";
import { formatSessionDate, type AppLocale } from "@/lib/date-format";
import type { PaidStatus } from "@/lib/fifo-paid-attribution";

type ViewMode = "calendar" | "list";
const LIST_PAGE_SIZE = 10;

const STATUS_CLASS: Record<PaidStatus, string> = {
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  partial: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  unpaid: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

export function MemberPlayHistorySheet({
  memberId,
  memberName,
  onClose,
}: {
  memberId: number | null;
  memberName: string;
  onClose: () => void;
}) {
  const t = useTranslations("memberHistory");
  const locale = useLocale() as AppLocale;
  const isMobile = useIsMobile();
  const [view, setView] = useState<ViewMode>("list"); // Task 4 đổi thành "calendar"

  const open = memberId !== null;
  const { data, isPending, isError } = useQuery({
    queryKey: ["member-play-history", memberId],
    queryFn: () => getMemberPlayHistory(memberId!),
    enabled: open,
  });

  const history = data && !("error" in data) ? data : null;

  const body = (
    <div className="space-y-4">
      <BalanceLine balance={history?.balance} loading={isPending} />
      <TabSegment<ViewMode>
        ariaLabel={t("title")}
        options={[
          { value: "calendar", label: t("tabCalendar") },
          { value: "list", label: t("tabList") },
        ]}
        value={view}
        onChange={setView}
      />
      {isPending ? (
        <HistorySkeleton />
      ) : isError || (data && "error" in data) ? (
        <p className="text-destructive py-8 text-center text-sm">
          {t("loadError")}
        </p>
      ) : history && history.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <span className="text-3xl">🏸</span>
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        </div>
      ) : history ? (
        <HistoryList entries={history.entries} locale={locale} />
      ) : null}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {t("title")} · {memberName}
            </SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("title")} · {memberName}
          </DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function BalanceLine({
  balance,
  loading,
}: {
  balance: number | undefined;
  loading: boolean;
}) {
  const t = useTranslations("memberHistory");
  if (loading || balance === undefined) {
    return <div className="bg-muted h-5 w-32 animate-pulse rounded" />;
  }
  if (balance < 0) {
    return (
      <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">
        {t("owingLine", { amount: formatK(-balance) })}
      </p>
    );
  }
  if (balance === 0) {
    return <p className="text-muted-foreground text-sm">{t("zeroLine")}</p>;
  }
  return (
    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
      {t("fundLine", { amount: formatK(balance) })}
    </p>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
      ))}
    </div>
  );
}

function StatusBadgeFor({ status }: { status: PaidStatus }) {
  const t = useTranslations("memberHistory");
  const label =
    status === "paid"
      ? t("statusPaid")
      : status === "partial"
        ? t("statusPartial")
        : t("statusUnpaid");
  return (
    <Badge variant="outline" className={cn("border-0", STATUS_CLASS[status])}>
      {label}
    </Badge>
  );
}

function EntryDetail({
  entry,
  locale,
}: {
  entry: MemberPlayHistoryEntry;
  locale: AppLocale;
}) {
  const t = useTranslations("memberHistory");
  const rows: Array<[string, string]> = [
    [t("detailTime"), `${entry.startTime} - ${entry.endTime}`],
    [t("detailCourt"), entry.courtName ?? "-"],
    [t("detailTotal"), `${formatK(entry.totalAmount)}đ`],
  ];
  if (entry.playAmount > 0)
    rows.push([t("detailPlay"), `${formatK(entry.playAmount)}đ`]);
  if (entry.dineAmount > 0)
    rows.push([t("detailDine"), `${formatK(entry.dineAmount)}đ`]);
  return (
    <div className="text-muted-foreground space-y-1 pt-2 text-sm">
      <p className="text-foreground font-medium">
        {formatSessionDate(entry.date, "long", locale)}
      </p>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span>{k}</span>
          <span className="text-foreground font-medium">{v}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryList({
  entries,
  locale,
}: {
  entries: MemberPlayHistoryEntry[];
  locale: AppLocale;
}) {
  const t = useTranslations("memberHistory");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const totalPages = Math.max(1, Math.ceil(entries.length / LIST_PAGE_SIZE));
  const pageEntries = useMemo(
    () => entries.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE),
    [entries, page],
  );
  return (
    <div className="space-y-2">
      {pageEntries.map((e) => (
        <button
          key={e.sessionId}
          type="button"
          onClick={() =>
            setExpandedId(expandedId === e.sessionId ? null : e.sessionId)
          }
          className="bg-card/80 w-full rounded-xl border p-3 text-left"
        >
          <div className="flex min-h-11 items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">
                {formatSessionDate(e.date, "long", locale)}
              </p>
              <p className="text-muted-foreground text-sm">
                {e.startTime} - {e.endTime} · {formatK(e.totalAmount)}đ
              </p>
            </div>
            <StatusBadgeFor status={e.paidStatus} />
          </div>
          {expandedId === e.sessionId && (
            <EntryDetail entry={e} locale={locale} />
          )}
        </button>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label={t("prevPage")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-muted-foreground text-sm">
            {t("pageOf", { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            aria-label={t("nextPage")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
```

Lưu ý khi implement: đối chiếu API thật của `TabSegment` (đọc `src/components/shared/tab-segment.tsx` — prop `options` là mảng gì) và `formatSessionDate` (variant + `AppLocale` export từ đâu) rồi chỉnh import/props cho khớp; nếu `AppLocale` không export từ date-format thì dùng `useLocale()` trả string và cast theo cách history-client.tsx đang làm.

- [ ] **Step 3: Gắn nút vào member-list.tsx**

Trong `src/app/(admin)/admin/members/member-list.tsx`:

1. Import: `import { MemberPlayHistorySheet } from "@/components/members/member-play-history-sheet";` và icon `History` từ lucide-react (thêm vào import lucide sẵn có).
2. State cạnh các state khác: `const [historyTarget, setHistoryTarget] = useState<Member | null>(null);`
3. Trên mỗi hàng member, cạnh cụm nút action sẵn có (Edit/Lock...), thêm nút cùng style các icon-button hiện hữu (copy className của nút Edit trong file để đồng bộ, đảm bảo `min-h-11 min-w-11` hoặc tương đương ≥44px):

```tsx
<Button
  variant="ghost"
  size="icon"
  className="min-h-11 min-w-11"
  aria-label={tHistory("openHistory")}
  onClick={() => setHistoryTarget(member)}
>
  <History className="size-4" />
</Button>
```

với `const tHistory = useTranslations("memberHistory");` cạnh `useTranslations` sẵn có. 4. Cuối JSX (cạnh các dialog sẵn có như ConfirmDialog/FundAdjustDialog):

```tsx
<MemberPlayHistorySheet
  memberId={historyTarget?.id ?? null}
  memberName={historyTarget ? historyTarget.nickname || historyTarget.name : ""}
  onClose={() => setHistoryTarget(null)}
/>
```

- [ ] **Step 4: Verify build + chạy dev xem tay**

Run: `pnpm lint && pnpm vitest run && pnpm build`
Expected: pass hết, không lỗi type.
Dev check (nếu có DB local clone): mở `/admin/members`, bấm icon lịch sử → sheet mở, list hiện buổi + badge trạng thái, phân trang khi >10 buổi.

- [ ] **Step 5: Commit**

```bash
git add src/components/members/member-play-history-sheet.tsx "src/app/(admin)/admin/members/member-list.tsx" src/i18n/messages/vi.json src/i18n/messages/en.json src/i18n/messages/zh.json
git commit -m "feat(members): play-history sheet with paginated list view"
```

---

### Task 4: Calendar view (default)

**Files:**

- Modify: `src/components/members/member-play-history-sheet.tsx`

**Interfaces:**

- Consumes: `MemberPlayHistoryEntry`, `EntryDetail`, `STATUS_CLASS` (Task 3); date-fns + `getDateFnsLocale` (pattern có sẵn trong `src/app/(public)/history/history-client.tsx` — ĐỌC file đó trước để copy đúng cách dựng month grid).
- Produces: `HistoryCalendar` component nội bộ; default `view` đổi thành `"calendar"`.

- [ ] **Step 1: Thêm HistoryCalendar + đổi default view**

Đổi `useState<ViewMode>("list")` → `useState<ViewMode>("calendar")`, và render `view === "calendar" ? <HistoryCalendar .../> : <HistoryList .../>`.

```tsx
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

const DOT_CLASS: Record<PaidStatus, string> = {
  paid: "bg-emerald-500",
  partial: "bg-amber-500",
  unpaid: "bg-rose-500",
};

function HistoryCalendar({
  entries,
  locale,
}: {
  entries: MemberPlayHistoryEntry[];
  locale: AppLocale;
}) {
  const t = useTranslations("memberHistory");
  const dfLocale = getDateFnsLocale(locale);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<MemberPlayHistoryEntry | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, MemberPlayHistoryEntry>();
    for (const e of entries) m.set(e.date, e); // 1 buổi/ngày theo unique(sessionId,memberId) + 1 session/ngày
    return m;
  }, [entries]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  const monthCount = entries.filter((e) =>
    isSameMonth(parseISO(e.date), month),
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 min-w-11"
          onClick={() => {
            setMonth((m) => addMonths(m, -1));
            setSelected(null);
          }}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-semibold capitalize">
          {format(month, "MMMM yyyy", { locale: dfLocale })}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 min-w-11"
          onClick={() => {
            setMonth((m) => addMonths(m, 1));
            setSelected(null);
          }}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.slice(0, 7).map((d) => (
          <div
            key={`h-${d.toISOString()}`}
            className="text-muted-foreground py-1 text-center text-xs font-medium"
          >
            {format(d, "EEEEEE", { locale: dfLocale })}
          </div>
        ))}
        {days.map((d) => {
          const ymd = format(d, "yyyy-MM-dd");
          const entry = byDay.get(ymd);
          const inMonth = isSameMonth(d, month);
          return (
            <button
              key={ymd}
              type="button"
              disabled={!entry}
              onClick={() => entry && setSelected(entry)}
              onMouseEnter={() => entry && setSelected(entry)}
              className={cn(
                "relative flex min-h-11 flex-col items-center justify-center rounded-lg text-sm",
                !inMonth && "text-muted-foreground/40",
                entry && "bg-card/80 border font-semibold",
                selected?.date === ymd && "ring-primary ring-2",
              )}
            >
              {format(d, "d")}
              {entry && (
                <span
                  className={cn(
                    "absolute bottom-1 size-1.5 rounded-full",
                    DOT_CLASS[entry.paidStatus],
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-center text-sm">
        {monthCount > 0
          ? t("sessionsInMonth", { count: monthCount })
          : t("noSessionsInMonth")}
      </p>
      {selected && (
        <div className="bg-card/80 rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <StatusBadgeFor status={selected.paidStatus} />
          </div>
          <EntryDetail entry={selected} locale={locale} />
        </div>
      )}
    </div>
  );
}
```

Chi tiết hành vi: hover (desktop) và tap (mobile) đều set `selected` → card chi tiết hiện dưới grid (đáp ứng yêu cầu "hover hoặc click để xem chi tiết"). Ngày không có buổi thì disabled.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: pass. Dev check: mở sheet → mặc định tab Lịch, tháng hiện tại, chấm màu đúng trạng thái, bấm ngày có buổi hiện chi tiết, chuyển tháng OK, tab Danh sách vẫn hoạt động như Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/components/members/member-play-history-sheet.tsx
git commit -m "feat(members): month calendar view for play history (default)"
```

---

### Task 5: Nút lịch sử ở /admin/fund

**Files:**

- Modify: `src/app/(admin)/admin/fund/fund-dashboard.tsx`

**Interfaces:**

- Consumes: `MemberPlayHistorySheet` (Task 3) — component tự fetch, chỉ cần memberId + tên.

- [ ] **Step 1: Gắn nút + sheet**

Trong `fund-dashboard.tsx` (client component, member rows quanh dòng 99 `member: fm.member`):

1. Import `MemberPlayHistorySheet` + icon `History`.
2. State: `const [historyTarget, setHistoryTarget] = useState<{ id: number; name: string } | null>(null);`
3. Trên mỗi hàng member trong danh sách quỹ, cạnh các nút action sẵn có, thêm nút icon giống Task 3 Step 3 (copy style nút icon hiện hữu của file này):

```tsx
<Button
  variant="ghost"
  size="icon"
  className="min-h-11 min-w-11"
  aria-label={tHistory("openHistory")}
  onClick={() =>
    setHistoryTarget({
      id: fm.memberId,
      name: fm.member.nickname || fm.member.name,
    })
  }
>
  <History className="size-4" />
</Button>
```

4. Cuối JSX:

```tsx
<MemberPlayHistorySheet
  memberId={historyTarget?.id ?? null}
  memberName={historyTarget?.name ?? ""}
  onClose={() => setHistoryTarget(null)}
/>
```

Đọc file trước khi sửa: tên biến row có thể không phải `fm` — bám theo cấu trúc thật.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: pass. Dev check: `/admin/fund` bấm icon → cùng sheet như trang members.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/fund/fund-dashboard.tsx"
git commit -m "feat(fund): reuse play-history sheet on fund page"
```

---

### Task 6: Verify tổng + review

- [ ] **Step 1: Full test + build + i18n**

Run: `pnpm lint && pnpm vitest run && pnpm build && node scripts/check-i18n-keys.mjs`
Expected: tất cả pass, không key i18n thiếu.

- [ ] **Step 2: Review chuyên biệt (read-only agents)**

- Dispatch agent `finance-invariant-reviewer` review diff (action đọc tiền + FIFO semantics).
- Dispatch agent `mobile-ui-reviewer` review `member-play-history-sheet.tsx` + 2 chỗ gắn nút.
  Fix mọi finding CONFIRMED trước khi báo xong.

- [ ] **Step 3: Verify hành vi thật**

Chạy dev server với DB clone local (`pnpm db:clone-local` rồi `pnpm dev`), mở `/admin/members`:

- Member đang âm quỹ (vd cún -109K): buổi mới nhất unpaid/partial, buổi cũ paid.
- Member dương quỹ: tất cả paid.
- Mobile viewport 390px: sheet đáy, không tràn ngang, touch target đủ.

- [ ] **Step 4: Push + báo user**

Push branch `feat/member-play-history`, báo kết quả kèm evidence (output test/build, mô tả verify tay).

---

## Self-review (đã chạy khi viết plan)

- Spec coverage: FIFO lib (T1), action (T2), sheet + list + phân trang + nút members (T3), calendar default + hover/click detail (T4), fund page dùng chung (T5), i18n (T3), test tiền bạc (T1+T2), mobile-first + skeleton + empty state (T3), verify (T6). Đủ các mục spec.
- Type consistency: `PaidStatus`, `MemberPlayHistoryEntry`, props `MemberPlayHistorySheet` thống nhất T1→T5.
- Known unknowns đã ghi chú inline: shape `FundBalance`, API `TabSegment`/`formatSessionDate`, tên biến row trong fund-dashboard — implementer PHẢI đọc file thật trước khi áp code mẫu.
