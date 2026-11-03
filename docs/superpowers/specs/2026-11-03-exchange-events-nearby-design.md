# Giao lưu cầu lông quanh đây: thiết kế

Ngày: 3/11/2026. Trạng thái: user duyệt 3/11/2026 ("ok, làm đi"). User chọn phương án A cho người ngoài và đồng ý bộ chặn clone có đăng nhập Zalo.

## 1. Ý định

Nhóm hiện chỉ quản lý buổi chơi nội bộ. User muốn mở rộng để:

- người mở sân đăng **buổi giao lưu** (thiếu người, muốn tìm đối, mở thêm slot cho người ngoài);
- người chơi **tìm buổi giao lưu quanh vị trí mình**, xem trên bản đồ, mở chỉ đường;
- có **danh bạ sân** quanh đây, học theo cách ALOBO trình bày danh sách sân.

Ràng buộc gốc của user: **ưu tiên lib và công cụ free**.

Thực tế hiện nay (tham khảo): các CLB đăng giao lưu trên Reclub/Zalo với các trường giờ, địa chỉ + link bản đồ, phí/người (vd 80K, ghi kèm loại cầu), tổng slot (vd 24), trình độ (TB- đến TB+), host. Đăng ký thì vào nhóm Zalo xin slot, thanh toán ngoài. ALOBO (app đặt sân) cho tìm sân theo vị trí, môn và giờ, xem đánh giá, gần đây có thêm "Find social nearby". Phần mình làm tốt hơn: đăng ký, duyệt và tính phí ngay trong app, không phải nhắn Zalo qua lại.

## 2. Mục tiêu / Không làm / Thất bại nếu

**Mục tiêu**
- Mở một buổi giao lưu dưới 1 phút trên điện thoại.
- Tìm buổi gần mình: danh sách theo khoảng cách và bản đồ, bấm 1 lần là mở Google Maps chỉ đường.
- Phí giao lưu hỗ trợ: cố định theo người mở, cố định tách nam/nữ, chia đều, chia có ưu đãi nữ.
- Người đăng ký luôn thấy rõ mình sẽ trả bao nhiêu (dự kiến trước, số chốt sau).

**Không làm (giai đoạn này)**
- Đặt sân với chủ sân, xem sân trống theo giờ thực (đó là việc của ALOBO, mình không sở hữu sân).
- Thanh toán trong app qua cổng thanh toán. Chỉ hiện QR VietQR của người mở để chuyển khoản.
- Nhiều nhóm/CLB riêng biệt có admin riêng (multi-tenant).
- Chat thời gian thực (thay bằng bình luận + link nhóm Zalo, 4.6f), thông báo đẩy.
- Quãng đường theo đường bộ (chỉ tính đường chim bay).

**Thất bại nếu (dù chạy được)**
- Tiền giao lưu lọt vào sổ quỹ nhóm (ledger), hoặc làm lệch số dư member, hoặc reconcile I8 báo lỗi.
- Người đăng ký bị tính tiền khác với số đã hiện cho họ mà không được báo.
- Lộ sđt/email/vị trí người dùng ra trang công khai.
- Trang bản đồ làm cháy quota Turso (polling, quét bảng lớn).

## 3. Ràng buộc

- Stack sẵn có: Next.js 16, Drizzle + Turso, react-query, nuqs, zod, next-intl, framer-motion. Đọc `node_modules/next/dist/docs/` trước khi code.
- Mọi tiền là **số nguyên VND**, làm tròn lên bằng `roundToThousand`.
- Mọi thao tác có optimistic UI qua `fireAction`.
- Mobile-first: bottom sheet, nút chính dính đáy, vùng chạm ≥ 44px, chữ ≥ 16px.
- Migration chỉ DDL, chỉ thêm (additive). `.env.local` trỏ DB PROD: test bằng e2e/local.db, KHÔNG `db:push`.
- Không polling định kỳ trên trang tìm kiếm (bài học quota Turso 2/11).

## 4. Phần đã chốt

### 4.1 Công cụ (user yêu cầu free; chọn cụ thể là quyết định của mình)

| Việc | Chọn |
|---|---|
| Bản đồ | MapLibre GL JS + `react-map-gl/maplibre`, tile OpenFreeMap (không key, không giới hạn, dùng thương mại được). Nạp lười, `ssr:false`. Ghi "© OpenStreetMap contributors" |
| Chỉ đường / xem trên Maps | Link `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` |
| Toạ độ sân | Dán link Google Maps (server tách lat/lng, link rút gọn thì đi theo redirect), hoặc kéo ghim trên bản đồ |
| Geocode chữ (phụ) | Nominatim ở server, chỉ khi lưu sân, tối đa 1 lần/giây, kết quả lưu vào DB |
| Vị trí người dùng | `navigator.geolocation`; bị từ chối hoặc không hỗ trợ (Zalo/Messenger) thì gõ địa chỉ/khu vực hoặc kéo bản đồ (xem 4.2) |
| Khoảng cách | haversine trong `src/lib/geo.ts`, hàm thuần, có unit test |
| QR chuyển khoản | `src/lib/vietqr.ts` và `payment-qr.tsx` đã có, dùng lại |

### 4.2 Danh bạ sân (học theo ALOBO)

Danh bạ sân là bảng **mới** `venues`, không mở rộng `courts`. Đây là quyết định của mình: `courts` đang chứa giá thuê tháng riêng của nhóm (`pricePerSession NOT NULL`), không có nghĩa với sân người khác đề xuất và không được lộ ra ngoài. Đổi `NOT NULL` trên SQLite phải dựng lại bảng, dễ rụng index. `courts` chỉ thêm cột `venue_id` (nullable) để nối sân của nhóm với danh bạ. Admin nối tay, và khi đó sân của nhóm mới hiện công khai, chỉ với các trường của `venues`.

Mỗi sân hiện thẻ: tên, địa chỉ, khoảng cách "~2,3 km", số sân, giá thuê tham khảo/giờ, giờ mở cửa, tiện ích (gửi xe, điều hoà, bán cầu, cho thuê vợt, nước, tắm), sđt chủ sân (để gọi đặt sân, đây là thông tin kinh doanh công khai), nút "Chỉ đường", và số buổi giao lưu sắp diễn ra tại sân.

Bộ lọc: khoảng cách (3/5/10/20 km), tiện ích, đang có giao lưu. Không dùng danh sách quận/huyện cố định vì cấp huyện đã bỏ từ 2025 và repo không có dữ liệu tâm quận. Khi không có GPS, người dùng gõ địa chỉ/khu vực (Nominatim ở server, có cache và giới hạn tần suất) hoặc kéo bản đồ, và lấy tâm bản đồ làm điểm tìm. `area_label` của sân là chữ tự do lấy từ kết quả geocode, chỉ để hiển thị. App không giới hạn thành phố. Sắp xếp: gần nhất (mặc định), nhiều giao lưu nhất.

Ai thêm sân: member đã duyệt được **đề xuất** sân. Admin **duyệt** thì sân mới hiện công khai. Admin sửa/ẩn được. Đây là quyết định của mình: chống sân rác/trùng. Lúc đề xuất, server cảnh báo nếu đã có sân cách < 100 m.

Ảnh sân: không làm ở giai đoạn này (cần nơi lưu file). Ô "link ảnh/fanpage" để thay tạm.

### 4.3 Buổi giao lưu

**Ai mở:** mọi member đã duyệt (gọi là **host**). Admin xem, ẩn hoặc huỷ được mọi buổi.

**Trường thông tin:** sân (chọn từ danh bạ), ngày, giờ bắt đầu-kết thúc, tiêu đề, mô tả, trình độ min-max (dùng `SKILL_LEVELS`), tổng slot, slot nữ tối thiểu/tối đa (tuỳ chọn, vd "cần 2 nữ"), loại cầu (chữ tự do), cách phí (4.4), hạn đăng ký, hạn huỷ không bị tính phí, duyệt tay hay tự duyệt, có cho dắt thêm người không (+1, tối đa 2).

**Trạng thái buổi:** `open` → `full` (tự động khi đủ slot) → `locked` (host chốt phí) → `done`; hoặc `cancelled` từ bất kỳ trạng thái nào trước `done`. Từ `full` tự về `open` khi có người huỷ.

**Đăng ký:** phải đăng nhập (dùng auth hiện có). Trạng thái: `pending` → `approved` / `rejected`; `waitlist` khi hết slot; `cancelled` (tự huỷ), `late_cancelled` (huỷ sau hạn), `no_show` (host đánh dấu). Mỗi đăng ký ghi người đăng ký + số người đi kèm, mỗi người có giới tính (để tính phí và slot nữ).

**Danh sách chờ:** có người huỷ thì người đầu danh sách chờ tự được đẩy lên `pending` (hoặc `approved` nếu buổi tự duyệt). Việc đẩy này nằm trong cùng `db.transaction` với thao tác huỷ.

**Cách tính slot (quyết định của mình):**
- Mỗi đầu người chiếm 1 slot, kể cả người đi kèm. `male_count` và `female_count` của một đăng ký đã gồm người đăng ký và người đi kèm, nên đủ để tính phí và slot nữ (không cần lưu từng người đi kèm).
- Host đặt `female_reserved_slots` (tuỳ chọn): số slot **giữ riêng cho nữ**. Nam chỉ được vào tối đa `slots_total - female_reserved_slots`. Phần còn lại thì nam vào danh sách chờ dù tổng chưa đầy. Tới `reserve_release_at` (mặc định bằng hạn đăng ký), slot giữ chưa ai lấy sẽ mở cho mọi người, và danh sách chờ được xét lại. Bỏ ý "slot nữ tối đa".
- Buổi là `full` khi không còn slot nào mà người đăng ký kế tiếp vào được.
- Đẩy người từ danh sách chờ theo kiểu **first-fit**: xét theo thứ tự, ai vừa đủ chỗ (cả số đầu lẫn ràng buộc slot nữ) thì được lên. Người không vừa vẫn giữ nguyên vị trí. Không nhận một phần nhóm.

**Đếm slot an toàn:** đếm và ghi trong cùng `db.transaction` để 2 người không cùng giành slot cuối. UNIQUE `(event_id, member_id)` để bấm 2 lần không tạo bản ghi trùng.

**Trình độ:** ngoài khoảng min-max thì chỉ **cảnh báo** người đăng ký và đánh dấu cho host thấy, không chặn. Đây là quyết định của mình, vì trình độ tự khai không chính xác.

### 4.4 Phí giao lưu

Host chọn 1 trong 4 cách:

| Cách | Host nhập | Mỗi người trả |
|---|---|---|
| Cố định | X/người | X |
| Cố định nam/nữ | X nam, Y nữ | X hoặc Y |
| Chia đều | tổng chi phí dự kiến (sân + cầu + khác) | tổng / số người, làm tròn lên 1K |
| Chia ưu đãi nữ | tổng chi phí + nữ trả P% hoặc cố định Y | theo engine nhóm |

**Không viết công thức mới.** Cả 4 cách quy về `computeGroupPlayRates` trong `src/lib/group-policy.ts`, dùng 2 nhóm `member` (nam/chưa khai) và `memberFemale`, các nhóm còn lại 0 đầu:

- Cố định: `member` fixed X, `memberFemale` fixed X.
- Cố định nam/nữ: fixed X và fixed Y.
- Chia đều: cả hai `equal`.
- Ưu đãi nữ: `member` equal, `memberFemale` percent P hoặc fixed Y (capAtEqual true).

Hàm bọc `computeExchangeFees` nằm trong `src/lib/exchange-fee.ts`: hàm thuần, map cách phí sang policy rồi gọi engine. Unit test phủ đủ 4 cách và các trường hợp biên (0 người, toàn nữ, 1 người).

Quy tắc giới tính khớp app hiện tại: chưa khai xếp vào nhóm nam (thà tính đủ), LGBT tính như nam.

**Dự kiến và chốt:**
- Với cách cố định: số tiền biết ngay, hiện luôn.
- Với cách chia: host **bắt buộc** nhập `min_heads` ("buổi diễn ra khi có ít nhất N người", 1 ≤ N ≤ tổng slot), và tỉ lệ nam/nữ giả định là toàn nam (thà tính đủ). **Mức tối đa** = phí tính bằng engine với N đầu nam. Người đăng ký thấy: "tối đa X/người (khi có N người), hiện tại Y/người với M người đã duyệt". Đây là quyết định của mình.
- Nếu số người thật thấp hơn N, phí chốt có thể vượt mức tối đa. App vẫn cho chốt nhưng bắt host xác nhận lại, và hiện dòng "phí cao hơn dự kiến vì thiếu người" cho người tham gia. Host cũng có thể huỷ buổi.
- Host bấm **Chốt phí** (`locked`): server tính lại từ dữ liệu trong DB (không tin số client gửi), ghi `fee_amount` (số nguyên) vào từng đăng ký `approved`. Sau khi chốt, đổi người phải mở khoá lại và chốt lại.
- Nếu số chốt cao hơn mức tối đa đã hiện lúc đăng ký, app vẫn chốt nhưng hiện cảnh báo cho host trước khi xác nhận.

**Người không đến / huỷ muộn:** host chọn khi chốt phí: vẫn tính phí (mặc định với `no_show`, `late_cancelled`) hoặc miễn. Người được miễn không tính vào số đầu chia.

**Thu tiền:** hoàn toàn ngoài sổ quỹ nhóm. Mỗi đăng ký có cờ `paid` + `paid_at` do host đánh dấu (optimistic). Trang đăng ký hiện QR VietQR với tài khoản nhận tiền của host và đúng số tiền, nội dung chuyển khoản có mã đăng ký.

Tài khoản nhận tiền nằm **trên từng buổi** (`payout_bank_bin`, `payout_account_no`, `payout_account_name`). Form mở buổi điền sẵn từ buổi gần nhất của host đó. Đây là quyết định của mình: KHÔNG dùng `members.bankAccountNo` vì cột đó unique và đang được `payment-matcher` dùng để nhận diện người chuyển khoản vào quỹ nhóm. KHÔNG dùng tài khoản của nhóm trong settings. Chọn ngân hàng bằng danh sách sẵn có ở `src/lib/vn-banks.ts`. Không điền tài khoản thì không hiện QR, chỉ hiện "thanh toán trực tiếp với host". **KHÔNG** ghi `financial_transactions`, **KHÔNG** đụng `sessionDebts`. Nếu sau này muốn nối với quỹ nhóm thì đó là việc riêng, bắt buộc qua finance-invariant-reviewer.

### 4.5 Tìm quanh đây

- Trang `/giao-luu` (công khai, chỉ đọc): danh sách thẻ theo khoảng cách và nút chuyển sang bản đồ. Bộ lọc lưu trên URL bằng nuqs: ngày, khung giờ (sáng/chiều/tối), bán kính, trình độ, còn slot, còn slot nữ, mức phí tối đa.
- Bản đồ: ghim theo sân (một sân có nhiều buổi thì gom một ghim kèm số). Bấm ghim thì mở bottom sheet liệt kê buổi.
- Truy vấn: server nhận lat/lng/bán kính, lọc khung `lat BETWEEN ... AND lng BETWEEN ...` trên index, chỉ lấy buổi `open|full` có giờ bắt đầu ≥ bây giờ, tối đa 50. Sau đó tính haversine, lọc đúng bán kính và sắp xếp trong JS.
- react-query `staleTime` 60s, chỉ gọi lại khi đổi bộ lọc hoặc dừng kéo bản đồ (debounce). Không `refetchInterval`.
- Vị trí người dùng chỉ đi theo request, không lưu DB, không ghi log.

### 4.6 Riêng tư

- Payload công khai chỉ gồm các cột trong whitelist: host hiện tên/nickname/avatar, KHÔNG sđt/email.
- Danh sách người tham gia: công khai chỉ hiện số lượng và avatar. Tên đầy đủ chỉ người đã đăng ký và host thấy.
- Liên hệ host (Zalo/sđt nếu host điền) chỉ hiện cho đăng ký đã `approved`.
- Giới hạn tần suất đăng ký và tạo buổi bằng `rateLimitBuckets`.

### 4.6b Tài khoản giao lưu cho người ngoài (user chọn phương án A, 3/11/2026)

User chốt: người lạ đăng nhập bằng FB, Google hoặc email là dùng giao lưu được ngay, không cần admin duyệt. Họ chỉ vào được phần giao lưu, danh bạ sân và trang cá nhân, không thấy quỹ, nợ, vote của nhóm. Khách chưa đăng nhập xem được danh sách và bản đồ, chỉ cần đăng nhập khi bấm đăng ký.

Cách làm (quyết định của mình):
- Không tạo bảng tài khoản mới. Người lạ vẫn là một dòng `members` với `approvalStatus = "pending"`, như luồng đăng ký hiện tại. **Quyền giao lưu** = `isActive && approvalStatus !== "rejected"`. **Quyền nhóm** giữ nguyên = `approved`.
- Thêm cột `members.signup_intent` (`group|exchange`, mặc định `group`). Đăng nhập lần đầu từ trang giao lưu thì ghi `exchange`. Danh sách chờ duyệt của admin mặc định ẩn `exchange` (có tab riêng để xem), để hàng chờ không bị người lạ làm đầy. Người dùng giao lưu có nút "Xin vào nhóm", bấm thì đổi sang `group` và vào hàng chờ như bình thường.
- Route group mới `(exchange)` có layout riêng: không có `PendingApprovalGate`, vẫn giữ màn chặn tài khoản bị khoá/từ chối và `ForceChangePasswordGate`. Thanh điều hướng của tài khoản `pending` chỉ có Giao lưu, Sân, Cá nhân.
- `/me` cho tài khoản `pending` chỉ hiện hồ sơ và "Giao lưu của tôi", ẩn quỹ, nợ, lịch sử chơi.
- Ai được **mở buổi**: vẫn chỉ member `approved` (quyết định 2 ở mục 6). Người ngoài chỉ đăng ký.
- **Bắt buộc rà trước khi mở cho người ngoài:** liệt kê mọi server action và API route đọc `getUserFromCookie` rồi xác nhận từng cái kiểm tra `approved` trước khi trả hay ghi dữ liệu nhóm (vote, quỹ, nợ, lịch sử, stats). Hiện layout đang chặn ở tầng giao diện, nhưng server action gọi thẳng được nên không dựa vào layout. Cái nào thiếu thì thêm kiểm tra, kèm test. Vì rủi ro lộ dữ liệu này, bước rà được làm ở đầu G2, trước mọi màn giao lưu cần đăng nhập.
- API tìm kiếm công khai (không đăng nhập) có giới hạn tần suất theo IP bằng `rateLimitBuckets`.
- Fund roster chỉ tính member `approved` (đã như vậy), nên người ngoài không lọt vào quỹ. Builder kiểm lại bằng test.

### 4.6c Chống nick ảo, uy tín, trình độ (user yêu cầu 3/11/2026)

User yêu cầu: chặn clone, nick ảo, bot gửi form bằng tool, tấn công qua mạng; có đánh giá tài khoản, độ uy tín, trình độ; có đánh giá sân.

Nguyên tắc (quyết định của mình): không có cách free nào chặn 100% nick ảo (OTP SMS tốn tiền). Thay vào đó, **uy tín chỉ đến từ việc gặp mặt thật**: người mở buổi điểm danh có mặt. Nick mới tạo ra không có lịch sử, nên không tự đánh bóng được và không chấm điểm được ai.

**Lớp chặn nick ảo**
- Người ngoài đăng nhập bằng **Zalo** (nút chính), FB hoặc Google. Luồng giao lưu không có đăng ký email + mật khẩu. Mỗi nick Zalo/FB/Google chỉ gắn được 1 tài khoản (UNIQUE). User đồng ý 3/11/2026 và sẽ tự đăng ký app trên developers.zalo.me. Zalo dùng OAuth v4 có PKCE (`oauth.zaloapp.com/v4/permission`, `/v4/access_token`, hồ sơ ở `graph.zalo.me/v2.0/me`). Chưa xác nhận Zalo có trả số điện thoại không: có thì lưu để chống trùng (UNIQUE theo số đã chuẩn hoá), không có thì chỉ dùng mã người dùng Zalo. Lưu trong `memberOauthIdentities` với provider `zalo`, theo cách FB/Google đang làm.
- **Người giới thiệu:** member có ≥ 3 buổi đã điểm danh và tỉ lệ đến ≥ 80% được giới thiệu tối đa 5 người/tháng. Người được giới thiệu không bị giới hạn nick mới. Nếu người được giới thiệu không đến hoặc huỷ muộn ≥ 2 lần trong 30 ngày đầu, người giới thiệu mất quyền giới thiệu 30 ngày (không trừ điểm hiển thị, quyết định của mình cho đơn giản).
- **Đặt cọc (host tự bật):** host đặt `deposit_amount` (số nguyên VND, ≤ phí dự kiến tối đa). Đăng ký ở trạng thái `pending` cho tới khi host xác nhận đã nhận cọc qua QR. Cọc được trừ vào phí lúc chốt (`fee_amount` vẫn là tổng phải trả, thêm cột `deposit_paid`). Buổi bị host huỷ thì host phải trả lại cọc ngoài app, app ghi chú rõ điều này. Tất cả nằm ngoài sổ quỹ nhóm.
- Cloudflare Turnstile ở mọi thao tác ghi của luồng giao lưu (xem 4.6e).
- Nick có 0 buổi đã điểm danh: tối đa 2 đăng ký đang chờ cùng lúc, không được dắt thêm người, không đề xuất sân, không đánh giá.
- Người mở buổi chặn được một người khỏi các buổi của mình. Ai cũng báo cáo được (người, buổi, sân, đánh giá). Admin khoá tài khoản thì khoá luôn mọi FB/Google gắn với tài khoản đó.
- Dùng lại cơ chế phát hiện member trùng (`dupIgnoredPairs`) để cảnh báo admin.

**Uy tín người chơi** (tính từ dữ liệu, không có điểm sao)
- Số buổi đã đến (đã điểm danh), tỉ lệ đến = đến / được duyệt, số lần huỷ muộn, số lần không đến, trả tiền đúng hạn (cờ `paid` trước giờ bắt đầu + 24h).
- Sau buổi, người cùng được điểm danh bấm được "Muốn chơi lại cùng" và chọn tag khen (đúng giờ, vui vẻ, fair play, đánh đẹp). Góp ý xấu đi qua báo cáo riêng, không hiện công khai.
- Hồ sơ nick 0 buổi hiện nhãn "Mới".

**Uy tín người mở buổi:** số buổi đã tổ chức, tỉ lệ huỷ buổi, và người tham gia chấm 2 câu có/không sau buổi ("Buổi đúng như mô tả?", "Phí đúng như đã báo?").

**Trình độ:** giữ trình độ tự khai. Sau buổi, người cùng được điểm danh chấm trình độ của nhau theo `SKILL_LEVELS`. Hồ sơ hiện "Tự khai: X · Người chơi cùng đánh giá: Y (n lượt)". Chỉ hiện khi có ít nhất 3 người chấm khác nhau, lấy trung vị. Danh tính người chấm không công khai.

**Chống clone khen nhau (dùng cho cả người, người mở buổi, sân):**
- Chỉ người được điểm danh cùng một buổi mới chấm nhau được, mỗi cặp tối đa 1 lần mỗi buổi, trong 7 ngày sau buổi.
- Mỗi lượt chấm có trọng số theo uy tín của người chấm: `min(1, số buổi đã đến / 5)`, nên nick 1 buổi chỉ nặng 0,2.
- Host không được điểm danh cho chính mình. Một host điểm danh cho cùng một nhóm người lặp lại nhiều lần thì gắn cờ cho admin xem (chống host ảo tự dựng buổi cho clone).

### 4.6d Đánh giá sân

- **Ai được đánh giá:** chỉ tài khoản có ít nhất 1 lần **được điểm danh tại sân đó**: buổi giao lưu ở sân đó, hoặc buổi của nhóm tại `courts` đã nối `venue_id`. Đánh giá hiện nhãn "Đã chơi ở đây".
- Mỗi tài khoản 1 đánh giá cho mỗi sân, sửa được nhưng tối đa 1 lần mỗi 30 ngày.
- Chấm 1-5 theo 6 tiêu chí: mặt sân, ánh sáng, thoáng mát, giá, gửi xe, chủ sân. Có thêm nhận xét tối đa 500 ký tự, không có ảnh.
- Nhận xét có số điện thoại, link hoặc từ trong danh sách cấm thì giữ lại chờ admin duyệt (chặn quảng cáo, chặn chửi bới).
- Điểm hiển thị là trung bình có trọng số (trọng số như 4.6c), kéo về mức trung bình chung khi có ít lượt (Bayes với 5 lượt ảo). Dưới 3 lượt thì hiện "Chưa đủ đánh giá".
- **Phát hiện bất thường:** một sân nhận ≥ 5 đánh giá trong 24h, hoặc phần lớn đánh giá đến từ nick dưới 3 buổi, thì đánh giá mới của sân đó tự vào hàng chờ admin duyệt.
- Báo cáo đánh giá: đủ 3 báo cáo thì đánh giá tạm ẩn chờ admin xem.

### 4.6e Chống bot và tấn công qua mạng (công cụ free)

- **Cloudflare Turnstile** (free tối đa 20 widget): token được kiểm ở server, qua `siteverify`, **trước mọi truy cập DB**, ở các thao tác: đăng nhập lần đầu từ luồng giao lưu, đăng ký buổi, mở buổi, đề xuất sân, đánh giá, báo cáo. Token chỉ dùng 1 lần. Không gọi được Cloudflare thì từ chối (fail-closed) và báo lỗi cho người dùng. Thiếu secret Turnstile lúc khởi động thì app báo lỗi luôn, không chạy tiếp âm thầm.
- **Bảo vệ quota Turso khi bị dội request:** bot bị chặn ở Turnstile trước khi chạm DB. Trang công khai (`/giao-luu`, `/san`) đọc qua cache của Next (lưu theo ô lưới toạ độ làm tròn + bộ lọc, khoảng 60s), nên nhiều request giống nhau không xuống DB. `rateLimitBuckets` chỉ dùng cho người đã đăng nhập (vì nó cũng ghi DB).
- **Vercel Firewall:** bật Attack Challenge Mode khi bị tấn công. Thêm 1 luật rate limit theo IP cho `/api/` và trang tìm kiếm (bản Hobby cho tối đa 3 luật tuỳ chỉnh; số luật rate limit của Hobby phải kiểm lại trên dashboard). Chống DDoS mức nền tảng là của Vercel, tự bật sẵn.
- **Server action:** dùng lớp chặn CSRF có sẵn của Next (kiểm Origin). Mọi input qua zod, có giới hạn độ dài chuỗi, giới hạn kích thước body. Thao tác ghi có `idempotencyKey`.
- **Chống cào dữ liệu:** hồ sơ người chơi và buổi dùng mã công khai ngẫu nhiên (không lộ id tự tăng để đoán lần lượt). Mỗi trang tối đa 50 dòng. Payload công khai đi qua whitelist cột.
- **Lưu IP:** chỉ lưu HMAC của IP (có salt bí mật) để đếm và chống lạm dụng, xoá sau 30 ngày. Không lưu IP thô, không ghi log IP kèm dữ liệu cá nhân.

### 4.6f Thảo luận trong buổi (user yêu cầu 3/11/2026: "kênh chat riêng hoặc comment bên dưới, giống reddit")

Quyết định của mình: làm **bình luận dạng Reddit**, không làm chat thời gian thực. Chat thật cần kết nối giữ liên tục (websocket). Serverless trên Vercel không giữ được, còn dịch vụ ngoài thì bản free giới hạn nhỏ. Làm chat bằng cách hỏi lại server vài giây một lần sẽ làm cháy quota Turso (bài học 2/11). Trong khi đó người chơi cầu đã quen chat Zalo, nên buổi có ô **link nhóm Zalo** (tuỳ chọn): host dán vào, chỉ người đã được duyệt mới thấy.

**Hai khu bình luận trên mỗi buổi**
- **Hỏi đáp** (công khai): ai cũng đọc được, người đã đăng nhập thì viết được. Dùng để hỏi "còn slot nữ không", "cầu gì".
- **Nhóm buổi** (chỉ host và người được duyệt): bàn chuyện đi chung xe, ghép cặp, thông báo đổi sân.

**Cách hoạt động**
- Trả lời lồng tối đa 2 tầng. Trả lời sâu hơn thì gắn vào tầng 2 kèm "@tên", giống Reddit trên điện thoại.
- Có nút "Hữu ích" (upvote, mỗi người 1 lần). Sắp xếp theo hữu ích hoặc mới nhất. Host ghim được 1 bình luận lên đầu và khoá được khu bình luận.
- Sửa trong 10 phút sau khi gửi, có nhãn "đã sửa". Xoá là xoá mềm, hiện "[đã xoá]" để luồng trả lời không gãy. Host xoá được bình luận trong buổi của mình, admin xoá được tất cả.
- Mỗi bình luận tối đa 1.000 ký tự, chỉ chữ, không ảnh. Hiện chữ thuần, không render HTML/markdown (chặn chèn mã độc). Link hiện dạng chữ, không bấm được.
- Không polling. Tải khi mở trang và khi người dùng quay lại tab, có nút "Tải bình luận mới". "Giao lưu của tôi" hiện số bình luận mới kể từ lần xem trước, tính lúc mở trang.

**Chống spam bình luận**
- Kiểm Turnstile ở bình luận đầu tiên của mỗi phiên, giới hạn tần suất theo tài khoản (vd 1 bình luận/10 giây, 30 bình luận/ngày). Nick 0 buổi chỉ được 5 bình luận/ngày.
- Bình luận có số điện thoại hoặc link thì giữ lại chờ host/admin duyệt (trừ khu "Nhóm buổi").
- Báo cáo bình luận: đủ 3 báo cáo thì tạm ẩn. Người bị host chặn (`host_blocks`) không bình luận được ở buổi của host đó.

### 4.7 Dữ liệu (migration chỉ thêm)

- `venues` (mới): `name`, `address`, `area_label`, `lat REAL NOT NULL`, `lng REAL NOT NULL`, `map_link`, `court_count INTEGER`, `open_hours TEXT`, `amenities TEXT` (JSON mảng mã cố định), `phone TEXT`, `ref_price_per_hour INTEGER`, `photo_link TEXT`, `status` (`pending|approved|hidden`), `submitted_by_member_id`, timestamps, index `(status, lat, lng)`. Toạ độ dùng số thực là đúng (không phải tiền).
- `courts` thêm đúng một cột `venue_id` (nullable, FK `venues`).
- `members` thêm `signup_intent TEXT NOT NULL DEFAULT 'group'` (xem 4.6b) và `public_code TEXT UNIQUE` (mã hồ sơ công khai, 4.6e).
- `exchange_registrations` thêm `checked_in` (host điểm danh), `checked_in_at`.
- `peer_feedback` (G4): `event_id`, `from_member_id`, `to_member_id`, `play_again`, `tags` (JSON mã cố định), `skill_level`, `created_at`. UNIQUE `(event_id, from_member_id, to_member_id)`.
- `host_feedback` (G4): `event_id`, `from_member_id`, `as_described`, `fee_as_promised`. UNIQUE `(event_id, from_member_id)`.
- `venue_reviews` (G4): `venue_id`, `member_id`, 6 cột điểm 1-5 (CHECK), `comment`, `status` (`visible|held|hidden`), `report_count`, `updated_at`. UNIQUE `(venue_id, member_id)`.
- `abuse_reports`: `reporter_member_id`, `target_type`, `target_id`, `reason`, `status`, `created_at`.
- `host_blocks`: `host_member_id`, `blocked_member_id`, UNIQUE cặp.
- `exchange_comments`: `event_id`, `channel` (`qa|group`), `parent_id` (nullable), `reply_to_member_id`, `author_member_id`, `body`, `status` (`visible|held|deleted|hidden`), `upvotes INTEGER`, `pinned`, `edited_at`, `created_at`. Index `(event_id, channel, created_at)`.
- `exchange_comment_votes`: `comment_id`, `member_id`, UNIQUE cặp.
- `exchange_comment_reads`: `event_id`, `member_id`, `last_read_at`, UNIQUE cặp.
- `exchange_events` thêm `zalo_group_link`, `comments_locked`.
- `exchange_events`: các trường ở 4.3 và 4.4 (`fee_mode`, `fee_amount_male`, `fee_amount_female`, `fee_female_percent`, `estimated_total_cost`, `min_heads`, `female_reserved_slots`, `reserve_release_at`, `payout_bank_bin`, `payout_account_no`, `payout_account_name`), `host_member_id`, `venue_id`, `status`, `locked_at`, timestamps. Index `(status, start_at)`, `(court_id, start_at)`.
- `exchange_registrations`: `event_id`, `member_id`, `status`, `male_count`, `female_count` (gồm cả bản thân), `note`, `fee_amount INTEGER NULL` (ghi lúc chốt), `fee_waived`, `paid`, `paid_at`, `waitlist_pos`, timestamps. UNIQUE `(event_id, member_id)`. CHECK tiền ≥ 0.
- Không seed dữ liệu trong migration. Sau migration kiểm `sqlite_master` xem index có đủ không (bẫy recreate-table của Turso).

### 4.8 Màn hình

1. `/giao-luu`: tìm buổi (danh sách và bản đồ).
2. `/giao-luu/[id]`: chi tiết buổi, phí dự kiến hoặc đã chốt, nút Đăng ký dính đáy, nút Chỉ đường, QR chuyển khoản (sau khi chốt).
3. `/giao-luu/mo`: form mở buổi (react-hook-form + zod), xem trước phí ngay khi nhập.
4. `/giao-luu/[id]/quan-ly`: host duyệt/từ chối, đánh dấu không đến, chốt phí, đánh dấu đã trả.
5. `/san`: danh bạ sân (thẻ, bộ lọc, bản đồ). `/san/[id]`: chi tiết sân và giao lưu sắp tới. `/san/de-xuat`: đề xuất sân.
6. Admin: duyệt sân đề xuất, ẩn buổi vi phạm.
7. `/me`: mục "Giao lưu của tôi" (đã đăng ký, đang host).

Mọi màn có skeleton, empty state có nút hành động, chuỗi đủ vi/en/zh.

### 4.9 Chia giai đoạn

1. **G1, danh bạ sân:** bảng `venues` + cột `courts.venue_id`, tách toạ độ từ link Google Maps, `geo.ts`, `/san` dạng danh sách theo khoảng cách, chỉ đường, đề xuất và duyệt sân.
2. **G2, buổi giao lưu:** rà quyền server action (4.6b) trước tiên, `signup_intent` + layout `(exchange)`, bảng mới, `exchange-fee.ts`, mở buổi, chi tiết, đăng ký/duyệt/chờ, chốt phí, đánh dấu đã trả, QR.
   G2 gồm luôn lớp chống bot (4.6e), giới hạn nick mới, điểm danh, chặn/báo cáo (dữ liệu gốc cho uy tín), và bình luận 2 khu (4.6f).
3. **G3, bản đồ:** MapLibre cho `/giao-luu` và `/san`, gom ghim, bottom sheet.
4. **G4, đánh giá:** "Muốn chơi lại cùng", tag khen, trình độ do người chơi cùng chấm, uy tín người mở buổi, đánh giá sân (4.6c, 4.6d). Cần vài tuần dữ liệu điểm danh thật thì mới có ý nghĩa.

Mỗi giai đoạn là một lần deploy riêng, qua đủ 4 cổng (typecheck đúng lệnh build, lint, test, build).

## 5. Phần để người làm tự quyết

- Tên route cụ thể, cách chia component, tên hàm.
- Cách gom ghim (tự viết theo lưới hay dùng cluster có sẵn của MapLibre).
- Giao diện chi tiết, miễn theo chuẩn mobile-first và hệ màu trong `globals.css`.
- Cách tách lat/lng từ các dạng link Google Maps (`@lat,lng`, `?q=lat,lng`, `!3d..!4d..`).

## 6. Quyết định của mình (cần user soát)

1. Phí giao lưu nằm ngoài sổ quỹ nhóm, chỉ có cờ "đã trả".
2. Mọi member đã duyệt đều mở được buổi; sân mới phải qua admin duyệt.
3. Bắt đăng nhập mới được đăng ký. Người ngoài dùng member `pending` + `signup_intent`, không có bảng tài khoản mới (4.6b).
4. Trình độ chỉ cảnh báo, không chặn.
5. Cách chia phí hiện "mức tối đa" lúc đăng ký, chốt lại theo số người thật.
6. Mặc định vẫn tính phí người không đến hoặc huỷ muộn, host được miễn.
7. Không làm ảnh sân, đặt sân, thanh toán online ở giai đoạn này.
8. Danh bạ sân là bảng `venues` riêng, giá thuê tháng của nhóm không bao giờ lộ ra.
9. Slot giữ cho nữ, mở ra cho mọi người khi tới hạn; danh sách chờ đẩy theo first-fit.
10. Cách chia bắt host nhập số người tối thiểu, "mức tối đa" giả định toàn nam.
11. Tài khoản nhận tiền nằm trên từng buổi, không dùng tài khoản đối soát của member.
12. Không có danh sách quận: gõ địa chỉ hoặc kéo bản đồ khi không có GPS.
13. Uy tín chỉ đến từ điểm danh thật; chỉ người cùng được điểm danh trong một buổi mới chấm nhau, có trọng số theo số buổi.
14. Người ngoài đăng nhập Zalo (chính), FB hoặc Google; không email + mật khẩu (user đồng ý 3/11).
15. Đánh giá sân chỉ dành cho người đã được điểm danh tại sân đó.
16. Turnstile kiểm trước mọi truy cập DB; trang công khai đọc qua cache để bot không làm cháy quota Turso.
17. Thảo luận là bình luận dạng Reddit (2 khu: Hỏi đáp công khai, Nhóm buổi riêng), không chat thời gian thực; chat thì dùng link nhóm Zalo.
18. Có người giới thiệu và đặt cọc tuỳ host (user đồng ý 3/11). Đăng nhập Zalo nằm ở G2, cần app Zalo của user trước khi bắt đầu G2.
