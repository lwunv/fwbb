# Thông báo cho member và admin: thiết kế

Ngày: 4/11/2026. Trạng thái: user duyệt 4/11/2026 (8 quyết định mục 6, điểm 5 sửa thành chỉ superadmin). Các quyết định ghi "user chốt" là user trả lời ngày 3/11/2026.

## 1. Ý định

Hiện app gần như không báo gì cho ai. Chỉ có mail quên mật khẩu, mail mời member, và một bot Messenger nhắn vào nhóm khi admin chốt sổ hoặc tạo buổi tay (chưa chắc còn chạy). Buổi tự tạo, đổi giờ, hủy buổi, xác nhận tiền, duyệt tài khoản, sân được đề xuất đều không báo cho người liên quan. Nhóm đang nhắc nhau bằng tay trong nhóm Zalo.

Hai nỗi đau user nêu trực tiếp:
- **Member quên vote.**
- **Admin không biết số người vote để quyết đặt thêm sân hay hủy sân.**

User muốn một hệ thống thông báo "chuẩn và đầy đủ" như các app và diễn đàn khác, nhất là mọi việc quanh một buổi chơi và những người liên quan buổi đó. Admin cũng phải nhận được thông báo (ví dụ có sân mới chờ duyệt). Member cần biểu tượng chuông trên header trang chủ.

Nghiên cứu nền (có nguồn): `.superpowers/synthesis.md` và `.superpowers/sweeps.json` trong worktree này (Reclub, Playtomic, Spond, TeamSnap, Heja, Meetup, Discourse, Reddit; giá Zalo OA/ZNS, Brevo, Resend, web push trên iOS, Vercel cron, Upstash QStash).

## 2. Mục tiêu / Không làm / Thất bại nếu

**Mục tiêu**
- Mọi member có chuông trên header (mọi trang member), thấy số tin chưa đọc, mở danh sách tin trên điện thoại bằng bottom sheet.
- Admin có chuông riêng trong khu admin với danh mục tin của admin.
- Member chưa vote được nhắc trước hạn vote, đúng giờ (không chỉ "sáng mỗi ngày").
- Admin được cảnh báo theo **ngưỡng số người** so với số chỗ của buổi, kèm con số và hạn chót, để quyết đặt thêm hay trả bớt sân.
- Tin bắt buộc (hủy, đổi giờ/sân, tiền, duyệt) luôn tới người liên quan.
- Email cho ai tự điền email và bật nhận.
- Admin soạn sẵn tin Zalo bằng 1 chạm để dán vào nhóm Zalo đang có.

**Không làm (giai đoạn này)**
- Zalo OA, ZNS hay bất cứ kênh trả phí nào (user chốt: "k mua nhé, free thì dùng").
- Bot tự đăng vào nhóm Zalo (Zalo không có API cho nhóm chat thường).
- Chat thời gian thực, websocket, SSE.
- Thông báo cho buổi giao lưu (thêm dần ở G2b, dùng chung hạ tầng này).

**Thất bại nếu (dù chạy được)**
- Làm cháy quota Turso: polling, quét bảng định kỳ, đếm không có index (bài học 24/10 và 2/11).
- Một sự kiện gửi trùng nhiều lần (QStash gọi lại, admin bấm hai lần, cron chạy lại).
- Tin chứa số tiền, tên hay nợ của NGƯỜI KHÁC, hoặc push hiện nội dung nhạy cảm trên màn hình khoá.
- Nhắc sai: nhắc vote cho buổi đã hủy, nhắc nợ người đã trả, nhắc lúc nửa đêm.
- Member bị tin rác tới mức tắt hết.
- Code tiền bị đổi để "tiện gửi tin".

## 3. Ràng buộc

- Stack sẵn có: Next.js 16 (đọc `node_modules/next/dist/docs/` trước khi code), Drizzle + Turso, react-query, nuqs, zod, next-intl, framer-motion, sonner, vitest, Playwright.
- Vercel Hobby: cron chạy tối đa 1 lần/ngày/job, lệch trong 59 phút.
- Migration chỉ thêm (ADD TABLE / ADD COLUMN), enum chỉ ở TypeScript. Áp migration qua `scripts/apply-migration.mjs --env=<file> --dry-run` trước (bản đã sửa ở G2a). Có DB dự phòng `fwbb-standby`: mọi migration phải áp lên cả hai DB TRƯỚC khi deploy code đọc cột/bảng mới.
- Mobile-first: vùng chạm ≥ 44px, chữ ≥ 16px, bottom sheet trên mobile, skeleton, màu từ CSS variables. Optimistic UI qua `fireAction` cho đánh dấu đã đọc, tắt thông báo.
- Không log PII; log chỉ id + mã. Không `console.log`.
- Số tiền trong tin lấy từ dòng đã ghi sổ (ledger, session_debts), không tính lại. Không sửa `cost-calculator`, `finalizeSession`, ledger.
- Chuỗi đủ vi/en/zh.

## 4. Phần đã chốt

### 4.1 Kênh gửi (user chốt 3/11)

| Kênh | Dùng | Ghi chú |
|---|---|---|
| Chuông trên site (member + admin) | **Kênh chính, luôn bật** | Nguồn sự thật; các kênh khác là bản sao |
| Email qua **Brevo** (300 mail/ngày miễn phí) + tên miền `lwcifer.io.vn` (SPF, DKIM, DMARC) | Dùng | Member **tự điền email, không bắt buộc**, ở trang cá nhân; ai không điền thì chỉ nhận chuông. User tự thêm bản ghi DNS theo hướng dẫn |
| Nút "Chia sẻ lên Zalo" | Dùng | App soạn sẵn tin (ví dụ "Còn 4 bạn chưa vote: A, B, C, D. Hạn 18h"), admin bấm 1 chạm. Chỉ dùng trong khu admin |
| Web push | Để sau (giai đoạn N3, tuỳ chọn) | Không chạy trong trình duyệt của Zalo/Messenger; iPhone chỉ khi đã cài vào màn hình chính |
| Zalo OA, ZNS, SMS | Không | Trả phí |

### 4.2 Hẹn giờ (user chốt 3/11: "dùng QStash nhé, nếu an toàn và đúng")

- **Upstash QStash** (miễn phí 1.000 tin/ngày) cho các mốc đúng giờ: khi tạo hoặc sửa buổi, app hẹn 1 lời gọi tới route nội bộ của app tại từng mốc.
- **An toàn:** route nhận lời gọi PHẢI kiểm chữ ký QStash (header `Upstash-Signature`, khoá ký hiện tại và khoá ký kế tiếp) trước mọi truy cập DB; sai chữ ký trả 401.
- **Đúng:** khi được gọi, route đọc lại trạng thái buổi (đã hủy? đã đổi giờ? `version` còn khớp?) rồi mới quyết gửi; mỗi tin có `dedup_key` nên QStash gọi lại cũng chỉ gửi 1 lần.
- **Dự phòng:** Vercel cron 1 lần/ngày (sáng sớm giờ VN) quét các mốc lẽ ra đã chạy mà chưa có tin (bằng truy vấn có index trên buổi trong 48h tới), bù tin bị lỡ, và hẹn lại QStash cho buổi xa hơn 7 ngày (QStash hẹn tối đa 7 ngày).
- Thiếu khoá QStash: app vẫn chạy, chỉ còn mốc theo cron hằng ngày, admin thấy cảnh báo cấu hình trong trang cài đặt.

### 4.3 Ngưỡng sân cho admin (user chốt 3/11)

- **Sức chứa** = `sessions.maxPlayers` của buổi (admin chọn 8, 16 hoặc tự nhập khi tạo buổi). Người chơi tính cả khách được dắt theo, đúng cách app đang đếm số người chơi của buổi.
- **Sắp đầy:** số người chơi đạt `maxPlayers - 2` → báo admin 1 lần.
- **Đầy hoặc vượt:** số người chơi ≥ `maxPlayers` → báo admin 1 lần; vượt thêm thì báo lại khi vượt mỗi 2 người (ví dụ 17/16, 19/16), kèm gợi ý "đặt thêm sân hoặc khoá vote".
- **Ít người:** tại **mốc chốt sân**, nếu số người chơi < 50% `maxPlayers` → báo admin "có thể trả bớt sân hoặc hủy buổi", kèm nút soạn sẵn tin Zalo rủ thêm người.
- **Mốc chốt sân** = giờ bắt đầu buổi trừ **N tiếng**, cài đặt admin mới "Nhắc chốt sân trước giờ chơi", mặc định **24 tiếng** (user đồng ý 3/11). Nếu hạn vote của buổi rơi sau mốc này thì dùng hạn vote.
- Ngưỡng tính lại ngay sau mỗi lần vote/sửa vote/sửa số chỗ (trong cùng server action, không quét định kỳ).

### 4.4 Nhắc nợ (user chốt 3/11)

- Tự động, sau khi chốt sổ: nhắc ngày thứ **1, 7, 14, 30** nếu số dư member còn âm.
- **Bỏ qua** khi số nợ < **10.000 đ**.
- Sau 30 ngày dừng nhắc member; khoản đó chỉ còn trong **tóm tắt tuần** gửi admin.
- Mỗi lần nhắc đọc số dư hiện tại (không dùng số cũ); trả rồi thì không nhắc.

### 4.5 Danh mục thông báo, giai đoạn N1 (user chốt thứ tự 3/11: làm ngay sau G2a, buổi nhóm trước)

Kênh: **S** chuông trên site, **E** email (nếu member có email và bật). Mức: **Ngay**, **Lịch**, **Gom** (vào tóm tắt). "Bắt buộc" = không tắt được.

**Member, buổi chơi nhóm**

| Sự kiện | Ai nhận | Kênh | Mức | Bắt buộc |
|---|---|---|---|---|
| Buổi mới mở vote | Member đang hoạt động, đã duyệt | S | Ngay nếu buổi trong 48h, còn lại Gom | Không |
| Sắp hết hạn vote (24h và 2h trước hạn) | Người chưa vote | S, E | Lịch | Không |
| Admin gia hạn hoặc mở lại vote | Người chưa vote | S | Ngay | Không |
| Admin sửa vote / số khách của mình | Người bị sửa | S | Ngay | Có |
| Đổi giờ, đổi sân, đổi giá sân | Người đã vote chơi/ăn | S, E | Ngay (vượt giờ yên lặng nếu buổi trong ngày) | Có |
| Hủy buổi | Mọi người đã vote | S, E | Ngay (vượt giờ yên lặng nếu buổi trong ngày) | Có |
| Mở lại buổi đã hủy | Người từng vote | S | Ngay | Có |
| Buổi còn ít chỗ (còn ≤ 2) | Người chưa vote | S | Ngay | Không |
| Nhắc sáng ngày chơi + 3h trước giờ, kèm sân, giờ, link chỉ đường | Người vote chơi | S | Lịch | Không |
| Chốt sổ: số tiền của mình (chơi/ăn/khách), số dư mới, QR chuyển khoản | Từng người dự + người mời khách | S, E | Ngay | Có |
| Mở khoá buổi, sửa cầu/giá sau chốt sổ (số tiền đổi) | Người dự có số tiền đổi | S, E | Ngay | Có |
| Xoá buổi đã chốt, hoàn quỹ | Người có số dư đổi | S, E | Ngay | Có |

**Member, tiền và tài khoản**

| Sự kiện | Ai nhận | Kênh | Mức | Bắt buộc |
|---|---|---|---|---|
| Admin xác nhận đã nhận tiền (kèm số dư mới) | Member | S, E | Ngay | Có |
| Hoàn tác thanh toán / đảo giao dịch (kèm lý do) | Member | S, E | Ngay | Có |
| Ghi nạp quỹ, hoàn tiền | Member | S, E | Ngay | Có |
| Nhắc nợ (mốc 1/7/14/30) | Member còn nợ ≥ 10K | S, E | Lịch | Có (có trần) |
| Tài khoản được duyệt / bị từ chối / được gộp | Người đăng ký | S, E | Ngay | Có |
| Đổi mật khẩu, liên kết hoặc gỡ Google/Zalo/FB | Chủ tài khoản | S, E | Ngay | Có |
| Sân mình đề xuất được duyệt / bị ẩn | Người đề xuất | S | Gom | Không |

**Admin**

| Sự kiện | Kênh | Mức | Bắt buộc |
|---|---|---|---|
| Sắp đầy / đầy / vượt sức chứa (mục 4.3), kèm số và hạn chốt sân | S, E | Ngay | Có |
| Ít người tại mốc chốt sân (mục 4.3), kèm nút soạn tin Zalo | S, E | Lịch | Có |
| Member bỏ chơi trong 24h trước giờ chơi | S | Ngay | Không |
| Còn người chưa vote lúc 2h trước hạn: danh sách tên + nút soạn tin Zalo "nhắc người chưa vote" | S | Lịch | Không |
| Member báo đã chuyển tiền / tự báo nạp quỹ | S | Ngay | Không |
| Có đăng ký mới chờ duyệt / có người xin vào nhóm | S | Ngay | Không |
| **Có sân mới được đề xuất chờ duyệt** | S, E | Ngay | Có |
| Cầu dưới ngưỡng tồn kho | S | Ngay sau khi chốt sổ hoặc chỉnh kho | Không |
| Tiền sân tháng chưa trả đủ | S, E | Lịch hằng tháng | Không |
| Kiểm tra sổ quỹ (I1-I10) báo lỗi | S, E | Ngay | Có |
| Tóm tắt tuần: ai đang nợ quá 30 ngày, buổi tuần tới, việc chờ duyệt | E | Gom (thứ 2, 8:00) | Không |

### 4.6 Chống làm phiền

- Tin bắt buộc không tắt được; tin khác tắt được theo nhóm tin (buổi chơi, tiền, tài khoản, sân) và theo kênh (chuông/email). Trang cá nhân có mục "Thông báo".
- **Giờ yên lặng 22:00 - 07:00** giờ VN cho email: tin trong khung này dồn tới 07:00, trừ hủy hoặc đổi giờ của buổi trong ngày.
- Tin "Gom" vào 1 email tóm tắt mỗi ngày (chỉ gửi nếu có tin chưa đọc).
- Một sự kiện chỉ gửi 1 lần mỗi kênh mỗi người (`dedup_key`).
- Mỗi member tối đa 6 email tuỳ chọn mỗi ngày; vượt thì dồn vào tóm tắt.
- Email nhắc và tóm tắt có link huỷ nhận 1 chạm (token ký, không lộ id) và header `List-Unsubscribe` + `List-Unsubscribe-Post`.

### 4.7 Hiển thị chuông

- **Member:** chuông trên Header ở mọi trang member có đăng nhập (cả trang chủ). Số chưa đọc dừng ở `99+`. Bấm mở bottom sheet trên mobile (dialog trên `md:`), danh sách mới nhất trước, 20 tin mỗi trang, "Đánh dấu đã đọc tất cả". Bấm 1 tin thì đánh dấu đã đọc (optimistic) và đi tới trang liên quan.
- **Admin:** chuông trong khu admin (sidebar + thanh trên mobile), cùng cách hiển thị. Số đếm "sân chờ duyệt" và "member chờ duyệt" trên menu vẫn giữ (G2a đã có).
- **Tải:** đếm chưa đọc khi mở/chuyển trang và khi quay lại tab (react-query `refetchOnWindowFocus`), không polling, truy vấn đếm có index `(recipient, read_at)`. Không thêm vòng `usePolling` nào.
- Khách chưa đăng nhập không thấy chuông. Tài khoản giao lưu (G2a) chỉ thấy tin của mình.

### 4.8 Dữ liệu (chỉ thêm)

- `notifications`: mỗi người nhận 1 dòng. `recipient_type` (`member|admin`), `recipient_id`, `kind` (mã cố định), `entity_type` + `entity_id` (buổi, giao dịch, sân...), `payload` JSON nhỏ chỉ chứa dữ liệu của chính người nhận, `mandatory`, `read_at`, `created_at`, `dedup_key` UNIQUE. Index `(recipient_type, recipient_id, read_at, created_at)`.
- `notification_deliveries` (outbox email): `notification_id`, `channel`, `status` (`pending|sent|failed|skipped`), `attempts`, `next_attempt_at`, `error_code`. Index `(status, next_attempt_at)`.
- `notification_prefs`: 1 dòng mỗi người nhận, chỉ lưu các nhóm tin bị tắt + có nhận email không.
- `scheduled_jobs` (sổ hẹn QStash): `job_key` UNIQUE (ví dụ `vote_due_2h:session:123:v4`), `message_id` của QStash, `run_at`, `status`. Dùng để huỷ/hẹn lại khi đổi giờ và để cron dự phòng biết mốc nào đã chạy.
- `admins.role TEXT NOT NULL DEFAULT 'superadmin'` (enum chỉ ở TypeScript, hiện chỉ có `superadmin`). Mọi admin đang có tự thành superadmin, đúng hành vi hôm nay. Chuẩn bị cho admin theo club sau này; N1 không đổi quyền truy cập trang admin.
- `members.email` đã có; cần cờ "đã xác minh email để nhận thông báo" (`notify_email_verified_at`) để không gửi tới email gõ nhầm.
- Không seed trong migration.

### 4.9 Ghi và gửi

- Tin được ghi trong **cùng `db.transaction`** với hành động nghiệp vụ (1 lệnh insert nhiều người nhận, `onConflictDoNothing` theo `dedup_key`). Hành động thất bại thì không có tin.
- Email gửi **sau khi trả phản hồi** (cơ chế chạy-sau-phản-hồi của Next 16, đọc docs trước) từ outbox; thử lại tối đa 5 lần giãn dần; lỗi cuối cùng hiện cho admin trong trang cài đặt. Mailer hiện "không bao giờ throw" phải trả trạng thái rõ ràng cho outbox.
- Các tin "Lịch" chạy qua route QStash có kiểm chữ ký (mục 4.2).
- Tin cho admin chỉ gửi tới **superadmin**: các dòng trong bảng `admins` (khác bảng `members`) có `role = 'superadmin'` (user chốt 4/11). Sau này có admin riêng cho từng club thì họ mang vai trò khác và chỉ nhận tin của club mình; giai đoạn N1 chưa làm phần club.

### 4.10 Giai đoạn

1. **N1 (làm ngay sau G2a):** bảng dữ liệu, chuông member + admin, danh mục 4.5, email Brevo + xác minh email + huỷ nhận, QStash + cron dự phòng, ngưỡng sân 4.3, nhắc nợ 4.4, nút soạn tin Zalo cho admin, trang cài đặt thông báo. Có thể chia N1a (chuông + tin tức thời) và N1b (email + hẹn giờ) nếu plan thấy quá lớn cho 1 lần deploy.
2. **N2 (cùng G2b):** tin cho buổi giao lưu (đăng ký, duyệt, danh sách chờ, chốt phí, hủy buổi giao lưu, bình luận).
3. **N3 (tuỳ chọn):** web push cho ai cài app vào màn hình chính.

## 5. Phần để người làm tự quyết

- Tên `kind` cụ thể, cấu trúc `payload`, cách chia component chuông và bottom sheet.
- Template email (miễn là có bản text thuần, có link huỷ nhận, không chứa dữ liệu người khác).
- Cách viết route QStash và cách hẹn lại khi đổi giờ (miễn đúng 4.2).
- Giờ cụ thể của cron hằng ngày (trong khung 5:00 - 7:00 giờ VN).

## 6. Quyết định của mình (cần user soát)

1. Ngưỡng "sắp đầy" = còn 2 chỗ; "ít người" = dưới 50% số chỗ tại mốc chốt sân. Đổi được sau qua cài đặt nếu cần.
2. Nhắc vote 2 lần: 24h và 2h trước hạn, chỉ cho người chưa vote.
3. Nhắc ngày chơi 2 lần: sáng ngày chơi (khoảng 8:00) và 3h trước giờ.
4. Email chỉ gửi tới email đã xác minh (bấm link xác minh 1 lần), để không gửi nhầm người.
5. Tin cho admin chỉ gửi tới superadmin, mỗi người đánh dấu đã đọc riêng (user sửa 4/11: "superadmin thôi, sau sẽ có thêm admin cho từng club").
6. Tin "Buổi mới mở vote" của buổi xa hơn 48h chỉ vào tóm tắt, tránh mỗi tuần mấy tin.
7. Web push để giai đoạn N3 vì phần lớn member mở app trong Zalo/Messenger, nơi push không chạy.
8. Không động vào bot Messenger hiện có trong N1; xem log rồi quyết bỏ hay giữ sau.
