# Partner Headcount ("đi 2 người") + Product Tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép một tài khoản đại diện 1 hoặc 2 người ("đi 2 người"), tính tiền đúng cho người thứ 2 (member tự trả, member-floor); và thêm product tour (driver.js) hướng dẫn vote / xem quỹ / nộp quỹ.

**Architecture:** Người thứ 2 = 1 đầu người gộp vào phần chơi/nhậu của CHÍNH member (KHÔNG phải khách). Cơ chế: `votes.with_partner` (snapshot mỗi phiếu) + `members.default_with_partner` (default acc) + `session_attendees.headcount` (1/2). `cost-calculator` đếm `totalPlayers = Σ headcount` và nhân `playAmount × headcount`; min-deduction floor không đổi (partner nằm trong playAmount của member). Product tour độc lập, dùng driver.js + localStorage.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle + Turso (SQLite), Zod, next-intl (vi/en/zh), Vitest, driver.js (mới).

**Spec:** `docs/superpowers/specs/2026-06-15-partner-headcount-and-product-tour-design.md`

**Quy ước chung khi chạy plan:**

- TDD cho mọi logic tiền: viết test đỏ → chạy thấy fail → code tối thiểu → xanh.
- Test: `npx vitest run <path>`. Typecheck: `npx tsc --noEmit`. Build gate: `npm run build`.
- Commit cuối mỗi task. Conventional Commits; type ∈ {feat, fix, chore, docs, refactor, test, ...} (commitlint chặn type lạ như `i18n`). Kết commit bằng:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  (multi-line message: ghi ra file `d:/tmp/msg.txt` rồi `git commit -F`).
- Sau mỗi phase: `npm run build` xanh trước khi push `main`.
- KHÔNG in PII (tên/email/SĐT/bank) ra log/output.

---

## File Structure

**Tạo mới:**

- `src/lib/partner-core.ts` — pure helpers (heads, resolve default). Import được từ Server Component.
- `src/lib/partner-core.test.ts` — unit tests.
- `src/db/migrations/0015_partner_headcount.sql` — sinh bởi `drizzle-kit generate`, review tay.
- `src/components/tour/tour-steps.ts` — config steps (i18n-driven).
- `src/components/tour/use-product-tour.ts` — hook khởi tạo driver.js.
- `src/components/tour/product-tour-launcher.tsx` — nút fixed góc dưới phải + auto-run.

**Sửa:**

- `src/db/schema.ts` — 3 cột mới.
- `src/lib/cost-calculator.ts` — `AttendeeInput.headcount`; `totalPlayers/totalDiners` & per-member amount theo headcount; forecast partner-aware.
- `src/lib/cost-calculator.test.ts` — thêm test partner (nếu file chưa có thì tạo).
- `src/lib/vote-list-utils.ts` — `countVoteParticipation` dùng partner-core; thêm `partnerPlay/partnerDine`.
- `src/lib/vote-list-utils.test.ts` — thêm test.
- `src/lib/optimistic-votes.ts` — `VoteTotalsPatch.withPartner`; `applyMemberVotePatch` set withPartner.
- `src/lib/validators.ts` — `voteSchema.withPartner`; `finalizeAttendeeSchema.headcount`.
- `src/actions/votes.ts` — `submitVote` thêm `withPartner`.
- `src/actions/members.ts` — `getActiveMembers` trả `defaultWithPartner`; `createMember`/`updateMember`/`updateMyProfile` set field.
- `src/actions/password-auth.ts` — `signupWithPassword` nhận `withPartner`.
- `src/actions/finance.ts` — `FinalizeAttendee.headcount`, attendeeInputs map, `sessionAttendees` insert.
- `src/components/sessions/vote-buttons.tsx` — toggle "Đi 2 người" + data-tour anchors.
- `src/components/sessions/session-vote-optimistic-panel.tsx` — truyền `currentWithPartner`.
- `src/components/sessions/finalize-session.tsx` — headcount per member + toggle.
- `src/app/(public)/password-auth-form.tsx` — checkbox signup.
- `src/app/(public)/me/me-client.tsx` + `src/app/(public)/me/page.tsx` — toggle profile.
- `src/app/(admin)/admin/members/member-list.tsx` — checkbox tạo + sửa nhanh.
- `src/components/finance/fund-balance-banner.tsx` + `src/components/finance/fund-topup-card.tsx` — data-tour anchors.
- `src/components/layout/bottom-nav.tsx` — data-tour anchors.
- `src/app/(public)/layout.tsx` — mount `ProductTourLauncher`.
- `src/i18n/messages/{vi,en,zh}.json` — namespace `tour` + key partner.
- `package.json` — thêm `driver.js`.

---

# PHASE 1 — Financial core (TDD trước)

## Task 1: `partner-core.ts` — pure helpers

**Files:**

- Create: `src/lib/partner-core.ts`
- Test: `src/lib/partner-core.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/lib/partner-core.test.ts
import { describe, it, expect } from "vitest";
import {
  MAX_HEADCOUNT,
  votePlayHeads,
  voteDineHeads,
  resolveVoteWithPartner,
} from "./partner-core";

describe("partner-core", () => {
  it("MAX_HEADCOUNT là 2", () => {
    expect(MAX_HEADCOUNT).toBe(2);
  });

  it("không chơi → 0 đầu chơi dù bật partner", () => {
    expect(votePlayHeads({ willPlay: false, withPartner: true })).toBe(0);
  });

  it("chơi 1 mình → 1 đầu", () => {
    expect(votePlayHeads({ willPlay: true, withPartner: false })).toBe(1);
  });

  it("chơi + partner → 2 đầu", () => {
    expect(votePlayHeads({ willPlay: true, withPartner: true })).toBe(2);
  });

  it("nhậu + partner → 2 đầu; không nhậu → 0", () => {
    expect(voteDineHeads({ willDine: true, withPartner: true })).toBe(2);
    expect(voteDineHeads({ willDine: false, withPartner: true })).toBe(0);
  });

  it("resolveVoteWithPartner: chưa có vote → theo default acc", () => {
    expect(resolveVoteWithPartner(undefined, true)).toBe(true);
    expect(resolveVoteWithPartner(undefined, false)).toBe(false);
  });

  it("resolveVoteWithPartner: có vote → theo snapshot của vote", () => {
    expect(resolveVoteWithPartner({ withPartner: true }, false)).toBe(true);
    expect(resolveVoteWithPartner({ withPartner: false }, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/partner-core.test.ts`
Expected: FAIL — `Cannot find module './partner-core'`.

- [ ] **Step 3: Implement**

```ts
// src/lib/partner-core.ts
/**
 * Helpers cho tính năng "đi 2 người" (partner). Người thứ 2 = 1 đầu người do
 * CHÍNH member trả (member-floor), KHÔNG phải khách. Pure — import được từ
 * Server Component lẫn client.
 */

/** Số người tối đa 1 acc đại diện (1 mình hoặc 2 mình). */
export const MAX_HEADCOUNT = 2;

interface PartnerVote {
  willPlay?: boolean | null;
  willDine?: boolean | null;
  withPartner?: boolean | null;
}

/** Số đầu CHƠI của 1 phiếu vote: 0 nếu không chơi, 2 nếu chơi + partner, 1 nếu chơi 1 mình. */
export function votePlayHeads(vote: PartnerVote): number {
  if (!vote.willPlay) return 0;
  return vote.withPartner ? 2 : 1;
}

/** Số đầu NHẬU của 1 phiếu vote. */
export function voteDineHeads(vote: PartnerVote): number {
  if (!vote.willDine) return 0;
  return vote.withPartner ? 2 : 1;
}

/**
 * Giá trị "đi 2 người" để hiển trên UI vote: nếu member đã có phiếu → theo
 * snapshot của phiếu; chưa vote → theo default của acc.
 */
export function resolveVoteWithPartner(
  vote: { withPartner?: boolean | null } | undefined,
  memberDefault: boolean,
): boolean {
  if (vote) return !!vote.withPartner;
  return memberDefault;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/partner-core.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/partner-core.ts src/lib/partner-core.test.ts
git commit -F d:/tmp/msg.txt   # "feat(partner): partner-core pure helpers (heads + resolve default)"
```

---

## Task 2: Schema — 3 cột mới + migration 0015

**Files:**

- Modify: `src/db/schema.ts` (members ~line 59, votes ~line 168, sessionAttendees ~line 189)
- Create: `src/db/migrations/0015_partner_headcount.sql` (sinh bởi drizzle-kit)

- [ ] **Step 1: Thêm cột vào `members`** (sau `isActive`, trước `createdAt`)

```ts
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  /** "Đi 2 người": acc này mặc định mỗi buổi đi 1 hay 2 người (vợ/chồng/bạn
   *  đi cùng). Snapshot vào votes.with_partner lúc vote; đổi đây KHÔNG hồi tố. */
  defaultWithPartner: integer("default_with_partner", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").default(sql`(current_timestamp)`),
```

- [ ] **Step 2: Thêm cột vào `votes`** (sau `guestDineCount`, trước `createdAt`)

```ts
    guestDineCount: integer("guest_dine_count").default(0),
    /** Snapshot "đi 2 người" của phiếu này. true → member + người đi cùng = 2
     *  đầu (cả chơi lẫn nhậu, theo những mục member tham gia). Default theo
     *  members.default_with_partner lúc UI mở; ghi giá trị thật khi submit. */
    withPartner: integer("with_partner", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").default(sql`(current_timestamp)`),
```

- [ ] **Step 3: Thêm cột vào `sessionAttendees`** (sau `isGuest` ~line 189)

```ts
  isGuest: integer("is_guest", { mode: "boolean" }).default(false),
  /** Số đầu người attendee này đại diện ở phần CHƠI/NHẬU của CHÍNH họ. Member
   *  "đi 2 người" → 2. Guest luôn 1. Bất biến headcount ∈ {1,2} giữ ở app
   *  layer (zod finalizeAttendeeSchema) — KHÔNG thêm CHECK ở DB để migration là
   *  ADD COLUMN thuần (tránh recreate-table làm rớt index trên Turso, xem
   *  reference_turso_migration_gotcha; cùng cách courtPrice giữ invariant ở app). */
  headcount: integer("headcount").notNull().default(1),
```

(Nếu `sessionAttendees` có thêm cột sau `isGuest` thì chèn ngay sau dòng `isGuest`.)

- [ ] **Step 4: Generate migration**

Run: `npm run db:generate`
Expected: tạo `src/db/migrations/0015_*.sql`. Đổi tên file (và entry trong `src/db/migrations/meta/_journal.json` nếu cần) cho rõ: `0015_partner_headcount.sql`.

- [ ] **Step 5: Review SQL — BẮT BUỘC chỉ là ADD COLUMN**

Mở file `0015_*.sql`. Phải là 3 câu dạng:

```sql
ALTER TABLE `members` ADD `default_with_partner` integer DEFAULT false NOT NULL;
ALTER TABLE `votes` ADD `with_partner` integer DEFAULT false NOT NULL;
ALTER TABLE `session_attendees` ADD `headcount` integer DEFAULT 1 NOT NULL;
```

⚠️ Nếu drizzle sinh ra `CREATE TABLE ... __new` + `DROP` + `INSERT` (recreate-table) → STOP, sửa file tay về 3 ALTER thuần ở trên (recreate-table làm rớt index trên Turso — đã từng dính ở 0014). KHÔNG có CHECK constraint.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (cột mới nullable-safe vì có default; insert hiện tại không cần truyền).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -F d:/tmp/msg.txt   # "feat(db): migration 0015 — partner headcount columns (additive)"
```

> Migration CHƯA apply lên prod ở đây. Apply ở cuối Phase 1 (Task 6) sau khi code+test xanh.

---

## Task 3: `cost-calculator` — headcount-aware

**Files:**

- Modify: `src/lib/cost-calculator.ts` (`AttendeeInput` ~line 45; `calculateSessionCosts` ~line 278; `computePredictedMinDeductionSurplus` ~line 181)
- Test: `src/lib/cost-calculator.test.ts` (tạo nếu chưa có)

- [ ] **Step 1: Write failing tests**

Tạo/append `src/lib/cost-calculator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calculateSessionCosts, type AttendeeInput } from "./cost-calculator";

function member(id: number, opts: Partial<AttendeeInput> = {}): AttendeeInput {
  return {
    memberId: id,
    invitedById: null,
    isGuest: false,
    attendsPlay: true,
    attendsDine: false,
    ...opts,
  };
}

describe("calculateSessionCosts — partner headcount", () => {
  it("member đi 2 người chơi → tính 2 đầu, member trả 2 suất", () => {
    // court 200k, 2 player-heads (1 member headcount=2) → perHead 100k.
    const r = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [member(1, { headcount: 2 })],
      [],
    );
    expect(r.totalPlayers).toBe(2);
    expect(r.playCostPerHead).toBe(100_000);
    const d = r.memberDebts.find((x) => x.memberId === 1)!;
    expect(d.playAmount).toBe(200_000); // 2 × perHead
    expect(d.guestPlayAmount).toBe(0); // KHÔNG lẫn vào guest
    expect(d.totalAmount).toBe(200_000);
  });

  it("partner + guest cùng lúc: divisor = 2 (member) + 1 (guest) = 3", () => {
    // court 300k / 3 đầu = 100k. Member trả 2×100k own + 1×100k guest = 300k.
    const r = calculateSessionCosts(
      { courtPrice: 300_000, diningBill: 0 },
      [
        member(1, { headcount: 2 }),
        {
          memberId: null,
          invitedById: 1,
          isGuest: true,
          attendsPlay: true,
          attendsDine: false,
        },
      ],
      [],
    );
    expect(r.totalPlayers).toBe(3);
    expect(r.playCostPerHead).toBe(100_000);
    const d = r.memberDebts.find((x) => x.memberId === 1)!;
    expect(d.playAmount).toBe(200_000);
    expect(d.guestPlayAmount).toBe(100_000);
    expect(d.guestPlayCount).toBe(1);
    expect(d.totalAmount).toBe(300_000);
  });

  it("headcount mặc định 1 khi không truyền (backward-compat)", () => {
    const r = calculateSessionCosts(
      { courtPrice: 200_000, diningBill: 0 },
      [member(1), member(2)],
      [],
    );
    expect(r.totalPlayers).toBe(2);
    expect(r.playCostPerHead).toBe(100_000);
  });

  it("member đi 2 người nhậu → dine 2 suất", () => {
    const r = calculateSessionCosts(
      { courtPrice: 0, diningBill: 200_000 },
      [member(1, { attendsPlay: false, attendsDine: true, headcount: 2 })],
      [],
    );
    expect(r.totalDiners).toBe(2);
    expect(r.dineCostPerHead).toBe(100_000);
    const d = r.memberDebts.find((x) => x.memberId === 1)!;
    expect(d.dineAmount).toBe(200_000);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/cost-calculator.test.ts`
Expected: FAIL — `totalPlayers` = 1 (chưa tính headcount), `playAmount` = 100_000.

- [ ] **Step 3: Implement — `AttendeeInput.headcount`**

Trong `src/lib/cost-calculator.ts`, sửa interface (~line 45):

```ts
export interface AttendeeInput {
  memberId: number | null;
  guestName?: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
  /** Số đầu người attendee đại diện ở phần của CHÍNH họ (member "đi 2 người" → 2).
   *  Guest = 1. Mặc định 1 nếu không truyền (backward-compat). */
  headcount?: number;
}
```

- [ ] **Step 4: Implement — `calculateSessionCosts` đếm theo headcount**

Sửa phần đếm + per-member trong `calculateSessionCosts`:

Thay (~line 284-288):

```ts
const allPlayers = attendees.filter((a) => a.attendsPlay);
const allDiners = attendees.filter((a) => a.attendsDine);

const totalPlayers = allPlayers.length;
const totalDiners = allDiners.length;
```

bằng:

```ts
const allPlayers = attendees.filter((a) => a.attendsPlay);
const allDiners = attendees.filter((a) => a.attendsDine);

// Đếm theo headcount: member "đi 2 người" (headcount=2) đóng 2 đầu; guest=1.
const totalPlayers = allPlayers.reduce((s, a) => s + (a.headcount ?? 1), 0);
const totalDiners = allDiners.reduce((s, a) => s + (a.headcount ?? 1), 0);
```

Trong vòng `for (const memberId of memberIds)`, thay đoạn tính `playAmount`/`dineAmount` (~line 324-342). Thêm lookup headcount của row member rồi nhân:

```ts
// headcount của row member (không phải guest). Người đi cùng = +1 đầu do
// member tự trả → gộp vào playAmount/dineAmount của member, KHÔNG vào guest.
const memberHeadcount =
  attendees.find((a) => a.memberId === memberId && !a.isGuest)?.headcount ?? 1;

const playAmount = memberPlays ? playCostPerHead * memberHeadcount : 0;
const dineAmount = memberDines ? dineCostPerHead * memberHeadcount : 0;
```

(Giữ nguyên `guestPlayAmount`/`guestDineAmount`/`totalAmount` bên dưới.)

- [ ] **Step 5: Run, verify pass**

Run: `npx vitest run src/lib/cost-calculator.test.ts`
Expected: PASS. Cũng chạy lại toàn bộ test tiền để không regress:
Run: `npx vitest run src/lib/ src/actions/`
Expected: PASS (mọi test cũ vẫn xanh — headcount mặc định 1).

- [ ] **Step 6: Forecast partner-aware — `computePredictedMinDeductionSurplus`**

Hiện forecast giả định 1 đầu/member. Thêm input optional `playingMemberHeadcounts` để khớp debt thật khi member đi 2 người. Sửa signature + thân (~line 181):

```ts
export function computePredictedMinDeductionSurplus(input: {
  playingMemberIds: ReadonlyArray<number>;
  memberBalances: Readonly<Record<number, number>>;
  exemptMemberIds: ReadonlyArray<number>;
  playCostPerHead: number;
  guestPlayCount?: number;
  /** headcount của từng member chơi (memberId → 1|2). Thiếu → coi như 1. */
  playingMemberHeadcounts?: Readonly<Record<number, number>>;
  floor?: number;
}): number {
  const floor = input.floor ?? MIN_DEDUCTION_PER_HEAD;
  if (input.playCostPerHead >= floor) return 0;
  if (input.playCostPerHead <= 0) return 0;
  const exemptSet = new Set(input.exemptMemberIds);
  let surplus = 0;
  for (const memberId of input.playingMemberIds) {
    if (exemptSet.has(memberId)) continue;
    const balance = input.memberBalances[memberId] ?? 0;
    const headcount = input.playingMemberHeadcounts?.[memberId] ?? 1;
    const playAmount = input.playCostPerHead * headcount;
    // Member-floor: chỉ phạt khi thiếu quỹ trả playAmount AND playAmount < floor.
    if (balance < playAmount && playAmount < floor) {
      surplus += floor - playAmount;
    }
  }
  if (input.guestPlayCount && input.guestPlayCount > 0) {
    surplus += input.guestPlayCount * (floor - input.playCostPerHead);
  }
  return surplus;
}
```

> Lưu ý: callers hiện tại không truyền `playingMemberHeadcounts` → hành vi cũ giữ nguyên (headcount=1). Caller nào muốn chính xác với partner sẽ truyền map (Task 8 nối ở các trang admin nếu cần — KHÔNG bắt buộc cho Phase 1, nhưng signature đã sẵn).

- [ ] **Step 7: Add forecast test**

Append vào `cost-calculator.test.ts`:

```ts
import { computePredictedMinDeductionSurplus } from "./cost-calculator";

describe("forecast surplus — partner", () => {
  it("member headcount=2, perHead 25k, broke → playAmount 50k < 60k → surplus 10k", () => {
    const s = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: 0 },
      exemptMemberIds: [],
      playCostPerHead: 25_000,
      playingMemberHeadcounts: { 1: 2 },
    });
    expect(s).toBe(10_000);
  });
  it("member headcount=2, playAmount 2×40k=80k ≥ 60k → không phạt", () => {
    const s = computePredictedMinDeductionSurplus({
      playingMemberIds: [1],
      memberBalances: { 1: 0 },
      exemptMemberIds: [],
      playCostPerHead: 40_000,
      playingMemberHeadcounts: { 1: 2 },
    });
    expect(s).toBe(0);
  });
});
```

- [ ] **Step 8: Run, verify pass**

Run: `npx vitest run src/lib/cost-calculator.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cost-calculator.ts src/lib/cost-calculator.test.ts
git commit -F d:/tmp/msg.txt   # "feat(finance): cost-calculator headcount-aware (partner = member-paid head)"
```

---

## Task 4: `countVoteParticipation` — partner heads

**Files:**

- Modify: `src/lib/vote-list-utils.ts` (~line 9-63)
- Test: `src/lib/vote-list-utils.test.ts`

- [ ] **Step 1: Write failing test**

Append `src/lib/vote-list-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countVoteParticipation } from "./vote-list-utils";

describe("countVoteParticipation — partner", () => {
  it("member chơi + withPartner → totalPlayers tính 2", () => {
    const r = countVoteParticipation([
      { willPlay: true, willDine: false, withPartner: true },
    ]);
    expect(r.memberPlay).toBe(2);
    expect(r.partnerPlay).toBe(1);
    expect(r.totalPlayers).toBe(2);
  });

  it("partner + khách: totalPlayers = 2 + guestPlay", () => {
    const r = countVoteParticipation([
      { willPlay: true, willDine: true, withPartner: true, guestPlayCount: 1 },
    ]);
    expect(r.totalPlayers).toBe(3); // 2 (member+partner) + 1 khách
    expect(r.totalDiners).toBe(2); // member+partner nhậu
    expect(r.partnerDine).toBe(1);
  });

  it("không partner → như cũ", () => {
    const r = countVoteParticipation([
      { willPlay: true, willDine: false, withPartner: false },
    ]);
    expect(r.memberPlay).toBe(1);
    expect(r.partnerPlay).toBe(0);
    expect(r.totalPlayers).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/vote-list-utils.test.ts`
Expected: FAIL — `partnerPlay` undefined; `memberPlay` = 1.

- [ ] **Step 3: Implement**

Sửa `ParticipationVote`, `VoteParticipation`, `countVoteParticipation` trong `src/lib/vote-list-utils.ts`. Import helpers:

```ts
import { votePlayHeads, voteDineHeads } from "./partner-core";
```

`ParticipationVote` thêm field:

```ts
export interface ParticipationVote {
  willPlay?: boolean | null;
  willDine?: boolean | null;
  guestPlayCount?: number | null;
  guestDineCount?: number | null;
  withPartner?: boolean | null;
}
```

`VoteParticipation` thêm:

```ts
export interface VoteParticipation {
  /** Số ĐẦU member chơi (gồm người đi cùng) — đây là head count, KHỚP divisor. */
  memberPlay: number;
  memberDine: number;
  /** Số người-đi-cùng chơi (Σ withPartner&&willPlay). */
  partnerPlay: number;
  partnerDine: number;
  guestPlay: number;
  guestDine: number;
  totalPlayers: number;
  totalDiners: number;
}
```

Thân hàm:

```ts
export function countVoteParticipation(
  votes: ReadonlyArray<ParticipationVote>,
): VoteParticipation {
  let memberPlay = 0;
  let memberDine = 0;
  let partnerPlay = 0;
  let partnerDine = 0;
  let guestPlay = 0;
  let guestDine = 0;
  for (const v of votes) {
    memberPlay += votePlayHeads(v); // 0|1|2 (gồm partner)
    memberDine += voteDineHeads(v);
    if (v.willPlay && v.withPartner) partnerPlay++;
    if (v.willDine && v.withPartner) partnerDine++;
    guestPlay += v.guestPlayCount ?? 0;
    guestDine += v.guestDineCount ?? 0;
  }
  return {
    memberPlay,
    memberDine,
    partnerPlay,
    partnerDine,
    guestPlay,
    guestDine,
    totalPlayers: memberPlay + guestPlay,
    totalDiners: memberDine + guestDine,
  };
}
```

> Lưu ý ngữ nghĩa: `memberPlay` giờ là HEAD count (gồm partner). Mọi caller (session-vote-optimistic-panel, week-sessions-view, session-card, admin-vote-manager, session-list, sessions.ts) đang dùng nó làm "playerCount" hiển thị + divisor → đúng ý (đếm cả người đi cùng).

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/vote-list-utils.test.ts`
Expected: PASS. Chạy lại `npx vitest run src/lib/` — toàn xanh.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vote-list-utils.ts src/lib/vote-list-utils.test.ts
git commit -F d:/tmp/msg.txt   # "feat(vote): countVoteParticipation counts partner heads"
```

---

## Task 5: Wire partner vào finalize (server) — `calculateSessionCosts` nhận headcount

**Files:**

- Modify: `src/lib/validators.ts` (`finalizeAttendeeSchema` ~line 84)
- Modify: `src/actions/finance.ts` (`FinalizeAttendee` ~line 35; attendeeInputs ~line 131; `sessionAttendees` insert ~line 264)

- [ ] **Step 1: Zod — headcount trong `finalizeAttendeeSchema`**

`src/lib/validators.ts`, sửa `finalizeAttendeeSchema`:

```ts
export const finalizeAttendeeSchema = z.object({
  memberId: z.number().int().positive().nullable(),
  guestName: z.string().max(100).nullable().optional(),
  invitedById: z.number().int().positive().nullable(),
  isGuest: z.boolean(),
  attendsPlay: z.boolean(),
  attendsDine: z.boolean(),
  /** Member "đi 2 người" → 2. Guest = 1. App-layer invariant (không có DB CHECK). */
  headcount: z.number().int().min(1).max(2).default(1),
});
```

- [ ] **Step 2: `FinalizeAttendee` type + map + insert**

`src/actions/finance.ts`:

- `FinalizeAttendee` (~line 35) thêm `headcount?: number;`.
- `attendeeInputs` map (~line 131) thêm `headcount: a.headcount ?? 1,`.
- `sessionAttendees` insert (~line 264) thêm `headcount: a.headcount ?? 1,` vào object values.

```ts
export interface FinalizeAttendee {
  memberId: number | null;
  guestName?: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
  headcount?: number;
}
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit` → PASS.
Run: `npx vitest run src/actions/` → PASS (test finalize cũ vẫn xanh, headcount default 1).

- [ ] **Step 4: Commit**

```bash
git add src/lib/validators.ts src/actions/finance.ts
git commit -F d:/tmp/msg.txt   # "feat(finance): finalize attendee carries headcount"
```

---

## Task 6: Apply migration 0015 lên prod (an toàn)

**Files:** (chạy script, không sửa code)

- [ ] **Step 1: Backup prod**

Run: `node scripts/backup-db.mjs "d:/tmp/fwbb-backup-before-0015.json"`
Expected: `✅ Đã backup ... rows`.

- [ ] **Step 2: Apply**

Run: `node scripts/apply-migration.mjs src/db/migrations/0015_partner_headcount.sql`
(Theo pattern script hiện có; nếu script nhận tham số khác, xem `scripts/apply-migration.mjs` đầu file.)
Expected: 3 ALTER chạy OK.

- [ ] **Step 3: Verify schema prod**

Dùng node + libsql (mẫu trong `scripts/cleanup-admin-placeholder-fbid.mjs`): chạy `PRAGMA table_info(members)`, `table_info(votes)`, `table_info(session_attendees)` và xác nhận có `default_with_partner`, `with_partner`, `headcount`. Verify mọi index cũ còn nguyên: `SELECT name FROM sqlite_master WHERE type='index'` (so với trước — ADD COLUMN không đụng index, nhưng kiểm cho chắc vì từng dính Turso DDL lag ở 0014).

- [ ] **Step 4: Reconcile fund (đảm bảo không vỡ tiền)**

Run: `node scripts/run-reconcile.mjs` (nếu có) — Expected: 0 lỗi.

- [ ] **Step 5: Build gate + push Phase 1**

Run: `npm run build` → exit 0.

```bash
git push origin main
```

---

# PHASE 2 — Vote UI toggle "Đi 2 người"

## Task 7: `optimistic-votes` + `submitVote` mang `withPartner`

**Files:**

- Modify: `src/lib/optimistic-votes.ts`
- Modify: `src/actions/votes.ts` (`submitVote` ~line 22)
- Modify: `src/lib/validators.ts` (`voteSchema` ~line 39)

- [ ] **Step 1: `voteSchema.withPartner`**

`src/lib/validators.ts`:

```ts
export const voteSchema = z.object({
  sessionId: z.number().int().positive(),
  willPlay: z.boolean(),
  willDine: z.boolean(),
  guestPlayCount: z.number().int().min(0).max(20).default(0),
  guestDineCount: z.number().int().min(0).max(20).default(0),
  withPartner: z.boolean().default(false),
});
```

- [ ] **Step 2: `VoteTotalsPatch` + `applyMemberVotePatch`**

`src/lib/optimistic-votes.ts`:

- `VoteTotalsPatch` thêm `withPartner: boolean;`.
- Trong `applyMemberVotePatch`, nhánh tạo row mới (object `satisfies VoteWithMember`) thêm `withPartner: patch.withPartner,` (đặt cạnh `guestDineCount`). Nhánh update (`...patch`) tự mang withPartner.

```ts
export type VoteTotalsPatch = {
  willPlay: boolean;
  willDine: boolean;
  guestPlayCount: number;
  guestDineCount: number;
  withPartner: boolean;
};
```

Trong object row mới:

```ts
      guestPlayCount: patch.guestPlayCount,
      guestDineCount: patch.guestDineCount,
      withPartner: patch.withPartner,
      createdAt: now,
```

- [ ] **Step 3: `submitVote` thêm tham số + ghi DB**

`src/actions/votes.ts`, `submitVote`:

- Signature thêm `withPartner: boolean` (cuối).
- `voteSchema.safeParse({ ..., withPartner })`.
- `.values({ ..., withPartner: data.withPartner })` và `.onConflictDoUpdate({ set: { ..., withPartner: data.withPartner, updatedAt: ... } })`.

```ts
export async function submitVote(
  sessionId: number,
  willPlay: boolean,
  willDine: boolean,
  guestPlayCount: number,
  guestDineCount: number,
  withPartner: boolean,
) {
  // ...
  const parsed = voteSchema.safeParse({
    sessionId,
    willPlay,
    willDine,
    guestPlayCount,
    guestDineCount,
    withPartner,
  });
  // ...
  await db
    .insert(votes)
    .values({
      sessionId: data.sessionId,
      memberId: user.memberId,
      willPlay: data.willPlay,
      willDine: data.willDine,
      guestPlayCount: data.guestPlayCount,
      guestDineCount: data.guestDineCount,
      withPartner: data.withPartner,
    })
    .onConflictDoUpdate({
      target: [votes.sessionId, votes.memberId],
      set: {
        willPlay: data.willPlay,
        willDine: data.willDine,
        guestPlayCount: data.guestPlayCount,
        guestDineCount: data.guestDineCount,
        withPartner: data.withPartner,
        updatedAt: new Date().toISOString(),
      },
    });
  // ...
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL ở `vote-buttons.tsx` (gọi submitVote thiếu arg) — sẽ sửa Task 8. Tạm xác nhận lỗi CHỈ ở caller submitVote.

- [ ] **Step 5: Commit** (cùng Task 8 để build xanh — hoặc commit riêng nếu chấp nhận tsc đỏ tạm thời). Khuyến nghị làm tiếp Task 8 rồi commit chung.

---

## Task 8: Toggle "Đi 2 người" trong `vote-buttons.tsx` + panel truyền default

**Files:**

- Modify: `src/components/sessions/vote-buttons.tsx`
- Modify: `src/components/sessions/session-vote-optimistic-panel.tsx`
- Modify: `src/actions/members.ts` (`getActiveMembers` trả `defaultWithPartner`)

- [ ] **Step 1: `getActiveMembers` trả `defaultWithPartner`**

`src/actions/members.ts`, `getActiveMembers`:

- Thêm `defaultWithPartner: true,` vào object `columns`.
- Bỏ override (KHÔNG set defaultWithPartner trong map scrub — giữ giá trị thật vì không phải PII). Map hiện spread `...m` nên giữ nguyên field; chỉ cần đảm bảo `columns` có nó.

```ts
    columns: {
      id: true,
      name: true,
      nickname: true,
      avatarKey: true,
      avatarUrl: true,
      isActive: true,
      createdAt: true,
      defaultWithPartner: true,
    },
```

- [ ] **Step 2: Panel tính `currentWithPartner` + truyền xuống**

`src/components/sessions/session-vote-optimistic-panel.tsx`, trong component, sau `myVote`:

```ts
const me = currentMemberId
  ? members.find((m) => m.id === currentMemberId)
  : undefined;
const currentWithPartner = myVote
  ? (myVote.withPartner ?? false)
  : (me?.defaultWithPartner ?? false);
```

Truyền vào `<VoteButtons ... currentWithPartner={currentWithPartner} />`.
`optimisticListSync.apply` patch type thêm `withPartner: boolean` (khớp `VoteTotalsPatch`).

- [ ] **Step 3: `vote-buttons.tsx` — state + toggle UI + truyền vào fireVote**

Thêm prop `currentWithPartner: boolean;` vào `VoteButtonsProps`. Thêm state:

```ts
const [withPartner, setWithPartner] = useState(currentWithPartner);
```

Thêm vào `useEffect` resync (cùng deps list): `setWithPartner(currentWithPartner);` + thêm `currentWithPartner` vào dependency array.

Sửa `fireVote` để mang withPartner vào cả optimistic patch và `submitVote`:

```ts
function fireVote(
  play: boolean,
  dine: boolean,
  guestPlay: number,
  guestDine: number,
  partner: boolean,
  rollback: () => void,
) {
  optimisticListSync?.apply({
    willPlay: play,
    willDine: dine,
    guestPlayCount: guestPlay,
    guestDineCount: guestDine,
    withPartner: partner,
  });
  fireAction(
    () => submitVote(sessionId, play, dine, guestPlay, guestDine, partner),
    () => {
      rollback();
      optimisticListSync?.revert();
    },
  );
}
```

Cập nhật MỌI call `fireVote(...)` hiện có (trong `togglePlay`, `toggleDine`, 2 `GuestStepper.onCommit`) thêm tham số `withPartner` ở vị trí thứ 5. Ví dụ trong `togglePlay`:

```ts
fireVote(true, willDine, guestPlayCount, guestDineCount, withPartner, () => {
  setWillPlay(prevPlay);
  setGuestPlayCount(prevGuestPlay);
});
```

(và nhánh `false`, và `toggleDine`, và 2 stepper.)

Thêm toggle UI ở đầu `return (<div className="space-y-3">`, TRƯỚC card Play. Handler:

```ts
function togglePartner() {
  const next = !withPartner;
  const prev = withPartner;
  setWithPartner(next);
  fireVote(willPlay, willDine, guestPlayCount, guestDineCount, next, () =>
    setWithPartner(prev),
  );
}
```

JSX (data-tour="vote-partner", touch ≥44px, mobile-first):

```tsx
<button
  type="button"
  data-tour="vote-partner"
  onClick={togglePartner}
  aria-pressed={withPartner}
  className={cn(
    "flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border-2 px-3.5 py-3 text-left transition-colors",
    withPartner
      ? "border-primary bg-primary/[0.07]"
      : "border-border/90 bg-background/80 hover:border-primary/45",
  )}
>
  <span className="flex items-center gap-2">
    <span className="text-xl leading-none" aria-hidden>
      👫
    </span>
    <span
      className={cn(
        "text-sm font-medium",
        withPartner ? "text-primary" : "text-muted-foreground",
      )}
    >
      {t("withPartner")}
    </span>
  </span>
  <span
    className={cn(
      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
      withPartner ? "bg-primary" : "bg-muted-foreground/30",
    )}
  >
    <span
      className={cn(
        "inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
        withPartner ? "translate-x-5" : "translate-x-0.5",
      )}
    />
  </span>
</button>
```

Thêm `data-tour="vote-play"` vào div card Play ngoài cùng (~line 225) và `data-tour="vote-guest"` vào wrapper GuestStepper Play (`<div ... data-guest-stepper>` ~line 287).

- [ ] **Step 4: i18n key `voting.withPartner`**

Thêm vào 3 file `src/i18n/messages/*.json`, namespace `voting`:

- vi: `"withPartner": "Đi 2 người"`
- en: `"withPartner": "Two people"`
- zh: `"withPartner": "两人同行"`

- [ ] **Step 5: Typecheck + i18n check + build**

Run: `npx tsc --noEmit` → PASS.
Run: `node scripts/check-i18n-keys.mjs` → PASS.
Run: `npm run build` → exit 0.

- [ ] **Step 6: Commit Phase 2**

```bash
git add src/lib/optimistic-votes.ts src/lib/validators.ts src/actions/votes.ts src/actions/members.ts src/components/sessions/vote-buttons.tsx src/components/sessions/session-vote-optimistic-panel.tsx src/i18n/messages/
git commit -F d:/tmp/msg.txt   # "feat(vote): 'đi 2 người' toggle wired through submitVote + live counts"
git push origin main
```

---

# PHASE 3 — Settings 3 nơi (signup / me / admin)

## Task 9: Signup checkbox

**Files:**

- Modify: `src/actions/password-auth.ts` (`signupWithPassword`)
- Modify: `src/app/(public)/password-auth-form.tsx`

- [ ] **Step 1: Action nhận `withPartner`**

`signupWithPassword` input thêm `withPartner?: boolean;`. Khi insert members thêm `defaultWithPartner: input.withPartner === true`.

- [ ] **Step 2: Form — state + checkbox (chỉ hiện ở mode signup)**

Thêm `const [withPartner, setWithPartner] = useState(false);`. Trong khối `mode === "signup"` (sau bank input), thêm checkbox styled:

```tsx
<label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={withPartner}
    onChange={(e) => setWithPartner(e.target.checked)}
    disabled={isPending}
    className="accent-primary h-5 w-5 rounded"
  />
  {t("signupWithPartner")}
</label>
```

Truyền `withPartner` vào `signupWithPassword({ ..., withPartner })`.

- [ ] **Step 3: i18n `passwordAuth.signupWithPartner`** (vi/en/zh)
- vi: `"signupWithPartner": "Tài khoản đi 2 người (vợ/chồng/bạn đi cùng)"`
- en: `"signupWithPartner": "Two-person account (partner comes along)"`
- zh: `"signupWithPartner": "两人账户（配偶/朋友同行）"`

- [ ] **Step 4: tsc + i18n + commit**

Run: `npx tsc --noEmit`; `node scripts/check-i18n-keys.mjs`.

```bash
git add src/actions/password-auth.ts src/app/(public)/password-auth-form.tsx src/i18n/messages/
git commit -F d:/tmp/msg.txt   # "feat(auth): signup can set default 'đi 2 người'"
```

---

## Task 10: Profile (/me) toggle

**Files:**

- Modify: `src/app/(public)/me/page.tsx` (truyền `defaultWithPartner` xuống client)
- Modify: `src/app/(public)/me/me-client.tsx`
- Modify: `src/actions/members.ts` (`updateMyProfile` đọc + set `defaultWithPartner`)

- [ ] **Step 1: `updateMyProfile` set field**

`src/actions/members.ts`, `updateMyProfile`: đọc `const withPartner = formData.get("withPartner") === "1";` và `.set({ nickname, defaultWithPartner: withPartner })`.

- [ ] **Step 2: page.tsx truyền prop**

`src/app/(public)/me/page.tsx`: query member đã có `defaultWithPartner` (full row). Truyền `defaultWithPartner={member.defaultWithPartner}` vào `<MeClient .../>`.

- [ ] **Step 3: me-client toggle**

`MeClientProps` thêm `defaultWithPartner: boolean;`. State:

```ts
const [withPartner, setWithPartner] = useState(defaultWithPartner);
const [prevWP, setPrevWP] = useState(defaultWithPartner);
if (defaultWithPartner !== prevWP) {
  setPrevWP(defaultWithPartner);
  setWithPartner(defaultWithPartner);
}
```

Trong `handleProfileSubmit`, set thêm vào FormData: `fd.set("withPartner", withPartner ? "1" : "0");`.
Thêm UI toggle trong form profile (dưới nickname), dùng cùng style switch như Task 8 (label `tMe("withPartnerLabel")`), `onChange`/`onClick` set `setWithPartner`.

- [ ] **Step 4: i18n `me.withPartnerLabel`** (vi/en/zh)
- vi: `"withPartnerLabel": "Đi 2 người (mặc định)"`
- en: `"withPartnerLabel": "Two people (default)"`
- zh: `"withPartnerLabel": "默认两人同行"`

- [ ] **Step 5: tsc + i18n + commit**

```bash
git add src/actions/members.ts "src/app/(public)/me/page.tsx" "src/app/(public)/me/me-client.tsx" src/i18n/messages/
git commit -F d:/tmp/msg.txt   # "feat(me): profile toggle for default 'đi 2 người'"
```

---

## Task 11: Admin set cho user (popup tạo + sửa nhanh)

**Files:**

- Modify: `src/actions/members.ts` (`createMember` + `updateMember` đọc `withPartner`)
- Modify: `src/app/(admin)/admin/members/member-list.tsx`

- [ ] **Step 1: Actions đọc field**

`createMember`: sau `nickname`, thêm `const defaultWithPartner = formData.get("withPartner") === "1";` và `.values({ ...parsed.data, nickname, defaultWithPartner })`.
`updateMember`: tương tự, `.set({ ...parsed.data, nickname, defaultWithPartner })`. (Lưu ý `updateMember` cũng được gọi từ chỗ sửa nickname nhanh — đảm bảo form sửa nhanh cũng gửi `withPartner` hoặc giữ giá trị cũ. An toàn: nếu formData KHÔNG có `withPartner` thì GIỮ NGUYÊN — đọc member cũ. Đơn giản hơn: chỉ set defaultWithPartner khi formData có key `withPartner`.)

```ts
// updateMember — chỉ đổi khi form có gửi (tránh nuke khi sửa nickname nhanh)
const set: Partial<typeof members.$inferInsert> = { ...parsed.data, nickname };
if (formData.has("withPartner")) {
  set.defaultWithPartner = formData.get("withPartner") === "1";
}
await db.update(members).set(set).where(eq(members.id, id));
```

- [ ] **Step 2: Popup tạo mới — thêm checkbox**

`member-list.tsx`, trong `<form action={handleCreate}>` (sau nickname input):

```tsx
<label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
  <input
    type="checkbox"
    name="withPartner"
    value="1"
    className="accent-primary h-5 w-5 rounded"
  />
  {t("memberWithPartner")}
</label>
```

- [ ] **Step 3: Sửa nhanh trên card — toggle "đi 2 người"**

Thêm 1 nút nhỏ trên card member (cạnh nút sửa nickname) gọi action mới gọn, hoặc tái dùng `updateMember` với FormData chứa `name`(cũ)+`withPartner`. Thêm handler:

```ts
function handleTogglePartner(m: Member) {
  const fd = new FormData();
  fd.set("name", m.name);
  fd.set("withPartner", m.defaultWithPartner ? "0" : "1");
  fireAction(() => updateMember(m.id, fd), undefined, {
    successMsg: tCommon("saved"),
  });
}
```

UI: badge/chip bấm được hiển trạng thái (👫 1 người / 2 người). Đặt cạnh chip "Đã vào quỹ".

- [ ] **Step 4: i18n `adminMembers.memberWithPartner` + label chip** (vi/en/zh)
- vi: `"memberWithPartner": "Đi 2 người"`, `"partnerOn": "2 người"`, `"partnerOff": "1 người"`
- en: `"memberWithPartner": "Two people"`, `"partnerOn": "2 people"`, `"partnerOff": "1 person"`
- zh: `"memberWithPartner": "两人同行"`, `"partnerOn": "两人"`, `"partnerOff": "一人"`

- [ ] **Step 5: tsc + i18n + build + commit Phase 3**

Run: `npx tsc --noEmit`; `node scripts/check-i18n-keys.mjs`; `npm run build`.

```bash
git add src/actions/members.ts "src/app/(admin)/admin/members/member-list.tsx" src/i18n/messages/
git commit -F d:/tmp/msg.txt   # "feat(admin): admin can set member's 'đi 2 người'"
git push origin main
```

---

# PHASE 4 — Finalize materialize headcount

## Task 12: Finalize UI — member row headcount 1↔2

**Files:**

- Modify: `src/components/sessions/finalize-session.tsx`

- [ ] **Step 1: Khởi tạo headcount từ vote.withPartner**

`Vote` type (line 41) đã là `InferSelectModel<votes> & {member}` → có `withPartner`. Thêm state map:

```ts
const [partnerIds, setPartnerIds] = useState<Set<number>>(
  () => new Set(votes.filter((v) => v.withPartner).map((v) => v.memberId)),
);
```

- [ ] **Step 2: Đưa headcount vào `attendeeList` (member rows)**

Trong `AttendeeEntry` thêm `headcount: number;`. Trong `useMemo` build member rows:

```ts
list.push({
  memberId,
  memberName: member?.name ?? `ID ${memberId}`,
  guestName: null,
  invitedById: null,
  isGuest: false,
  attendsPlay: playerIds.has(memberId),
  attendsDine: dinerIds.has(memberId),
  headcount: partnerIds.has(memberId) ? 2 : 1,
});
```

Guest rows: `headcount: 1`. Thêm `partnerIds` vào deps của useMemo.

- [ ] **Step 3: Truyền headcount vào preview + finalize payload**

`attendeeInputs` map (preview) thêm `headcount: a.headcount`.
`finalAttendees` map (`handleFinalize`) thêm `headcount: a.headcount`.

- [ ] **Step 4: UI toggle "đi 2 người" trong bước Players**

Trong list members ở step `players`, cạnh badge "đã vote", thêm 1 nút nhỏ chỉ hiện khi `playerIds.has(m.id)`:

```tsx
{
  playerIds.has(m.id) && (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        setPartnerIds((prev) => {
          const n = new Set(prev);
          n.has(m.id) ? n.delete(m.id) : n.add(m.id);
          return n;
        });
      }}
      className={`ml-auto rounded-full px-2 py-1 text-xs font-medium ${
        partnerIds.has(m.id)
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      }`}
    >
      👫 {partnerIds.has(m.id) ? t("twoPeople") : t("onePerson")}
    </button>
  );
}
```

(Nếu cả "đã vote" badge và nút này cùng `ml-auto` thì bọc trong 1 `<div className="ml-auto flex items-center gap-2">`.)

- [ ] **Step 5: i18n `finalize.twoPeople` / `finalize.onePerson`** (vi/en/zh)
- vi: `"twoPeople": "2 người"`, `"onePerson": "1 người"`
- en: `"twoPeople": "2 people"`, `"onePerson": "1 person"`
- zh: `"twoPeople": "两人"`, `"onePerson": "一人"`

- [ ] **Step 6: tsc + i18n + build + commit Phase 4**

Run: `npx tsc --noEmit`; `node scripts/check-i18n-keys.mjs`; `npm run build`.

```bash
git add "src/components/sessions/finalize-session.tsx" src/i18n/messages/
git commit -F d:/tmp/msg.txt   # "feat(finalize): admin sets member headcount (đi 2 người) at finalize"
git push origin main
```

> Sau Phase 4: test thủ công 1 buổi — member bật "đi 2 người" vote → finalize giữ headcount=2 → debt = 2 suất, ledger fund_deduction đúng. Chạy `node scripts/run-reconcile.mjs` → 0 lỗi.

---

# PHASE 5 — Product Tour (driver.js)

## Task 13: Cài driver.js + anchors

**Files:**

- Modify: `package.json`
- Modify: `src/components/finance/fund-balance-banner.tsx`, `src/components/finance/fund-topup-card.tsx`, `src/components/layout/bottom-nav.tsx`

- [ ] **Step 1: Cài**

Run: `npm i driver.js`
Expected: thêm vào dependencies. Run `npm run build` để chắc chắn bundle OK.

- [ ] **Step 2: Thêm data-tour anchors**

- `fund-balance-banner.tsx`: thêm `data-tour="fund-banner"` vào `wrapperClass` div ngoài cùng (cả nhánh Link và nhánh div).
- `fund-topup-card.tsx`: thêm `data-tour="fund-topup"` vào `<div className="space-y-3">` (body) ngoài cùng.
- `bottom-nav.tsx`: thêm `data-tour={item.href === "/my-fund" ? "nav-fund" : item.href === "/history" ? "nav-history" : undefined}` vào `<Link>`.
- (`vote-play`, `vote-partner`, `vote-guest` đã thêm ở Task 8.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/components/finance/ src/components/layout/bottom-nav.tsx
git commit -F d:/tmp/msg.txt   # "feat(tour): install driver.js + data-tour anchors"
```

---

## Task 14: Tour steps + hook + launcher + i18n

**Files:**

- Create: `src/components/tour/tour-steps.ts`, `src/components/tour/use-product-tour.ts`, `src/components/tour/product-tour-launcher.tsx`
- Modify: `src/app/(public)/layout.tsx`
- Modify: `src/i18n/messages/{vi,en,zh}.json` (namespace `tour`)

- [ ] **Step 1: i18n namespace `tour`** (vi/en/zh) — title/desc 6 bước + nút

vi:

```json
  "tour": {
    "open": "Hướng dẫn",
    "next": "Tiếp",
    "prev": "Trước",
    "done": "Xong",
    "skip": "Bỏ qua",
    "votePlayTitle": "Báo đi chơi / nhậu",
    "votePlayDesc": "Tick vào đây để báo bạn đi chơi cầu hoặc đi nhậu buổi này.",
    "votePartnerTitle": "Đi 2 người",
    "votePartnerDesc": "Đi cùng vợ/chồng/bạn? Bật để tính 2 suất cho bạn.",
    "voteGuestTitle": "Rủ thêm khách",
    "voteGuestDesc": "Bấm +/− để thêm khách. Bạn sẽ trả hộ phần của khách.",
    "fundBannerTitle": "Quỹ của bạn",
    "fundBannerDesc": "Số dư quỹ: âm là đang nợ, dương là còn dư.",
    "fundTopupTitle": "Nộp quỹ",
    "fundTopupDesc": "Hết/sắp hết quỹ thì bấm đây quét QR nộp — hệ thống tự xác nhận.",
    "navTitle": "Nợ & lịch sử",
    "navDesc": "Xem chi tiết nợ/quỹ và lịch sử các buổi ở đây."
  }
```

en (dịch tương ứng), zh (dịch tương ứng) — đảm bảo đủ KHỚP key vi.

- [ ] **Step 2: `tour-steps.ts`**

```ts
// src/components/tour/tour-steps.ts
import type { DriveStep } from "driver.js";

type T = (key: string) => string;

/** Trả về steps; lọc bỏ step không tìm thấy element ngay trước khi chạy (ở hook). */
export function buildTourSteps(t: T): DriveStep[] {
  return [
    {
      element: '[data-tour="vote-play"]',
      popover: { title: t("votePlayTitle"), description: t("votePlayDesc") },
    },
    {
      element: '[data-tour="vote-partner"]',
      popover: {
        title: t("votePartnerTitle"),
        description: t("votePartnerDesc"),
      },
    },
    {
      element: '[data-tour="vote-guest"]',
      popover: { title: t("voteGuestTitle"), description: t("voteGuestDesc") },
    },
    {
      element: '[data-tour="fund-banner"]',
      popover: {
        title: t("fundBannerTitle"),
        description: t("fundBannerDesc"),
      },
    },
    {
      element: '[data-tour="fund-topup"]',
      popover: { title: t("fundTopupTitle"), description: t("fundTopupDesc") },
    },
    {
      element: '[data-tour="nav-fund"]',
      popover: { title: t("navTitle"), description: t("navDesc") },
    },
  ];
}
```

- [ ] **Step 3: `use-product-tour.ts`**

```ts
// src/components/tour/use-product-tour.ts
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { buildTourSteps } from "./tour-steps";

const DONE_KEY = "fwbb-tour-done";

export function useProductTour() {
  const t = useTranslations("tour");

  const run = useCallback(() => {
    const all = buildTourSteps((k) => t(k));
    // Chỉ giữ step có element tồn tại trên trang hiện tại (tránh popover trỏ hư không).
    const steps = all.filter(
      (s) =>
        typeof s.element === "string" &&
        document.querySelector(s.element) !== null,
    );
    if (steps.length === 0) return;
    const d = driver({
      showProgress: true,
      nextBtnText: t("next"),
      prevBtnText: t("prev"),
      doneBtnText: t("done"),
      steps,
      onDestroyed: () => {
        try {
          localStorage.setItem(DONE_KEY, "1");
        } catch {}
      },
    });
    d.drive();
  }, [t]);

  const hasSeen = useCallback(() => {
    try {
      return localStorage.getItem(DONE_KEY) === "1";
    } catch {
      return true; // localStorage chặn → coi như đã xem, không auto.
    }
  }, []);

  return { run, hasSeen };
}
```

- [ ] **Step 4: `product-tour-launcher.tsx`**

```tsx
// src/components/tour/product-tour-launcher.tsx
"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Compass } from "lucide-react";
import { useProductTour } from "./use-product-tour";

export function ProductTourLauncher() {
  const { run, hasSeen } = useProductTour();
  const t = useTranslations("tour");
  const autoRan = useRef(false);

  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (!hasSeen()) {
      // Đợi DOM (vote panel, banner) mount xong rồi mới chạy.
      const id = setTimeout(() => run(), 800);
      return () => clearTimeout(id);
    }
  }, [hasSeen, run]);

  return (
    <button
      type="button"
      onClick={run}
      aria-label={t("open")}
      className="bg-primary text-primary-foreground fixed right-4 bottom-24 z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 sm:bottom-6"
    >
      <Compass className="h-5 w-5" />
    </button>
  );
}
```

> `bottom-24` để nằm trên BottomNav (h-16) + sticky vote bar; `z-30` thấp hơn nav (`z-40`) và sheet/overlay.

- [ ] **Step 5: Mount trong `(public)/layout.tsx`**

Trong nhánh cuối (member approved → render app, `return (<div ...><Header/><main>{children}</main><BottomNav/></div>)`), thêm `<ProductTourLauncher />` trước `</div>`. Import ở đầu file. KHÔNG mount ở nhánh `!user` / pending / disabled.

- [ ] **Step 6: tsc + i18n + build**

Run: `npx tsc --noEmit` → PASS.
Run: `node scripts/check-i18n-keys.mjs` → PASS (nếu script không quét `tour` namespace động thì bỏ qua; vẫn đảm bảo 3 file cùng key).
Run: `npm run build` → exit 0.

- [ ] **Step 7: Test thủ công**

`npm run dev` → mở `/` với acc approved + có buổi vote: tour tự chạy lần đầu (xoá `localStorage.fwbb-tour-done` để test lại), spotlight đúng 6 anchor, skip/done set cờ; bấm nút 🧭 chạy lại. Test ở màn login → KHÔNG có nút tour.

- [ ] **Step 8: Commit Phase 5**

```bash
git add src/components/tour/ "src/app/(public)/layout.tsx" src/i18n/messages/
git commit -F d:/tmp/msg.txt   # "feat(tour): product tour (driver.js) — auto first-visit + re-open launcher"
git push origin main
```

---

## Self-review notes (đã kiểm)

- **Spec coverage:** A1 cột→Task2; A2 vote UI→Task8; A3 cost/forecast/live/finalize→Task3,4,5,12; A4 settings→Task9,10,11; A5 partner-core→Task1; B1-B3 tour→Task13,14. ✓
- **Type consistency:** `votePlayHeads/voteDineHeads/resolveVoteWithPartner` (Task1) dùng nhất quán ở Task4; `AttendeeInput.headcount` (Task3) ↔ `FinalizeAttendee.headcount` (Task5) ↔ `finalizeAttendeeSchema.headcount` (Task5) ↔ finalize UI `headcount` (Task12); `VoteTotalsPatch.withPartner` (Task7) ↔ panel patch (Task8) ↔ `submitVote(...withPartner)` (Task7). ✓
- **Headcount invariant:** app-layer (zod min(1).max(2)), KHÔNG DB CHECK → migration ADD COLUMN thuần (Turso-safe). ✓
- **Không hồi tố:** vote/attendee cũ default (with_partner=0, headcount=1) → tiền buổi cũ không đổi. ✓
