# Logic database của FWBB

Tài liệu tham chiếu về tầng dữ liệu: các bảng, mô hình tiền, cách tính tiền một
buổi, vòng đời buổi chơi, và tồn kho cầu. Viết cho người sẽ sửa code đụng tới
database.

Nguồn sự thật là code, không phải tài liệu này. Mọi mục dưới đây trỏ tới file và
hàm thật. Khi code đổi mà quên sửa đây, tin code. Soạn lần đầu 03/11/2026, đọc
trực tiếp từ `src/db/schema.ts` (23 bảng, 29 migration tới `0028`), `src/lib/`
và `src/actions/`.

Những thứ KHÔNG nằm ở đây, để tránh chép lại:

- Quy tắc bắt buộc khi viết code tiền và kho: [AGENTS.md](../AGENTS.md).
- Sao lưu, khôi phục, bản dự phòng, tự chuyển: [backup-restore.md](./backup-restore.md).
- Ai được đọc/ghi endpoint nào: [SECURITY-API-CHECKLIST.md](./SECURITY-API-CHECKLIST.md).
- Đăng nhập Facebook/Messenger: [fb-integration-guide.md](./fb-integration-guide.md).

---

## 1. Toàn cảnh

FWBB chạy trên SQLite (Turso/libsql) qua Drizzle ORM. Schema khai ở
`src/db/schema.ts`. Dữ liệu chia bốn cụm:

1. **Danh tính**: `members` (người) + `admins` (tài khoản vận hành) +
   `member_oauth_identities` / `password_reset_tokens` cho nhiều kiểu đăng nhập.
2. **Vòng đời buổi chơi**: `sessions` → `votes` (ý định) → `session_attendees`
   (ai thật sự tới, một dòng mỗi đầu người) → `session_shuttlecocks` (cầu đã
   dùng) → `session_debts` (mỗi người nợ gì cho buổi đó).
3. **Tiền**: một bảng sổ cái append-only duy nhất, `financial_transactions`.
   Mọi "số dư" trong app đều dựng lại từ bảng này, **không có cột số dư lưu sẵn
   ở đâu cả**. `payment_notifications` bơm dữ liệu vào từ email ngân hàng.
4. **Kho**: `shuttlecock_brands` + `inventory_purchases`. Tồn kho cũng luôn tính
   lại từ nguồn, không cache.

Bảng phụ: `app_settings` (cấu hình key/value), `venues` (danh bạ sân công khai),
`courts` (sân nhóm tự thuê), `rate_limit_buckets`, `dup_ignored_pairs`,
`session_min_deduction_exemptions`.

### Quy ước xuyên suốt: enum nằm ở tầng app, không phải CHECK

Gần như mọi ràng buộc kiểu (status, gender, provider...) chỉ được bảo vệ bằng
Drizzle TS enum + Zod ở tầng ứng dụng, **không có CHECK constraint** trong DB. Lý
do viết thẳng trong `schema.ts`: một CHECK khiến drizzle-kit sinh migration
recreate-table, mà recreate-table trên Turso đã từng **âm thầm làm rụng index**.

Vài bảng là ngoại lệ có CHECK thật (thêm trong các migration recreate-table 0014
và 0026): `inventory_purchases`, `session_shuttlecocks`, `financial_transactions`,
`venues`. Còn lại giữ ràng buộc trong Zod.

### Kết nối và failover

`src/db/index.ts` bọc client libsql bằng một failover client
(`src/db/failover.ts`), tự chuyển sang database dự phòng khi database chính chết
và **không bao giờ tự chuyển ngược**. Chi tiết ở
[backup-restore.md](./backup-restore.md). Một điểm cần biết khi làm việc với DB:

- **Foreign key chỉ được cưỡng chế khi connection bật `PRAGMA foreign_keys=ON`.**
  `src/db/index.ts` chỉ chạy PRAGMA đó cho URL dạng `file:` (local và E2E). Với
  Turso remote nó cố ý KHÔNG chạy câu lệnh mạng nào lúc nạp module, vì một lần
  reset connection giữa lúc init sẽ làm hỏng module cho mọi request sau (đã xảy
  ra 07/10/2026). Hệ quả: trên prod, `onDelete` của Drizzle **không tự kích
  hoạt**, code phải tự NULL/xoá các tham chiếu trước khi xoá (xem
  `finalizeSession`, `deleteSession`).

---

## 2. Các bảng

### Danh tính

**`members`** — mọi người trong nhóm, đồng thời là dòng danh tính để đăng nhập.

- `is_active` (boolean, default true) là cờ **vô hiệu hoá mềm**. Member không bị
  xoá cứng; xoá cứng bị chặn cố ý khi member đã có lịch sử tiền. Đừng nới.
- Roster quỹ là **suy ra**, không lưu: `is_active = true AND approval_status =
'approved'` (`src/lib/fund-calculator.ts`). Bảng `fund_members` cũ đã DROP ở
  migration 0013.
- `gender` ('male' | 'female' | 'lgbt', nullable) chỉ được đọc cho tiền KHI bật
  setting `genderPricingEnabled`, và bộ tính tiền chỉ hỏi đúng một câu `gender
=== "female"`. NULL và 'lgbt' đều rơi vào nhóm không-nữ, trả đủ phần. Cố ý,
  không phải bug.
- `skill_level` ('tapChoi'|'yeu'|'tby'|'tb'|'tbk', nullable) **chỉ để hiển thị**.
  Không chỗ nào trong tính tiền, ghép cặp hay chia đội đọc nó.
- `default_with_partner` là DEFAULT của UI, được chụp vào `votes.with_partner`
  lúc vote. Đổi default KHÔNG hồi tố vào vote đã có.
- `password_reset_expires_at`: khi có và còn hạn, `password_hash` hiện tại là mật
  khẩu tạm do admin cấp.
- `approved_by` là integer trần giữ `admin.id`, **không có FK**. NULL = dòng cũ
  duyệt trước khi có tính năng.
- `phone_number` cố ý **không unique** (lịch sử có thể có 2 người chung số); đăng
  nhập bằng số chỉ chấp nhận khi khớp đúng một dòng.

**`admins`** — tài khoản vận hành, auth tách khỏi members.

- `member_id` (nullable FK → members, SET NULL) trỏ tới dòng member của chính
  admin. Thay cho quy ước cũ dễ vỡ là so `members.name === admins.username`.
  **Đừng tái lập so-theo-tên.** Nullable cố ý: admin chưa gắn member vẫn đăng
  nhập được vì auth là username/password.
- SSO của admin tra thẳng `admins.google_id`, KHÔNG đi qua
  `member_oauth_identities`, và cố ý không khớp theo email.

**`member_oauth_identities`** — cho nhiều tài khoản ngoài (nhiều Google + FB)
cùng trỏ vào MỘT member. Index `oauth_provider_uid_unique(provider,
provider_uid)` là **chốt chặn chiếm tài khoản**: một tài khoản ngoài gắn được tối
đa một member.

**`password_reset_tokens`** — token quên mật khẩu dùng một lần, chung cho member
và admin. Đúng một trong `member_id`/`admin_id` được set, nhưng ràng buộc đó
**chỉ ở tầng app**, không có CHECK.

### Buổi chơi

**`sessions`** — một buổi (một tối), bản ghi trung tâm.

- `status`: 'voting' | 'confirmed' | 'completed' | 'cancelled' (default
  'voting'). Xem phần 5.
- `court_price` (integer VND, nullable tới khi chọn sân). `court_price_overridden`
  = true nghĩa admin đã đặt giá tay, đừng tính lại đè.
- `vote_deadline` (TEXT `YYYY-MM-DDTHH:MM:SS`, KHÔNG có `Z`), hiểu là giờ treo
  tường Việt Nam. Xem phần 5.
- `use_min_deduction` (default true), `settings_override` (JSON từng phần),
  `settings_snapshot` (đóng băng cấu hình lúc chốt sổ lần đầu). Xem phần 4.
- `admin_guest_play_count` / `admin_guest_dine_count` (+ `*_female_count`): khách
  của chính admin, nằm trên dòng session chứ không trên `votes`.
- `pass_revenue`: tiền pass sân khi huỷ buổi.

**`votes`** — ý định của một member cho một buổi. Unique
`votes_session_member_idx(session_id, member_id)`, mọi đường ghi là upsert.
Khách do member khai đã CHẾT (từ 07/07/2026 chỉ admin thêm khách); các cột
`guest_*_count` trên votes do admin set.

**`session_attendees`** — ai thật sự dự, **bung một dòng mỗi đầu người** (member
hoặc khách). Đây là thứ bộ tính tiền đọc.

- `headcount` (default 1, bất biến ∈ {1,2} giữ ở tầng app).
- `gender` được **chụp** vào đây lúc chốt sổ; bộ tính tiền đọc lại từ dòng
  attendee, KHÔNG từ `members.gender`. Để member đổi gender không làm đổi tiền
  buổi đã đóng.
- `member_id` và `invited_by_id` đều SET NULL; `session_id` CASCADE.
- **KHÔNG có unique index** trên (session_id, member_id): về vật lý có thể có
  dòng attendee trùng. Chỉ `finalizeSession` ghi bảng này (ngoài seed và merge
  member). Không có tính năng check-in dù AGENTS.md có nhắc.

**`session_shuttlecocks`** — cầu đã dùng và giá, nuôi cả tiền lẫn tồn kho.

- `price_per_tube` là **ảnh chụp** giá brand lúc gắn vào buổi, NOT NULL.
  `addSessionShuttlecocks` từ chối ghi đè giá của dòng (sessionId, brandId) đã
  có, nên đổi giá brand sau này không hồi tố. Đổi tay qua
  `setSessionShuttlecockPriceOverride` (null = chụp lại giá hiện tại).

**`session_debts`** — mỗi người nợ gì cho một buổi, tách play/dine/khách. Unique
(session_id, member_id). **Đây là bản ghi kiểm toán, KHÔNG phải "ai còn nợ".** Xem
phần 3.

**`session_min_deduction_exemptions`** — đánh dấu member được miễn sàn trừ tối
thiểu cho một buổi cụ thể. Khoá kép (session_id, member_id), không có PRIMARY KEY
khai báo.

### Tiền

**`financial_transactions`** — sổ cái tiền append-only DUY NHẤT. Xem phần 3. Có
CHECK `amount >= 0`. Đường ghi vào bảng này trong code production chỉ có một:
`recordFinancialTransaction` (`src/lib/financial-ledger.ts`).

**`payment_notifications`** — email chuyển khoản nạp qua Gmail Pub/Sub, kèm trạng
thái đã khớp debt/ledger chưa. `gmail_message_id` unique để chống webhook trùng.

### Kho và cấu hình

**`shuttlecock_brands`** — brand cầu + giá hiện tại + `stock_adjust_qua` (delta
sửa tay). KHÔNG có cột tồn kho. Xem phần 6.

**`inventory_purchases`** — nhật ký mua cầu, vế nguồn của công thức tồn kho. CHECK
`tubes >= 1`, giá không âm.

**`courts`** — sân nhóm tự thuê, giá riêng. `price_per_session_retail` nullable
(fallback về `price_per_session`). `venue_id` (thêm ở 0026) trỏ `venues`.

**`venues`** — danh bạ sân công khai ("giao lưu quanh đây"), gồm cả sân member gửi
lên. `status` 'pending'|'approved'|'hidden', `amenities` JSON.

**`app_settings`** — cấu hình key/value toàn app. Registry ở
`src/lib/settings-registry.ts`.

**`rate_limit_buckets`** — rate limit lưu DB, thay cho Map in-memory (per-instance
serverless, dễ bị khuếch đại).

**`dup_ignored_pairs`** — ghi nhớ các cặp member trùng tên mà admin đã xác nhận
là hai người khác nhau, để banner "nghi trùng" thôi nhắc.

### Thông báo

Thêm ở migration 0028, chỉ DDL. Công tắc `notificationsEnabled` (trong
`app_settings`, mặc định tắt) chặn mọi ghi vào bốn bảng này. Hướng dẫn cấu hình
email và hẹn giờ: [notifications-setup.md](./notifications-setup.md).

**`notifications`**: một dòng cho mỗi tin của một người nhận.
`recipient_type` 'member'|'admin' cùng `recipient_id` (không có FK vì trỏ hai
bảng). `kind` là mã tin, `entity_type`/`entity_id` trỏ buổi, member, giao dịch,
sân, brand hoặc tháng. `payload` JSON chỉ chứa dữ liệu của chính người nhận.
`mandatory` đánh dấu tin không tắt được, `read_at` rỗng là chưa đọc.
`dedup_key` UNIQUE để chống ghi trùng khi sự kiện chạy lại. Mọi thời điểm là ISO
UTC do app ghi. Tin được ghi trong cùng transaction với nghiệp vụ.

**`notification_deliveries`**: hàng đợi gửi email, tối đa một dòng cho mỗi cặp
(tin, kênh) nhờ unique `(notification_id, channel)`. `channel` hiện chỉ có
'email'. `status` 'pending'|'sent'|'failed'|'skipped', `attempts`,
`next_attempt_at` (mốc thử lại), `error_code`. Xoá tin thì xoá theo (CASCADE).

**`notification_prefs`**: tuỳ chọn của từng người nhận, unique
`(recipient_type, recipient_id)`. `muted_groups` là JSON danh sách nhóm đã tắt
(nhóm có tin bắt buộc không tắt được), `email_enabled` mặc định bật,
`unsub_token` là 32 byte ngẫu nhiên base64url (unique) dùng cho link huỷ nhận
email, tạo khi gửi mail tuỳ chọn đầu tiên.

**`scheduled_jobs`**: các việc hẹn giờ (nhắc hạn vote, nhắc trong ngày, thử lại
email, chỗ giữ cho tóm tắt ngày). `job_key` định danh việc, `run_at` mốc chạy,
`status` 'scheduled'|'done'|'skipped'|'cancelled'|'failed', `message_id` là mã
message bên QStash, `session_id` buổi liên quan. Cron 06:00 nhặt việc quá giờ mà
còn `scheduled` (QStash bị lỡ) và chạy bù.

Hai cột thêm vào bảng cũ:

- **`admins.role`**: mặc định 'superadmin', hiện chỉ có giá trị đó. Admin có
  `role = 'superadmin'` là người nhận tin của admin. Không liên quan claim
  `role: "admin"` trong JWT.
- **`members.notify_email_verified_for`**: email (chữ thường) đã bấm link xác
  minh. Member chỉ được gửi mail thông báo khi giá trị này bằng `lower(email)`
  hiện tại, nên đổi email là tự mất xác minh, không cần sửa từng đường đổi.

### Bảng đã bỏ / bảng của bản dự phòng

- **`fund_members`**: DROP ở migration 0013. Roster quỹ giờ suy ra. Gì còn tham
  chiếu bảng này là lỗi thời.
- **`replica_state` / `replica_sync`**: chỉ nằm trên database dự phòng, KHÔNG có
  trong `schema.ts`, tạo bằng SQL thô lúc chạy. Mọi script sao lưu lọc bỏ hai
  bảng này theo tên, nên khôi phục không bao giờ kéo về một cờ failover cũ.

---

## 3. Mô hình tiền (gộp Quỹ + Nợ)

**Không có bảng "quỹ" riêng, không có số "nợ" riêng.** Mỗi member có đúng MỘT số,
suy ra (không lưu) từ sổ cái `financial_transactions`:

```
balance = Σ(fund_contribution) − Σ(fund_deduction) − Σ(fund_refund)
```

Tính bởi `computeBalanceFromTransactions` (`src/lib/fund-core.ts`, bản bulk
`computeBalancesForMembers`). Balance âm = đang nợ; dương = còn quỹ; 0 = đã cân.
`getFundStatus` chia thành "owing" | "depleted" | "lowFund" | "hasFund"
(ngưỡng 100.000).

Mấy nguyên tắc load-bearing, phá là sai số dư thật:

1. **Chỉ ba type `fund_*` làm đổi balance.** `bank_payment_received`, các
   `debt_*`, `session_guest_income`, `inventory_purchase`, `court_rent_payment`
   là kiểm toán hoặc tiền nhóm, công thức balance bỏ qua. Mỗi
   `bank_payment_received` BẮT BUỘC ghi kèm một `fund_contribution` cặp (key
   `bank-payment-balance-*`), quên là balance trôi âm thầm mà reconcile không bắt
   trực tiếp được. Cảnh báo này viết thẳng trong `fund-core.ts`.
2. **Không bao giờ xoá hay sửa tại chỗ.** Một chỉnh sửa là một dòng MỚI có
   `reversal_of_id` trỏ dòng gốc. CẢ dòng reversal LẪN dòng gốc nó trỏ đều bị
   loại khỏi mọi tổng (balance, báo cáo). Reconcile I9 bắt reversal mồ côi.
3. **`amount` luôn là độ lớn không âm.** Dấu nằm ở `direction` ('in'|'out'|
   'neutral'), nhưng công thức balance keys theo `type`, KHÔNG theo `direction`.
   Direction chỉ dùng cho báo cáo tiền mặt mức nhóm.
4. **`session_debts` KHÔNG phải "ai còn nợ".** `finalizeSession` ghi dòng debt
   với `memberConfirmed=true` VÀ `adminConfirmed=true` ngay, cùng lúc ghi
   `fund_deduction`. Hai cờ đó giờ nghĩa "đã ghi vào sổ cái", KHÔNG phải "tiền đã
   về". Trả thật = balance ≥ 0. Reconcile I8 là dây bẫy.
5. **Roster suy ra.** Khoá member thì đóng băng balance, không tự hoàn. Reconcile
   I10 cảnh báo balance khác 0 ngoài roster.
6. **Admin cũng là member.** `finalizeSession` từ chối chạy nếu admin thao tác
   không gắn member (`resolveAdminMemberId`). Phần khách của admin
   (guestPlay+guestDine) vào nhóm dưới dạng `session_guest_income` với
   `memberId=null`, cố ý không ghi vào balance cá nhân admin (quyết định
   10/07/2026).

### Các type giao dịch

| Type                    | Direction           | Đổi balance?          | Nghĩa                                                                                                                             |
| ----------------------- | ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fund_contribution`     | in (reversal: out)  | **+**                 | Nạp quỹ, khớp CK nạp, cặp cân cho CK trả nợ, tín dụng trả thừa, thặng dư phạt sàn, tiền pass sân, HOẶC reversal của một deduction |
| `fund_deduction`        | out                 | **−**                 | Trừ quỹ khi chốt buổi; auto trừ khi balance dương gánh nợ đang mở                                                                 |
| `fund_refund`           | out                 | **−**                 | Tiền rời quỹ trả lại member; HOẶC reversal của một contribution                                                                   |
| `debt_created`          | neutral             | không                 | Kiểm toán: một dòng mỗi `session_debts` lúc chốt                                                                                  |
| `debt_member_confirmed` | neutral             | không                 | Kiểm toán: member bấm đã trả                                                                                                      |
| `debt_admin_confirmed`  | neutral             | không                 | Kiểm toán: admin xác nhận, hoặc matcher ngân hàng tự xác nhận                                                                     |
| `debt_undo`             | neutral             | không                 | Kiểm toán: admin hoàn tác. Sự có mặt của nó là thứ cho I8 tha một debt đã nhận CK mà cờ về false                                  |
| `bank_payment_received` | in                  | **không** (kiểm toán) | CK thật settle một debt. BẮT BUỘC đi kèm `fund_contribution` cặp                                                                  |
| `session_guest_income`  | in (reversal: out)  | không (memberId=null) | Khách của admin tự trả vào quỹ nhóm                                                                                               |
| `inventory_purchase`    | out (sửa xuống: in) | không (tiền nhóm)     | Mua cầu, hoặc sửa delta mua                                                                                                       |
| `court_rent_payment`    | out (reversal: in)  | không (tiền nhóm)     | Admin trả tiền thuê sân                                                                                                           |
| `manual_adjustment`     | —                   | —                     | Khai trong enum nhưng KHÔNG đường code nào ghi. Nói thẳng chứ không bịa nghĩa                                                     |

### Bất biến I1–I10 (reconcile)

Kiểm bởi `src/actions/reconcile-fund.ts` (chạy qua skill `reconcile-check`). Báo
cáo `ok=true` chỉ khi không có issue severity `error`; warning không làm fail.

| ID      | Mức        | Phát biểu                                                                                                                                          |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I1**  | error      | `Σcontribution − Σdeduction − Σrefund` toàn sổ (netInternal) phải bằng `Σ balance từng member` (netByMembers). Cả hai vế lọc cặp reversal như nhau |
| I2      | (không mã) | Σ(balance dương) + Σ(balance âm) = tổng balance. Có trong docblock, gộp vào phép so I1, không assert riêng                                         |
| **I3**  | warn       | Mỗi `payment_notifications` status='matched' có một tx trỏ ngược về nó                                                                             |
| **I4**  | error      | Mỗi tx có `payment_notification_id` non-null trỏ tới notification còn tồn tại                                                                      |
| **I5**  | error      | Không tx nào có amount âm hoặc không nguyên (cũng được CHECK DB và write-time chặn)                                                                |
| **I6**  | error      | Không hai tx chung `idempotency_key` non-null (cưỡng chế thật bằng UNIQUE index)                                                                   |
| **I7**  | warn       | Mỗi tx debt-scoped trỏ tới `session_debts` còn tồn tại (bắt ledger mồ côi sau khi debt bị xoá cứng)                                                |
| **I8**  | error      | Một debt có `bank_payment_received` phải có CẢ `memberConfirmed` LẪN `adminConfirmed`. Debt có kèm `debt_undo` được loại trừ (trạng thái hợp lệ)   |
| **I9**  | warn       | Mỗi dòng có `reversalOfId` trỏ tới một tx còn tồn tại                                                                                              |
| **I10** | warn       | Member ngoài roster không nên giữ balance khác 0 (khoá = đóng băng, không tự hoàn)                                                                 |

### Làm tròn và chia đầu người

`roundToThousand(amount)` (`src/lib/utils.ts`) làm tròn LÊN theo độ lớn, giữ dấu:

```ts
if (amount === 0) return 0;
const sign = amount < 0 ? -1 : 1;
return sign * Math.ceil(Math.abs(amount) / 1000) * 1000;
```

Số dương luôn tròn lên bội 1.000 kế tiếp để admin không bao giờ bị thu thiếu. Đây
là hàm làm tròn tiền DUY NHẤT được phép; `Math.round()` trên tiền và `parseFloat()`
bị cấm (AGENTS.md).

Cầu: `computeShuttlecockTotal = roundToThousand(Σ (quantityUsed × pricePerTube /
12))`. Tổng chính xác rồi tròn MỘT lần cho cả buổi, không tròn từng brand (tròn
từng brand rồi cộng ra cao hơn, lệch giữa preview và debt).

Chia đầu: `totalPlayers = Σ headcount` trên attendee có attendsPlay; `totalDiners`
tương tự. Khách tính vào mẫu số; member "đi 2 người" đóng 2 đầu.

Chi tiết sáu-nhóm (`member`, `memberFemale`, `guestMember`, `guestMemberFemale`,
`guestAdmin`, `guestAdminFemale`) và thuật toán chia pool ở phần 4.

---

## 4. Tính tiền một buổi

Điểm vào DUY NHẤT: `calculateSessionCosts(session, attendees, shuttlecocks,
opts)` (`src/lib/cost-calculator.ts`). Mọi preview client phải import và gọi đúng
các hàm này, KHÔNG tự chế số học (AGENTS.md nêu ba màn preview từng trôi vì tự trừ
counter khách inline thay vì gọi `classifyGuestPlayHeads`).

Đầu vào tiền một buổi:

- **Tiền sân**: `sessions.court_price`, tính bởi `computeCourtTotal`. Buổi "đều
  đặn" (đúng sân mặc định VÀ ngày nằm trong `sessionDaysOfWeek`, mặc định Mon/Wed/
  Fri) trả `monthlyPrice` cho sân #1 + `retailPrice` cho sân #2..N; còn lại trả
  `retailPrice × số sân`.
- **Tiền cầu**: `roundToThousand(Σ quantityUsed × pricePerTube / 12)`, tròn một
  lần. `pricePerTube` là ảnh chụp, không phải giá brand hiện tại.
- `totalPlayCost = courtPrice + totalShuttlecockCost`.
- **Tiền ăn** tách hẳn: `dineCostPerHead = roundToThousand(diningBill /
totalDiners)`, bằng 0 khi không ai ăn.

### Sáu nhóm và chia pool

Mỗi đầu người chơi được `classifyHead` xếp vào một trong sáu nhóm, định giá bởi
`computeGroupPlayRates` (`src/lib/group-policy.ts`). Policy mỗi nhóm là `{mode:
'equal'|'floor'|'fixed'|'percent', amount, capAtEqual, percent?}`:

- Nhóm chia đều vào **pool**; nhóm có số riêng trả trước, phần còn lại chia cho
  pool.
- Vòng lặp tự kiểm lại: nhóm "floor" mà giá pool đã vượt sàn thì nhập lại pool;
  nhóm "fixed" có `capAtEqual` mà vượt giá pool cũng nhập lại. Lặp tối đa
  `GROUP_KEYS.length + 1` vòng.
- Toàn bộ tính trên thang nguyên ×100, đúng MỘT phép chia mỗi nhóm ở cuối, cố ý
  để một dư 1e-11 không bị tròn lên thành nguyên 1.000 VND mỗi đầu (bug đã có ở
  bản hệ số 0,8: 350.000 chia 2 nam + 1 nữ thu thành 353.000).

`DEFAULT_GROUP_POLICIES`: mọi nhóm "equal" TRỪ `guestAdmin` / `guestAdminFemale`
là `{mode:'floor', amount:60_000}`. Nên khách của ADMIN trả tối thiểu 60K, phần
dư hạ giá chia đều cho người khác; khách của MEMBER trả giá đều thường và tính vào
member mời. `percent: 80` trên nhóm nữ chỉ là giá trị điền sẵn của form, mode vẫn
"equal" nên chưa dời đồng nào tới khi admin đổi mode.

### Tiền mỗi member (`calculateSessionCosts` bước 5)

```
playAmount      = memberPlays ? ownRate + ratesByGroup.guestMember × extraHeads : 0
dineAmount      = memberDines ? dineCostPerHead × headcount : 0
guestPlayAmount = Σ khách-chơi của member: rate theo nhóm × headcount khách
guestDineAmount = (số khách-ăn của member) × dineCostPerHead
totalAmount     = playAmount + dineAmount + guestPlayAmount + guestDineAmount
```

Đầu thứ hai của member "đi 2 người" luôn định giá như `guestMember`, không theo
nhóm giới (quyết định 27/07/2026). Một dòng member chỉ được phát ra khi
`totalAmount > 0`, nhưng tập memberId gồm cả host mời khách dù host không chơi
không ăn, nếu không tiền khách của admin biến mất và buổi hiện lỗ giả.

### Sàn trừ tối thiểu (sàn nghèo), áp SAU khi chia nhóm, chỉ lúc chốt sổ

Khi `sessions.use_min_deduction` true và member không phải admin, không nằm trong
`session_min_deduction_exemptions`: `applyMinDeductionFloor(debt, balance,
settings.minDeductionAmount)` nâng `playAmount` lên sàn (mặc định 60.000) CHỈ khi
`playAmount > 0 && balance < playAmount && playAmount < floor`. Không đụng
dineAmount, guestPlay, guestDine.

Sàn này cố ý **đè mọi giảm giá nhóm** cho member đang cạn quỹ. Comment trong code
nói rõ nhìn ngoài giống bug nhưng không phải, đừng "sửa". Phần thặng dư
(`floored − original`) ghi cho admin dưới dạng `fund_contribution` phạt
(`min-deduction-penalty-*`) để Σ deduction vẫn bằng tiền thật admin chi, I1 giữ.

### Cấu hình đóng băng

Lần chốt sổ thành công đầu tiên, settings được serialize vào
`sessions.settings_snapshot` trong cùng transaction. Chốt lại đọc snapshot qua
`resolveSessionSettings`, nên đóng lại buổi cũ không bao giờ âm thầm định giá lại
bằng sàn/policy mới. `settings_override` là chỉnh tay từng buổi;
`unlockSession(sessionId, clearSettingsSnapshot)` chỉ xoá snapshot khi admin tick.

### Preview phải không trôi khỏi finalize

`computePerHeadCharges` / `computeGuestAwarePlayRates` / `computeDineCostPerHead`
/ `classifyGuestPlayHeads` đều route vào `computeGroupPlayRates`.
`computeGuestAwarePlayRates` ném `GuestMemberPolicyUnknownError` khi thiếu
`guestMemberPlayHeads` mà policy guestMember không còn "equal";
`computePerHeadChargesSafe` bắt đúng lớp đó (bằng `instanceof`), trả rate chơi 0
mà vẫn giữ dine đúng, ném lại mọi lỗi khác.

---

## 5. Vòng đời buổi chơi, vote, attendee

### Trạng thái buổi

```
          confirmSession          finalizeSession
voting ───────────────▶ confirmed ──────────────▶ completed
   │                        │                          │
   │ cancelSession          │ cancelSession            │ unlockSession
   ▼                        ▼                          ▼
cancelled ◀──────────────────                       voting
   │  reopenSession
   └────────────────────────▶ voting
```

| Status        | Nghĩa                                                                                                                         | Chuyển tới                    | Bởi                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **voting**    | Mặc định lúc tạo. Nhận vote (tuỳ `voteDeadline`), mọi thao tác admin hợp lệ                                                   | confirmed/completed/cancelled | 4 đường tạo (cron, getNextSession, getAdminUpcomingSession, createSessionManually), đều insert status='voting'                                                    |
| **confirmed** | Admin đã chốt sân + cầu, chưa đóng sổ. Vote vẫn mở, vẫn sửa được                                                              | voting/completed/cancelled    | `confirmSession`: status phải đúng 'voting', `courtId` non-null, ≥1 dòng cầu                                                                                      |
| **completed** | Đã đóng sổ. Attendee + debt tồn tại, `fund_deduction` đã ghi, snapshot đóng băng. `assertEditable` chặn mọi thao tác đổi tiền | voting                        | `finalizeSession` / `finalizeSessionAuto`. Từ voting hoặc confirmed. `finalizeSession` CHO phép chốt-lại (reverse deduction/penalty/guest-income cũ rồi dựng lại) |
| **cancelled** | Huỷ. Không debt, không attendee. Dòng cầu được GIỮ nhưng loại khỏi tồn "đã dùng" và doanh thu                                 | voting                        | `cancelSession`: từ voting/confirmed, chặn từ completed. Gọi trên buổi đã huỷ là no-op idempotent                                                                 |

### Vote

- **Ai vote**: `submitVote` gọi `requireApprovedMember()`, cần cookie danh tính,
  dòng member tồn tại, `is_active=true`, `approval_status='approved'`. Chặn ở
  action, không chỉ UI.
- **Cổng mở vote**: `isVoteOpen({status, voteDeadline})`. Status phải voting hoặc
  confirmed (check status TRƯỚC để buổi completed không báo lý do "deadline").
  `voteDeadline` NULL = không hạn.
- **Deadline**: lưu TEXT `YYYY-MM-DDTHH:MM:SS` không `Z`, hiểu là giờ Việt Nam.
  `parseVoteDeadline` ghim `+07:00` để so sánh giống nhau trên server UTC và
  browser VN. Mặc định = giờ bắt đầu trừ `voteDeadlineOffsetHours` (mặc định 4h).
- **⚠️ Treo timezone đã biết**: `setVoteDeadline` (kiểm tương lai) và
  `extendVoteDeadline` (`currentDeadlineMs`) dùng `new Date(...)` trần trên chuỗi
  không offset, còn `formatLocalDeadline`/`computeDefaultDeadline` dựng chuỗi theo
  timezone local của runtime. Chỉ `parseVoteDeadline` (cổng đọc) ghim +07:00.
  Trên server UTC, hai đường ghi này hiểu cùng chuỗi lệch ~7h so với đường đọc.
  Chưa có test chốt hành vi phía ghi. Đây là thứ code đang làm, không phải khẳng
  định về chủ ý.
- **Sức chứa**: `max_players` (default 16). `submitVote` chặn chỉ khi tăng vượt
  cap; không ai đang giữ chỗ bị đẩy ra khi admin hạ cap.
- **Khách**: member tự khai khách đã chết (00 trên mọi cột). Admin set hai kho:
  khách-của-member trên `votes.guest_*`, khách-của-admin trên `sessions.admin_
guest_*`. `adminSetVote` zero cột khách trong CÙNG câu lệnh khi tắt will-flag,
  để finalize không dựng "khách ma" vào mẫu số.
- **Chặn nợ ở home**: trang công khai ẩn UI vote khi balance `<= -voteBlock
DebtThreshold` (mặc định 100K). Đây là chuyển hướng UI, `submitVote` không tự
  check balance.

### Attendee

- **Không có check-in.** `session_attendees` chỉ ghi ở `finalizeSession` (ngoài
  seed và merge member).
- Một vote thành attendee chỉ lúc chốt sổ. `finalizeSessionAuto` dựng
  `attendeeList` từ votes + counter khách admin. Voter bị khoá/chưa duyệt bị BỎ
  QUA để một người khoá không làm kẹt cả nút chốt một-bấm.
- Gender được CHỤP vào `session_attendees.gender` lúc chốt; bộ tính tiền đọc lại
  từ đó, không từ `members.gender`.
- **Chốt chặn trước finalize**: nếu `admin_guest_play_count > 0` thì
  `attendeeList` phải có đủ bấy nhiêu khách `invitedById = adminMemberId`, thiếu
  là finalize báo lỗi. Thiếu một khách sẽ co mẫu số và thu thừa người khác.
- Finalize từ chối khi bất kỳ ai sắp nợ bị `is_active=false` hoặc chưa approved,
  và khi admin không gắn được member.
- Khi chốt-lại / `unlockSession`: xoá hết attendee + debt rồi dựng lại, SAU khi
  NULL `financial_transactions.debtId` và `payment_notifications.matchedDebtId`
  (libsql không cưỡng chế FK nên `onDelete` không tự chạy).

---

## 6. Tồn kho cầu

```
rawStockQua = totalPurchasedQua − totalUsedQua + adjustQua
```

- `totalPurchasedQua = Σ(inventory_purchases.tubes) × 12` (`QUA_PER_TUBE = 12`)
- `totalUsedQua = Σ(session_shuttlecocks.quantity_used)` **chỉ buổi status ≠
  'cancelled'**
- `adjustQua = shuttlecock_brands.stock_adjust_qua ?? 0`
- Hiển thị: `currentStockQua = Math.max(0, rawStockQua)`, chia ống/quả.

Tính một lần ở `src/lib/inventory-core.ts`. Quy tắc:

- **Tồn kho KHÔNG lưu cột nào.** Chỉ `stock_adjust_qua` được lưu. Mọi lần đọc
  tính lại từ ba bảng nguồn, nên sửa/xoá một dòng mua hay dùng được phản ánh ngay.
- Buổi huỷ GIỮ dòng `session_shuttlecocks` nhưng loại khỏi tồn "đã dùng" và doanh
  thu. Mất cầu do buổi huỷ thì admin ghi qua `setStockQua`. Chỉ `deleteSession`
  mới xoá hẳn dòng cầu (trả lại tồn).
- **Ngưỡng ít**: `< 12 quả` (1 ống), chỉnh qua setting `lowStockThresholdQua`.
- `setStockQua(brandId, desiredQua)` chỉnh DELTA trong một transaction, không ghi
  đè lịch sử mua/dùng. Transaction để hai admin sửa cùng lúc không nhân đôi delta.
- `recordPurchase` cần `idempotencyKey` (≥4 ký tự), replay là no-op, mỗi lần ghi
  một `inventory_purchase` direction="out" amount = tubes × pricePerTube.
- Mọi đường tạo buổi pre-seed một dòng dùng `quantityUsed: 1` của brand mặc định.
  Nên buổi không chơi mà không huỷ vẫn tính 1 quả đã dùng.
- Brand bị vô hiệu mềm khi có tham chiếu (`deleteBrand` từ chối khi có lịch sử,
  hướng tới `toggleBrandActive`).
- Mọi read kho đều admin-gated.

---

## 7. An toàn dữ liệu

Có nhiều lớp sao lưu và một bản dự phòng tự chuyển. KHÔNG chép lại ở đây. Xem
[backup-restore.md](./backup-restore.md). Tóm tắt một dòng mỗi lớp:

- **Sao lưu đám mây theo giờ** (GitHub Actions, mã hoá, giữ 90 ngày).
- **Bản dự phòng libsql ghi được** + tự chuyển (`src/db/failover.ts`); có thể
  CHƯA bật ở prod, kiểm secret trước khi tin.
- **Kho chỉ-đọc Cloudflare D1** (có thể chưa bật).
- **Sao lưu niêm phong hằng ngày về máy** + chép sang OneDrive
  (`scripts/backup-local.mjs`).
- **Cảnh báo quota Turso** trước khi bị khoá.

### Nguy hiểm khi dev

`.env.local` trỏ database **PRODUCTION**. `db:seed` / `db:push` / `db:clone-local`
sẽ **phá dữ liệu thật**. Test local dùng database file `e2e/local.db`.

---

## 8. Lịch sử migration, mấy điều cần biết

- 29 migration, 0000 (2026-03) tới 0028 (thông báo, 04/11/2026), theo
  `src/db/migrations/meta/_journal.json`.
- **Migration recreate-table (loại nguy hiểm)**: 0007 (members), 0011 (nhiều
  bảng), 0014 (financial_transactions lần nữa, inventory_purchases,
  session_shuttlecocks). Recreate-table làm **rụng index**: ở 0014 drizzle-kit
  sinh `CREATE INDEX` TRƯỚC `DROP+RENAME`, suýt mất cả UNIQUE idempotency; một
  người đã chuyển chúng xuống sau rename và ghi chú trong file. Mọi recreate-table
  tương lai phải soi tay như vậy.
- **FK vốn là trang trí tới 0010** (NO ACTION). 0011 mới gắn hành vi thật (CASCADE
  cho con, SET NULL cho ledger/audit). 0014 thêm hai FK còn thiếu +
  self-FK `reversal_of_id` + CHECK amount≥0.
- **`idempotency_key` có ba thế hệ** cùng tồn tại trong prod: `legacy-tx-*`,
  `auto-*` (default DB), và UUID client thật. Chỉ UUID mới chống retry thật.
- **Backfill đã chạy, đừng lặp**: 0008 set mọi member cũ 'approved'; 0012 điền
  `vote_deadline` CHỈ cho buổi voting/confirmed, để completed/cancelled NULL cố ý
  để buổi chết không âm thầm mở lại.
- Cột thêm muộn nên dòng cũ mang default: xem danh sách đầy đủ trong
  `_journal.json`. Gần nhất: `admins.role` và `members.notify_email_verified_for` (0028),
  `members.signup_intent` (0027), `courts.venue_id` (0026), `members.skill_level`
  (0025), các cột gender (0024).

---

## Cách tái tạo tài liệu này

Mọi mục đọc trực tiếp từ code. Để kiểm nhanh vài khẳng định load-bearing:

```bash
# Công thức balance (3 type fund_*)
grep -n "case \"fund_" src/lib/fund-core.ts
# Hàm làm tròn duy nhất
grep -n -A6 "export function roundToThousand" src/lib/utils.ts
# Mã bất biến reconcile
grep -oE "I[0-9]+_[a-z_]+" src/actions/reconcile-fund.ts | sort -u
# Đếm bảng và migration
grep -cE "sqliteTable\(" src/db/schema.ts
ls src/db/migrations/*.sql | wc -l
# Chạy bộ kiểm tiền (hụt prod, read-only)
node scripts/run-reconcile.mjs
```
