# Page Settings cho admin (FWBB)

Ngày: 27/7/2026
Trạng thái: design đã duyệt, chờ lập plan

## 1. Vấn đề

Cấu hình của app đang nằm ba chỗ khác nhau. Một số ít ở bảng `app_settings` với UI là card nhỏ góc
dashboard (sân mặc định, hãng cầu, ngày cố định). Một số là hằng số trong code, admin muốn đổi phải
sửa code rồi deploy (sàn 60K, ngưỡng quỹ thấp 100K, ngưỡng cầu 12 quả, deadline vote 4 tiếng, mức
tối đa 8 và 16 người). Số còn lại là default cứng trong schema (giờ chơi 20:30, 1 sân, 16 người).

Ngoài ra cách chia tiền cho khách và cho người đi kèm đang bị đóng cứng trong công thức: khách của
admin luôn ăn sàn 60K, khách của member luôn chia đều, không có cách nào đổi theo buổi.

Mục tiêu: một page `/admin/settings` gom hết lại, có setting chung cho mọi buổi và cho phép sửa
riêng từng buổi khi cần.

## 2. Quyết định đã chốt

Chốt qua hỏi đáp với admin ngày 26 và 27/7/2026.

1. Nam và nữ có tính tiền khác nhau, áp cho cả member lẫn khách. Nhưng đây là **tùy chọn admin
   bật khi cần**, mặc định tắt và mọi người chia đều như hiện tại.
2. Nữ trả **số cố định** chứ không phải phần trăm. Tách ba nhóm riêng: member nữ, khách nữ của
   member, khách nữ của admin.
3. Mỗi nhóm ở chế độ cố định có thêm một tick **"không trả cao hơn suất chia đều"**. Admin tự
   quyết từng nhóm, không áp một kiểu cho tất cả.
4. Setting của buổi lẻ **kế thừa setting chung, sửa được từng ô**. Sửa ô nào thì chỉ ô đó riêng,
   có badge báo đang khác chung và nút reset. Không dùng bộ quy tắc dựng sẵn.
5. Đầu thứ hai của "đi 2 mình" (`headcount=2`) **dùng luôn chính sách khách của member**. Không
   tạo nhóm riêng, không khai giới tính người đi kèm.
6. Ô khai khách nữ chỉ hiện khi admin bật phân biệt nam nữ. Tắt thì màn vote giữ nguyên một ô đếm
   khách như cũ.
7. Scope gồm cả bốn nhóm setting: ngưỡng tiền và tồn kho, mặc định cho buổi mới, luật vote, vận hành.
8. Kiến trúc: **registry khai báo cộng một cột JSON override**, không thêm mỗi setting một cột.
9. **Tiền nhậu thôi trừ quỹ.** Nhậu còn là điểm danh cộng chia đều để hiển thị, không vào nợ và
   không trừ quỹ.
10. Rule nhậu **áp từ lúc deploy**, buổi cũ giữ nguyên số liệu, kèm một nút cho admin chốt lại sổ
    từng buổi cũ nếu muốn hoàn phần nhậu.

Hai điểm sau không phải admin yêu cầu mà phát sinh từ khảo sát code, ghi ở đây để khỏi quên:

11. Buổi đã chốt sổ phải **đóng băng cấu hình** của nó, nếu không nút chốt lại sổ sẽ vô tình tính
    tiền lịch sử theo setting mới. Chi tiết ở mục 5.6.
12. Hiện **không có chỗ nào nhập tiền nhậu**, nên phải thêm ô nhập thì "chia tiền nhậu để xem" mới
    có nghĩa. Chi tiết ở mục 5.1 và 5.3.

## 3. Kiến trúc lưu setting

### 3.1 Registry

File mới `src/lib/settings-registry.ts` khai báo mỗi setting một entry:

```ts
interface SettingDef<T> {
  key: string; // key trong app_settings
  schema: z.ZodType<T>; // validate cả khi đọc lẫn khi ghi
  default: T; // giá trị khi chưa ai set, phải khớp hành vi hôm nay
  perSession: boolean; // có cho override theo buổi không
  revalidate: string[]; // route cần revalidate khi đổi
}
```

Registry là nguồn sự thật duy nhất cho tên key, kiểu dữ liệu và giá trị mặc định. Thêm setting mới
sau này là thêm một entry, không cần migration.

### 3.2 Ba tầng giá trị

```
default trong registry  ->  app_settings (admin sửa ở page Settings)  ->  sessions.settings_override (admin sửa ở buổi cụ thể)
```

Tầng sau đè tầng trước. Ô nào không có mặt ở tầng sau thì kế thừa tầng trước, nên "kế thừa" là
trạng thái tự nhiên chứ không cần cờ riêng.

`src/lib/settings-resolve.ts` giữ hai hàm thuần:

- `resolveGlobal(rows)`: nhận các dòng `app_settings` thô, parse qua registry, thiếu hoặc hỏng thì
  lấy default. Không bao giờ ném lỗi ra ngoài, giá trị hỏng ghi log rồi rơi về default.
- `resolveForSession(global, overrideJson)`: gộp override của buổi lên trên.

Server đọc một lần bằng một query `SELECT key, value FROM app_settings`, không đọc lẻ từng key như
`src/actions/settings.ts` hiện tại.

Khi ghi phải dùng upsert nguyên tử `onConflictDoUpdate`, giống cách
`src/app/api/webhooks/gmail/route.ts:62` đang làm. Kiểu tìm trước rồi update hoặc insert ở
`src/actions/settings.ts:151` có kẽ hở khi hai request cùng lúc.

Hai test đang chạy `DELETE FROM app_settings` (`src/actions/sessions-cancel.integration.test.ts:60`
và `src/app/api/cron/create-session/route.test.ts:32`), nên mọi setting bắt buộc phải có default an
toàn ngay trong registry. Bảng rỗng không được làm app chạy sai.

### 3.3 Cột override

Một migration `ALTER TABLE sessions ADD COLUMN settings_override text` (JSON, nullable). Chỉ chứa
key admin đã sửa cho buổi đó. Cột dạng ADD COLUMN thuần, không recreate table, theo đúng bài học
Turso đã ghi trong repo.

**Chống hai nguồn sự thật:** thứ nào đã có cột riêng trên `sessions` thì buổi lẻ vẫn dùng đúng cột
đó, JSON không đụng vào. Cụ thể `court_id`, `court_quantity`, `start_time`, `end_time`,
`vote_deadline`, `max_players`, `use_min_deduction` giữ nguyên vai trò hiện tại. Setting chung chỉ
đóng vai trò giá trị điền sẵn lúc tạo buổi.

JSON override vì vậy chỉ chứa: bảng chính sách sáu nhóm, công tắc phân biệt nam nữ, số tiền sàn
cho member thiếu quỹ, giới hạn khách mỗi member, cách xử lý vote sau deadline, số người tối thiểu.

## 4. Chính sách chia tiền theo nhóm

### 4.1 Sáu nhóm, ba chế độ

| Nhóm                  | Key                 | Mặc định |
| --------------------- | ------------------- | -------- |
| Member nam            | `member`            | chia đều |
| Member nữ             | `memberFemale`      | chia đều |
| Khách của member, nam | `guestMember`       | chia đều |
| Khách của member, nữ  | `guestMemberFemale` | chia đều |
| Khách của admin, nam  | `guestAdmin`        | sàn 60K  |
| Khách của admin, nữ   | `guestAdminFemale`  | sàn 60K  |

Mỗi nhóm:

```ts
interface GroupPolicy {
  mode: "equal" | "floor" | "fixed";
  amount: number; // VND, số nguyên, bỏ qua khi mode = "equal"
  capAtEqual: boolean; // chỉ có nghĩa khi mode = "fixed"
}
```

Đầu thứ hai của member đi 2 mình xếp vào nhóm `guestMember`. Member chưa khai giới tính xếp vào
nhóm `member` (trả suất đầy đủ, không ưu đãi nhầm). Page Settings hiện cảnh báo số member chưa khai
kèm link sang trang thành viên.

### 4.2 Thuật toán

Hàm thuần mới `computeGroupPlayRates` trong `src/lib/cost-calculator.ts`:

```
vào:  totalPlayCost, headsByGroup (số đầu mỗi nhóm), policies
ra:   rate mỗi nhóm

pool    = các nhóm mode = "equal", hoặc có 0 đầu người
outside = các nhóm còn lại, tạm tính rate = policy.amount

lặp tối đa 6 lần:
    poolHeads = tổng đầu người trong pool
    nếu poolHeads = 0:
        mọi nhóm về chia đều naive (totalPlayCost / tổng đầu người), thoát
    fixedTotal = tổng (amount × heads) của outside
    equalRate  = max(0, (totalPlayCost - fixedTotal) / poolHeads)
    chuyển vào pool những nhóm:
        - mode = "floor" mà amount <= equalRate   (sàn không kích hoạt, thực chất đang chia đều)
        - mode = "fixed" có capAtEqual mà amount > equalRate   (bị cap về suất chia đều)
    không nhóm nào chuyển thì thoát

rate nhóm trong pool  = roundToThousand(equalRate)
rate nhóm ngoài pool  = roundToThousand(amount)
```

Vòng lặp chắc chắn dừng vì mỗi vòng chỉ có chiều đi vào pool, không có chiều đi ra, và chỉ có sáu
nhóm. Giới hạn 6 vòng là chặn cứng phòng lỗi lập trình.

Hai chỗ chặn âm giữ nguyên tinh thần code hiện tại: `max(0, ...)` khi nhóm cố định trả nhiều hơn cả
tổng chi phí, và pool rỗng thì bỏ qua chính sách để không ai phải gánh số âm.

### 4.3 Ba ví dụ

Cấu hình: nữ cố định 50K có tick cap, khách admin sàn 60K. Tổng sân cộng cầu 700K.

| Buổi     | Người chơi                 | Kết quả                                                                                             |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Đông vừa | 6 nam, 2 nữ, 2 khách admin | nam 75K, khách admin 75K (suất chia đều đã vượt sàn nên sàn không kích hoạt), nữ 50K. Thu đúng 700K |
| Vắng     | 2 nam, 2 nữ                | nữ 50K, nam 300K mỗi người                                                                          |
| Rất đông | 20 nam, 2 nữ               | tất cả 32K. Tick cap kéo nữ về suất chia đều. Bỏ tick thì nữ 50K và nam 30K                         |

### 4.4 Bằng chứng không đổi hành vi cũ

Với cấu hình mặc định (chỉ `guestAdmin` và `guestAdminFemale` ở chế độ sàn 60K, còn lại chia đều),
thuật toán mới cho ra đúng kết quả của `computeGuestAwarePlayRates` hiện tại.

Chứng minh điều kiện tách nhóm tương đương nhau. Gọi `H` là tổng đầu người, `A` số đầu khách admin,
`S = H - A` số đầu nhóm chia đều, `F` là sàn.

Code hiện tại tách khi `totalPlayCost / H < F`.
Thuật toán mới giữ khách admin ngoài pool khi `F > (totalPlayCost - F×A) / S`.

```
totalPlayCost / H < F
totalPlayCost < F × H = F × (S + A)
totalPlayCost - F×A < F × S
(totalPlayCost - F×A) / S < F
```

Hai điều kiện là một. Khi tách, cả hai cùng cho nhóm chia đều
`roundToThousand((totalPlayCost - F×A) / S)` và khách admin `F`. Khi không tách, cả hai cùng cho
`roundToThousand(totalPlayCost / H)`.

Hệ quả bắt buộc: `src/lib/cost-calculator.test.ts` phải xanh mà không sửa một dòng nào. Nếu phải sửa
test cũ thì tức là thuật toán sai, không phải test sai.

### 4.5 Những thứ cố ý không đụng

Sàn cho member thiếu quỹ (`applyMinDeductionFloor`) vẫn là tầng riêng chạy sau, dựa trên số dư quỹ
chứ không phải nhóm người, chỉ khác là đọc số tiền từ setting thay vì hằng số. Trộn nó vào bảng nhóm
sẽ làm hai khái niệm khác nhau dính vào nhau.

Lưu ý một cái bẫy: hằng số `MIN_DEDUCTION_PER_HEAD` ở `src/lib/cost-calculator.ts:130` đang phục vụ
**hai luật khác nhau** cùng lúc, sàn của khách admin (`:255`) và sàn của member thiếu quỹ (`:135`).
Sau thay đổi chúng tách thành hai setting độc lập: sàn khách admin nằm trong bảng nhóm, sàn member
thiếu quỹ là setting riêng. Cả hai cùng mặc định 60K nên hành vi không đổi, nhưng từ nay admin chỉnh
được riêng từng cái.

Thêm nữa, `finalizeSession` hiện không truyền tham số floor (`src/actions/finance.ts:146,360`) nên
đang ăn theo hằng số mặc định. Sau thay đổi nó phải đọc setting rồi truyền vào tường minh.

Làm tròn lên 1K giữ nguyên, áp cho từng suất. Phần dư do làm tròn vẫn vào quỹ.

Công thức tiền sân (`computeCourtTotal`) và tiền cầu (`computeShuttlecockTotal`) không đổi.

## 5. Nhậu thôi trừ quỹ

### 5.1 Hiện trạng

`finalizeSession` ghi khoản trừ quỹ bằng `playAmount + dineAmount` cho admin và `totalAmount` cho
member (`src/actions/finance.ts:376`), nên tiền nhậu đang nằm trong nợ và trong ledger.

Một phát hiện lúc khảo sát: **hiện không có chỗ nào nhập tiền nhậu**. Wizard
`src/components/sessions/finalize-session.tsx` có ô nhập nhưng không file nào import nó, đó là code
chết. Đường chốt sổ thật là `finalizeSessionAuto` đọc `sessions.dining_bill` từ DB
(`src/actions/finance.ts:645`), mà không action nào ghi cột đó. Buổi mới vì vậy luôn 0 đồng nhậu,
dữ liệu nhậu chỉ tồn tại ở các buổi cũ.

### 5.2 Sau thay đổi

Tiền nhậu **không vào `session_debts` nữa**: `dine_amount` và `guest_dine_amount` của dòng nợ mới
đều bằng 0, `total_amount` không gồm nhậu, `fund_deduction` không gồm nhậu. Hai cột cũ giữ nguyên
trong schema để dữ liệu lịch sử đọc được.

Vì sao không lưu tiền nhậu vào dòng nợ cho tiện hiển thị: `calculateSessionCosts` chỉ tạo dòng nợ
khi `totalAmount > 0` (`src/lib/cost-calculator.ts:430`). Nếu vẫn lưu phần nhậu thì member chỉ đi
nhậu sẽ có một dòng nợ `total_amount = 0` mang hai cờ confirmed bật sẵn
(`src/actions/finance.ts:389` set vô điều kiện) trong khi ledger bị chặn ở
`src/actions/finance.ts:425` vì số tiền bằng 0. Đó đúng là kiểu vi phạm bất biến I8 mà AGENTS.md
cấm, và `reconcile-fund.ts` sẽ không bắt được vì nó chỉ soi khoản bank payment.

Số tiền nhậu mỗi người vì vậy tính tại chỗ lúc hiển thị, lấy `dining_bill` chia cho số người điểm
danh nhậu. Màn hình liên quan phải lấy danh sách người nhậu từ `session_attendees` chứ không từ
`session_debts`, vì member chỉ nhậu sẽ không còn dòng nợ nào.

Nhậu luôn chia đều theo đầu người, không áp bảng chính sách nhóm.

### 5.3 Thêm ô nhập tiền nhậu

Vì mục 5.1, muốn "chia tiền nhậu để xem" thì phải có chỗ nhập. Thêm ô nhập `dining_bill` vào trang
chi tiết buổi, cạnh chỗ nhập tiền sân, kèm dòng hiển thị "mỗi người bao nhiêu". Ô này ghi thẳng vào
`sessions.dining_bill`, không đụng ledger.

Wizard `finalize-session.tsx` xử lý riêng: hoặc xóa vì là code chết, hoặc để nguyên không đụng tới.
Quyết định lúc lập plan, không gộp vào việc này.

### 5.4 Phải sửa cùng lúc, nếu không sổ sách sai

- `src/actions/fund.ts:1106` tính chi bằng `courtPrice + shuttleCost + diningBill`. Bỏ nhậu khỏi
  phần thu mà giữ ở phần chi thì mọi buổi có nhậu hiện lỗ giả.
- `src/actions/finance.ts:448` cộng `guestDineAmount` vào `session_guest_income`. Phải bỏ cùng lúc,
  nếu không bất biến I1 vỡ.
- Ba chỗ tính "Tổng thu dự kiến" đang cộng phần nhậu:
  `src/components/sessions/admin-session-card.tsx:549`,
  `src/app/(admin)/admin/sessions/session-list.tsx:672` và `:848`.
- `src/lib/payment-matcher.ts` so số tiền chuyển khoản với `totalAmount`. Sau thay đổi, khoản cũ
  còn gồm nhậu sẽ không khớp nữa, cần kiểm lại ngưỡng khớp.
- `src/lib/fifo-paid-attribution.ts:23` bỏ qua khoản nhỏ hơn hoặc bằng 0, nên buổi chỉ có nhậu sẽ
  biến mất khỏi lịch sử trả tiền. Cần quyết định hiển thị thế nào.

### 5.5 Buổi cũ

Không chạy migration hoàn hàng loạt. `finalizeSession` vốn đã idempotent, nó đảo khoản trừ cũ qua
`reversalOfId` rồi ghi lại khoản mới, nên nút "chốt lại sổ" ở trang chi tiết buổi chỉ cần gọi lại
chính nó. Admin bấm buổi nào thì buổi đó được tính lại theo rule mới.

### 5.6 Đóng băng cấu hình lúc chốt sổ

Vì chốt lại sổ là tính lại từ đầu, một buổi cũ sẽ bị áp cấu hình **hiện tại** thay vì cấu hình lúc
nó diễn ra. Admin đổi sàn từ 60K lên 70K rồi bấm chốt lại một buổi tháng trước là tiền lịch sử đổi
theo, không ai muốn thế.

Xử lý: thêm cột `sessions.settings_snapshot` (JSON, nullable). Lần chốt sổ đầu tiên ghi lại toàn bộ
cấu hình đang áp dụng cho buổi đó. Các lần chốt lại sau đọc snapshot thay vì setting hiện tại. Muốn
áp cấu hình mới cho buổi cũ thì phải bấm thêm một nút xóa snapshot, có xác nhận.

Cột này khác `settings_override` về ý nghĩa: `settings_override` là admin cố ý sửa riêng,
`settings_snapshot` là ảnh chụp lúc chốt. Tách hai cột để badge "đang khác setting chung" không bị
bật nhầm cho mọi buổi đã chốt.

## 6. Danh mục setting

Cột "buổi lẻ" nói ô đó có sửa riêng cho một buổi được không.

### Chia tiền

| Setting                  | Mặc định     | Buổi lẻ                    |
| ------------------------ | ------------ | -------------------------- |
| Phân biệt nam nữ         | tắt          | có                         |
| Chính sách 6 nhóm        | như bảng 4.1 | có                         |
| Sàn cho member thiếu quỹ | bật, 60K     | có, cả bật tắt lẫn số tiền |

### Mặc định cho buổi mới

| Setting                     | Mặc định       | Buổi lẻ sửa ở đâu             |
| --------------------------- | -------------- | ----------------------------- |
| Sân                         | như hiện tại   | bộ chọn sân sẵn có            |
| Hãng cầu                    | như hiện tại   | selector cầu sẵn có           |
| Ngày cố định trong tuần     | T2, T4, T6     | không áp dụng                 |
| Giờ bắt đầu và kết thúc     | 20:30 và 22:30 | cột `start_time` / `end_time` |
| Số sân                      | 1              | cột `court_quantity`          |
| Hết hạn vote trước giờ chơi | 4 tiếng        | nút sửa deadline sẵn có       |
| Số người tối đa             | 16             | cột `max_players`             |
| Các mức tối đa chọn nhanh   | 8, 12, 16, 20  | danh sách admin tự thêm bớt   |

Sân, hãng cầu và ngày cố định dời hẳn từ card dashboard sang page Settings. Card ở dashboard bỏ đi
để không có hai chỗ cùng sửa một giá trị.

### Ngưỡng

| Setting              | Mặc định | Buổi lẻ |
| -------------------- | -------- | ------- |
| Cảnh báo quỹ thấp    | 100K     | không   |
| Chặn vote khi nợ quá | 100K     | không   |
| Cảnh báo cầu sắp hết | 12 quả   | không   |

### Luật vote

| Setting                         | Mặc định                              | Buổi lẻ |
| ------------------------------- | ------------------------------------- | ------- |
| Giới hạn khách mỗi member       | 0, nghĩa là không giới hạn            | có      |
| Sau deadline                    | chặn vote, đổi được sang chỉ cảnh báo | có      |
| Số người tối thiểu để buổi chạy | 0, nghĩa là không cảnh báo            | có      |

### Vận hành

| Setting                    | Mặc định     | Buổi lẻ |
| -------------------------- | ------------ | ------- |
| Tự động tạo buổi theo lịch | bật          | không   |
| Tên nhóm hiển thị          | FWBB         | không   |
| Thông tin chuyển khoản     | như hiện tại | không   |

## 7. Giới tính

### 7.1 Dữ liệu

- `members.gender`: text nullable, nhận `male` hoặc `female`. Chưa khai thì null và tính như nam.
- `votes.guest_play_female_count`, `votes.guest_dine_female_count`: integer mặc định 0.
- `sessions.admin_guest_play_female_count`, `sessions.admin_guest_dine_female_count`: integer mặc
  định 0.
- `session_attendees.gender`: text nullable, để dòng khách mang giới tính khi sinh từ phiếu vote.

Ràng buộc số khách nữ không vượt tổng số khách được giữ ở tầng zod (`src/lib/validators.ts:43,106`),
không thêm CHECK vào DB, theo đúng cách repo đang giữ bất biến cho `headcount` và `court_price`.

**Luồng dữ liệu phải nhớ:** tiền được tính từ các dòng `session_attendees`, không phải từ counter
trong phiếu vote. Counter chỉ là đầu vào lúc member bấm vote; đến khi chốt sổ, `finalizeSession`
bung counter thành từng dòng attendee (`src/actions/finance.ts:317,600,624`). Vì vậy cột giới tính
bắt buộc phải có ở `session_attendees`, và bước bung phải gán đúng giới tính cho từng dòng khách,
nếu không bảng chính sách nhóm không có gì để phân loại.

`src/actions/votes.ts:201` xoá counter khách khi member bỏ vote. Cột đếm nữ phải được zero trong
cùng câu lệnh đó, nếu không sẽ còn khách nữ ma sau khi member rút phiếu.

### 7.2 Giao diện

Khi công tắc phân biệt nam nữ **tắt**: màn vote không đổi gì, mọi counter nữ giữ 0.

Khi **bật**: dưới ô đếm khách mọc thêm ô "trong đó nữ", tối đa bằng tổng khách. Admin khai giới tính
member ở trang thành viên. Page Settings hiện cảnh báo còn bao nhiêu member chưa khai.

## 8. Giao diện page Settings

Route `/admin/settings`, đặt cùng nhóm với các page admin hiện có. Quyền đã được chặn sẵn ở
`src/proxy.ts:16` với matcher `/admin/:path*`, không cần thêm gì.

Menu điều hướng bị chép làm hai bản, phải thêm mục mới ở cả hai chỗ:
`src/components/layout/admin-sidebar.tsx:57` và `src/components/layout/admin-mobile-nav.tsx:61`.

Chuỗi hiển thị thêm vào cả ba file `src/i18n/messages/{vi,en,zh}.json`. Có test chặn lệch ngôn ngữ
(`locale-parity.test.ts`) nên thiếu một file là đỏ ngay.

Trang chia thành các mục gấp mở được, mỗi mục là một `SectionCard` theo mẫu sẵn có. Thứ tự: chia
tiền, mặc định buổi mới, ngưỡng, luật vote, vận hành.

Theo chuẩn của dự án: mobile first, vùng chạm tối thiểu 44px, mỗi thao tác cập nhật lạc quan qua
`fireAction` rồi hoàn tác nếu lỗi, giống hệt cách `default-settings-card.tsx` đang làm. Không có nút
Lưu chung, đổi ô nào lưu ô đó.

Mục chia tiền có thêm một khối xem thử: admin nhập số người và tổng tiền giả định, khối này gọi
đúng hàm tính tiền thật để hiện mỗi nhóm trả bao nhiêu. Nó dùng chung hàm với lúc chốt sổ nên không
bao giờ lệch.

## 9. Sửa riêng cho một buổi

Trong trang chi tiết buổi, thêm một panel "Cấu hình riêng buổi này" gấp lại mặc định. Panel hiện
đúng các ô cho phép override, mỗi ô có badge khi đang khác setting chung, kèm nút đưa ô đó về chung
và nút đưa cả buổi về chung.

Panel chỉ mở khi buổi chưa chốt sổ. Buổi đã chốt thì hiện ở dạng chỉ đọc, muốn đổi phải chốt lại sổ.

## 10. Ranh giới server và client

Các hằng số hôm nay được client component import thẳng. Setting nằm trong DB nên client không đọc
được, phải nhận qua props từ server page. Danh sách chỗ phải sửa:

| File                                                                                                                | Đang import cứng cái gì                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/components/sessions/admin-vote-manager.tsx:428,750`                                                            | công thức tính tiền, sàn                                                  |
| `src/components/sessions/admin-session-card.tsx:350,531`                                                            | công thức tính tiền, sàn                                                  |
| `src/app/(admin)/admin/sessions/session-list.tsx:649,825`                                                           | như trên, đây là bản chép thứ hai                                         |
| `src/app/(public)/history/history-client.tsx:558`                                                                   | công thức tính tiền, đang thiếu sẵn `adminGuestPlayHeads` nên vốn đã lệch |
| `src/components/fund/fund-adjust-dialog.tsx:12`                                                                     | `LOW_FUND_THRESHOLD`                                                      |
| `src/app/(admin)/admin/inventory/inventory-client.tsx:84`, `src/components/inventory/stock-card.tsx:41`             | ngưỡng cầu thấp                                                           |
| `src/components/sessions/session-vote-optimistic-panel.tsx:71`, `src/components/sessions/max-players-toggle.tsx:30` | mức tối đa 8 và 16                                                        |

Điểm bơm props: `admin/sessions/page.tsx:121`, `admin/dashboard/page.tsx:312`,
`admin/sessions/[id]/page.tsx:44`, `(public)/history/page.tsx`.

Riêng `scripts/recompute-guest-sessions.ts:107,220` chạy ngoài Next nên không dùng được server
action, phải tự đọc bảng `app_settings`.

Về độ khó, `LOW_FUND_THRESHOLD` (`src/lib/fund-core.ts:134,153`) là đắt nhất vì nó nằm sau
`getFundStatus` với khoảng 20 nơi gọi. `VOTE_BLOCK_DEBT_THRESHOLD` (`:141`) ngược lại chỉ có một
nơi gọi phía server (`src/app/(public)/page.tsx:38`), nên làm trước cho dễ.

Một chi tiết dễ bỏ sót: ngưỡng cầu thấp đang dùng cho hai việc khác nhau, cảnh báo theo từng hãng
(`src/actions/inventory.ts:328`) và cảnh báo tổng kho (`:365`). Cần quyết định một setting dùng
chung hay hai setting riêng lúc lập plan.

## 11. Migration

Toàn bộ là ADD COLUMN thuần, không recreate table:

1. `sessions.settings_override` text
2. `sessions.settings_snapshot` text
3. `members.gender` text
4. `votes.guest_play_female_count`, `votes.guest_dine_female_count` integer default 0
5. `sessions.admin_guest_play_female_count`, `sessions.admin_guest_dine_female_count` integer default 0
6. `session_attendees.gender` text

Không seed dữ liệu trong migration. Sau khi chạy trên Turso phải kiểm lại `sqlite_master` xem index
còn đủ, theo bài học đã ghi trong repo.

## 12. Kiểm thử

### Unit

- `computeGroupPlayRates`: ba ví dụ ở mục 4.3, pool rỗng, nhóm cố định lớn hơn tổng chi phí, 0 người
  chơi, một nhóm 0 đầu người.
- Không đổi hành vi cũ: chạy lại toàn bộ `cost-calculator.test.ts` không sửa gì.
- Registry: parse giá trị hỏng rơi về default, giá trị thiếu rơi về default, ghi giá trị sai schema
  bị chặn.
- `resolveForSession`: override đè đúng ô, ô vắng mặt kế thừa, JSON hỏng rơi về setting chung.

### Integration

- Chốt sổ với nữ cố định: nợ và ledger khớp nhau, tổng thu bằng tổng chi cộng phần dư làm tròn.
- Chốt sổ không tính tiền nhậu vào quỹ: `total_amount`, `dine_amount`, `guest_dine_amount` của
  dòng nợ mới đều bằng 0 và `fund_deduction` không gồm nhậu.
- Member chỉ đi nhậu, không chơi: không sinh dòng nợ nào, không sinh dòng ledger nào, và vẫn hiện
  đúng trong danh sách người nhậu của buổi.
- Chốt lại sổ một buổi cũ: phần nhậu được hoàn qua `reversalOfId`, số dư về đúng, chạy hai lần
  không nhân đôi.
- Sàn member thiếu quỹ đọc số tiền từ setting.
- Override theo buổi: buổi có override tính khác buổi không có, xóa override thì về như chung.
- Reconcile sau tất cả các trường hợp trên không báo lệch.

### E2E

- Admin đổi setting rồi tạo buổi mới, buổi nhận đúng giá trị mới.
- Bật phân biệt nam nữ, màn vote mọc ô khách nữ, tắt thì mất.
- Sửa riêng một buổi, badge hiện, reset về chung chạy đúng.

E2E dùng DB riêng `file:e2e/local.db`, tuyệt đối không chạy vào DB thật vì `.env.local` đang trỏ
production. `e2e/admin.spec.ts:57` phụ thuộc dữ liệu có sẵn trong file DB đó.

### Test hiện có sẽ đỏ và phải cập nhật

Những file này đang chốt cứng các con số sắp thành setting. Đổi hằng số thành setting mà không đụng
chúng là đỏ ngay:

| File                                                                          | Chốt cứng cái gì                          |
| ----------------------------------------------------------------------------- | ----------------------------------------- |
| `src/lib/fund-core.test.ts:19,26,31`                                          | 100.000                                   |
| `src/lib/inventory-core.test.ts:12,15,29-40`                                  | 12 quả và biên `isLowStock`               |
| `src/lib/cost-calculator.test.ts:100,213,233,838,884,924,1196,1214`           | 60K cho cả hai luật sàn                   |
| `src/actions/finalize-min-deduction.integration.test.ts:180,222,233,308,408`  | 23K, 37K, 60K                             |
| `src/actions/finalize-admin-guest-income.integration.test.ts:158,167,218,279` | 47K, 201K                                 |
| `src/lib/vote-deadline.test.ts:20-39`                                         | offset 4 tiếng                            |
| `src/actions/vote-deadline.integration.test.ts:223`                           | chỉ chấp nhận 2h và 24h                   |
| `src/actions/submit-vote.integration.test.ts:54,159-265`                      | ngầm phụ thuộc mặc định 16, không có ca 8 |

Nhóm test dính tới nhậu: `src/lib/fund-integration.test.ts:83`,
`src/actions/finalize-edge-cases.integration.test.ts:97,134,308`,
`src/actions/finalize-auto.integration.test.ts:250`, `src/lib/finance-summary.test.ts:80`.

Cách làm đúng: đổi các test này sang dùng giá trị mặc định lấy từ registry thay vì viết số. Riêng
`cost-calculator.test.ts` là ngoại lệ, nó phải xanh nguyên trạng theo mục 4.4, vì đó là bằng chứng
thuật toán mới không đổi hành vi cũ.

## 13. Cổng verify trước khi báo xong

```
npx tsc --noEmit      # package.json không có script typecheck riêng
pnpm lint             # "lint": "eslint"
pnpm test             # "test": "vitest run"
pnpm build            # "build": "next build"
pnpm db:clone-local   # dựng DB local cho e2e, đọc scripts/clone-db-local.mjs trước khi chạy lần đầu
pnpm test:e2e         # "test:e2e": "playwright test", phải build trước
```

`next.config.ts` không tắt kiểm tra kiểu lúc build nên `pnpm build` là cổng type thật. Phải đọc
exit code trực tiếp của từng lệnh, không kết luận xanh từ output đã qua pipe.

Husky chỉ chạy lint-staged và commitlint, không có cổng typecheck hay test tự động, nên không được
dựa vào hook để yên tâm.

Chạy baseline trước khi sửa gì. Ghi nhận sẵn có 4 test e2e nhóm đăng nhập công khai đang đỏ từ
trước, không liên quan tới việc này.

Thay đổi đụng tiền nên trước khi merge phải chạy reviewer bất biến tài chính và skill
`reconcile-check`.

## 14. Chia giai đoạn

Bốn giai đoạn, mỗi giai đoạn tự đứng được và chạy hết cổng verify trước khi sang bước sau.

1. Hạ tầng: registry, resolver, hai cột JSON, page Settings với các mục không đụng tiền (mặc định
   buổi mới, ngưỡng, vận hành), dời card dashboard sang. Bắt đầu bằng `VOTE_BLOCK_DEBT_THRESHOLD`
   vì nó chỉ có một nơi gọi, để chạy thử toàn bộ đường dây registry với rủi ro thấp nhất.
2. Luật vote và panel sửa riêng theo buổi.
3. Chính sách chia tiền theo nhóm cộng giới tính, kèm cột `settings_snapshot` và việc đóng băng cấu
   hình lúc chốt sổ. Đây là giai đoạn nặng nhất về kiểm thử.
4. Nhậu thôi trừ quỹ, ô nhập tiền nhậu, nút chốt lại sổ buổi cũ, cùng năm chỗ phải sửa kèm ở mục 5.4.

Giai đoạn 3 và 4 đều đụng tiền thật nên tách riêng, không gộp vào một lần merge. Mỗi giai đoạn chạy
đủ cổng verify và `reconcile-check` trước khi sang bước sau.

## 15. Ngoài phạm vi

- Không gỡ bỏ tiền nhậu khỏi hệ thống, chỉ tách nó ra khỏi quỹ.
- Không hoàn hàng loạt phần nhậu của buổi cũ.
- Không đổi cách tính tiền sân và tiền cầu.
- Không đụng luồng đăng nhập, duyệt thành viên, hay tự nhận tiền chuyển khoản.
