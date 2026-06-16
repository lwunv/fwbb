# Design — Acc "đi 2 người" (partner headcount) + Product Tour

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → pending implementation plan
**Author:** Claude (Opus 4.8) + lwunv

## Quyết định đã chốt (từ brainstorming)

| Vấn đề                  | Lựa chọn                                                                    |
| ----------------------- | --------------------------------------------------------------------------- |
| Tour engine             | **driver.js** (cài mới, ~5KB)                                               |
| Mô hình headcount       | **Field riêng** (`withPartner`), độc lập "Khách"                            |
| Switch trên vote        | **1 toggle chung** — người thứ 2 chơi nếu member chơi, nhậu nếu member nhậu |
| Lưu "đã xem tour"       | **localStorage** (per-device)                                               |
| Sàn 60K cho người thứ 2 | **Member-floor** — coi là một phần của member (acc đủ quỹ → không phạt)     |

---

## Feature A — Acc "đi 2 người" (partner / headcount)

### A1. Data model (migration `0015`)

3 cột mới:

- **`members.default_with_partner`** — `integer boolean NOT NULL DEFAULT false`. Setting của acc: mặc định mỗi buổi đi 1 hay 2 người.
- **`votes.with_partner`** — `integer boolean NOT NULL DEFAULT false`. **Snapshot** lúc submit: vote này đi mấy người. UI mở vote → default = `members.default_with_partner`; submit ghi giá trị thật. Đổi setting acc về sau **không** hồi tố vote cũ.
- **`session_attendees.headcount`** — `integer NOT NULL DEFAULT 1`. Số đầu người mà attendee này đại diện ở phần CHƠI/NHẬU của chính họ. Member đi 2 người → row của member có `headcount = 2`. Guest luôn `headcount = 1`.

Backfill: tất cả row cũ lấy default (`with_partner=false`, `headcount=1`, `default_with_partner=false`) — không đổi tiền buổi cũ.

CHECK constraint: `headcount IN (1, 2)` (hiện tại tối đa 2; mở rộng sau nếu cần >2).

### A2. Vote UI (`src/components/sessions/vote-buttons.tsx`)

- Thêm toggle **"Đi 2 người 👫"** ở đầu card vote (trên Chơi/Nhậu). Style switch, touch target ≥ 44px, mobile-first.
- 1 switch chung: bật → người thứ 2 **chơi nếu member chơi, nhậu nếu member nhậu**. Không có người thứ 2 riêng cho từng mục.
- Default state = `members.defaultWithPartner` (truyền xuống prop `currentWithPartner`).
- Ô **"Khách"** giữ nguyên & độc lập: acc 2 người vẫn rủ thêm khách (partner=1 + khách=N).
- Optimistic: `useEffect`-sync khi prop đổi (đúng project rule); rollback + toast khi API lỗi (qua `fireAction`).
- `submitVote(sessionId, play, dine, guestPlay, guestDine, withPartner)` — thêm tham số. `voteSchema` thêm `withPartner: z.boolean().default(false)`. Server recompute, validate, không tin client.

### A3. Tiền — `cost-calculator.ts` (CRITICAL)

Người thứ 2 = **1 đầu người member tự trả**, gộp vào phần chơi/nhậu của CHÍNH member (KHÔNG vào `guestPlayAmount`/`guestDineAmount`).

**Cơ chế = `session_attendees.headcount`** (không tạo row guest giả):

- `calculateSessionCosts`:
  - `totalPlayers = Σ headcount` trên attendee có `attendsPlay` (guest headcount=1, member headcount=1 hoặc 2).
  - `totalDiners = Σ headcount` trên attendee có `attendsDine`.
  - Member: `playAmount = memberPlays ? playCostPerHead × memberHeadcount : 0`; `dineAmount = memberDines ? dineCostPerHead × memberHeadcount : 0`. `memberHeadcount` = headcount của row member (không phải guest).
  - Guest amounts không đổi (vẫn theo `invitedById`).
- `roundToThousand` (round UP) giữ nguyên ở per-head; nhân headcount sau khi đã round per-head → admin không lỗ.
- **Min-deduction floor (`applyMinDeductionFloor`) KHÔNG cần đổi**: vì partner gộp trong `playAmount` của member, floor member-side áp trên TỔNG `playAmount` (= perHead × headcount). Acc đủ quỹ → không phạt; broke + tổng < 60K → nâng cả cặp lên 60K (member-floor, đúng lựa chọn đã chốt). Guest-floor (`guestPlayCount`) không liên quan partner.

**Forecast** (`computePredictedMinDeductionSurplus`, dùng ở UI "Tổng thu dự kiến"): hiện giả định 1 đầu/member. Member đi 2 người → playAmount = 2×perHead, floor member-side chỉ fire khi `2×perHead < 60K` + balance thiếu. Cần truyền headcount/withPartner vào forecast để khớp debt thật (nếu không, 2 màn admin lệch nhau như bug đã từng gặp). Thêm vào cùng đợt sửa cost-calculator.

**Live counts (vote phase, chưa có attendees)** — `countVoteParticipation` (`vote-list-utils.ts`):

- Member `willPlay` + `withPartner` → +2 vào `totalPlayers` (memberPlay tính 2); `willDine` + `withPartner` → +2 `totalDiners`.
- Tách field rõ: thêm `partnerPlay`/`partnerDine` (số partner) để hiển nếu cần. `totalPlayers`/`totalDiners` luôn khớp `calculateSessionCosts`.

**Finalize** (`finalize-session.tsx` + `finance.ts`):

- Dựng attendee list từ votes: member có `vote.withPartner=true` → row member `headcount = 2` (mặc định), admin chỉnh xuống 1 được (partner không đến).
- Finalize UI: trên row member, hiện toggle/badge "đi 2 người" cho phép admin sửa headcount 1↔2.

### A4. Nơi set "đi 2 người"

1. **Đăng ký** (`password-auth-form.tsx` + `signupWithPassword`): checkbox "Tài khoản đi 2 người (vợ/chồng/bạn đi cùng)" → set `defaultWithPartner`. OAuth signup mặc định false (chỉnh sau ở /me).
2. **Trang cá nhân `/me`** (`me-client.tsx` + `updateMyProfile`): toggle, lưu `defaultWithPartner`. Thêm field vào action (đã có rate-limit).
3. **Admin** (`member-list.tsx` + `createMember`/`updateMember`): checkbox trong popup tạo mới + sửa nhanh trên card member (cạnh sửa nickname).

Đổi setting acc → chỉ ảnh hưởng vote MỚI (vote cũ đã snapshot).

### A5. Common tách ra

`src/lib/partner-core.ts` (pure, không "use client", import được từ Server Component):

- `resolveVotePartner(vote, memberDefault): boolean` — chốt giá trị partner cho 1 vote.
- `playHeads(vote)` / `dineHeads(vote)` — số đầu chơi/nhậu của 1 member-vote (1 hoặc 2).
- Dùng chung bởi `countVoteParticipation`, finalize builder, client preview. Không lặp logic trong component.

---

## Feature B — Product Tour (driver.js)

### B1. Cơ chế

- Cài `driver.js`. Code trong `src/components/tour/`:
  - `tour-steps.ts` — config steps (i18n-driven, anchor bằng `data-tour`).
  - `use-product-tour.ts` — hook khởi tạo driver, chạy/skip, set localStorage.
  - `product-tour-launcher.tsx` — nút **fixed góc dưới phải** (icon 🧭), z-index thấp hơn sticky vote bar để không đè; render trong `(public)/layout.tsx` (chỉ khi user approved).
- **Auto lần đầu**: `localStorage["fwbb-tour-done"]` chưa set → tự chạy sau khi home mount, CHỈ khi user đã đăng nhập + `approved` (không chạy ở màn login / pending-approval). Xong/skip → set cờ.
- **Mở lại**: bấm icon fixed → chạy lại bất cứ lúc nào (không phụ thuộc cờ).
- Mỗi step: spotlight overlay + popover mô tả + auto-scroll/focus vào element. driver.js lo reposition khi scroll/resize.

### B2. Steps (6 bước, đã confirm)

Anchor `data-tour` gắn element thật:

1. `vote-play` — card Chơi/Nhậu: "Tick để báo bạn đi chơi / nhậu buổi này."
2. `vote-partner` — toggle "Đi 2 người": "Đi cùng vợ/chồng/bạn? Bật để tính 2 suất."
3. `vote-guest` — guest stepper: "Rủ thêm khách? +/− số khách, bạn trả hộ phần khách."
4. `fund-banner` — `FundBalanceBanner`: "Số dư quỹ: âm = đang nợ, dương = còn dư."
5. `fund-topup` — `FundTopUpCard` / nút mở QR: "Hết/sắp hết quỹ thì bấm đây quét QR nộp, hệ thống tự xác nhận."
6. `nav-fund` + `nav-history` — bottom nav: "Xem chi tiết nợ/quỹ và lịch sử các buổi ở đây."

Lưu ý: vài anchor (vote-\*, fund-topup) chỉ tồn tại khi có buổi đang vote / khi banner expand. Tour phải **skip gracefully** step nào không tìm thấy element (driver.js: lọc steps theo `document.querySelector` trước khi chạy), tránh popover trỏ vào hư không.

### B3. i18n

- Namespace mới **`tour`** (title/desc 6 bước + nút "Tiếp/Trước/Xong/Bỏ qua") cho **vi/en/zh**.
- Bổ sung key cho switch "Đi 2 người" + setting (vào `voting`, `me`, `adminMembers`).
- `check-i18n-keys.mjs` phải pass.

---

## Testing (TDD — red→green trước khi code thật)

- **`partner-core`**: `resolveVotePartner`, `playHeads`/`dineHeads` (vote không chơi nhưng bật partner → 0 head; chơi + partner → 2).
- **`cost-calculator`** (financial core): member đi 2 người đủ quỹ / thiếu quỹ; partner + guest cùng lúc; member-floor áp trên tổng playAmount; divisor `totalPlayers` đúng. Khớp `roundToThousand`.
- **`countVoteParticipation`**: divisor khớp `calculateSessionCosts` khi có partner.
- **Migration 0015**: cột + default + CHECK + backfill (vote/attendee cũ không đổi tiền).
- Existing financial integration tests phải vẫn xanh (regression guard cho money).

## Rollout (mỗi bước build + push xanh trước khi sang bước kế)

1. **Financial core**: migration 0015 + `partner-core` + `cost-calculator` + `countVoteParticipation` + tests.
2. **Vote UI**: toggle "Đi 2 người" + `submitVote`/`voteSchema` + live counts.
3. **Settings 3 nơi**: signup + /me + admin (popup tạo/sửa) + i18n.
4. **Finalize**: materialize headcount + finalize UI toggle.
5. **Product tour**: driver.js + steps + launcher + i18n (độc lập, sau cùng).

## Non-goals (YAGNI)

- Headcount > 2 (chỉ 1 hoặc 2; CHECK chặn).
- Partner riêng cho chơi vs nhậu (1 switch chung).
- Tour theo server/DB (chỉ localStorage).
- Hồi tố vote/buổi cũ theo setting mới.
- Tour multi-page có điều hướng tự động (chỉ tour element trên trang hiện tại; chủ yếu home).
