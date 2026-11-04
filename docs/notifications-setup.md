# Cài đặt thông báo (chuông và email)

Tài liệu này dành cho chủ app. Làm đủ các bước dưới đây trước khi bật công tắc thông báo trên bản thật. Không dán khoá thật vào file này hay vào chat, chỉ nhập thẳng vào Vercel.

Công tắc thông báo mặc định TẮT. Khi tắt, app chạy y như trước: không có chuông, không tạo tin, các job và cron chỉ trả về "bỏ qua".

## 1. Email qua Brevo

Email dùng để gửi link xác minh, tin bắt buộc và bản tóm tắt ngày. Chuông trong app vẫn chạy kể cả khi chưa cài email.

1. Tạo tài khoản Brevo (gói free đủ dùng cho nhóm nhỏ).
2. Thêm domain `lwcifer.io.vn` trong mục Senders, Domains. Brevo sẽ đưa ra các bản ghi DNS. Thêm vào nơi quản lý DNS của domain:
   - SPF: bản ghi TXT cho phép Brevo gửi thay domain.
   - DKIM: bản ghi TXT (hoặc CNAME) Brevo cung cấp.
   - DMARC: bản ghi TXT tại `_dmarc`. Bắt đầu nhẹ với `v=DMARC1; p=none; rua=mailto:<email của bạn>`, chạy ổn vài tuần rồi siết dần.
3. Chờ Brevo báo domain đã xác thực (thường vài phút tới vài giờ).
4. Vào SMTP & API, tạo SMTP key. Ghi lại login SMTP và key.
5. Đặt các biến sau trên Vercel (Production):

| Biến          | Giá trị                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `SMTP_HOST`   | `smtp-relay.brevo.com`                                                        |
| `SMTP_PORT`   | `587`                                                                         |
| `SMTP_SECURE` | `false`                                                                       |
| `SMTP_USER`   | login SMTP của Brevo                                                          |
| `SMTP_PASS`   | SMTP key vừa tạo                                                              |
| `MAIL_FROM`   | ví dụ `FWBB <no-reply@lwcifer.io.vn>` (địa chỉ phải thuộc domain đã xác thực) |

Port 587 dùng STARTTLS nên `SMTP_SECURE` phải là `false`. Nếu để `true`, kết nối sẽ treo.

## 2. Hẹn giờ chính xác qua QStash

QStash gọi lại app đúng giờ cho các tin hẹn giờ (nhắc sắp hết hạn vote, nhắc trong ngày, thử lại email lỗi).

1. Tạo tài khoản Upstash và bật QStash (gói free).
2. Trong trang QStash, copy ba khoá và đặt trên Vercel:

| Biến                         | Lấy ở đâu           |
| ---------------------------- | ------------------- |
| `QSTASH_TOKEN`               | QStash token        |
| `QSTASH_CURRENT_SIGNING_KEY` | Current signing key |
| `QSTASH_NEXT_SIGNING_KEY`    | Next signing key    |

3. Nếu trang QStash cho thấy vùng của bạn dùng địa chỉ riêng (không phải mặc định), đặt thêm `QSTASH_URL` đúng địa chỉ đó. Vùng mặc định thì bỏ qua biến này.

Giới hạn của gói free: QStash chỉ hẹn tối đa 7 ngày. Việc xa hơn do cron hằng ngày đăng sau.

## 3. Các biến bắt buộc khác

- `CRON_SECRET`: đã dùng cho cron tạo buổi. Kiểm lại nó đang có trên Vercel. Thiếu biến này thì hai cron thông báo trả lỗi 500 (cố ý, để không ai gọi được khi không có khoá).
- `NEXT_PUBLIC_APP_URL`: địa chỉ gốc của app, dạng `https://...` không có dấu `/` cuối. Link trong email và link xác minh dựng từ biến này.
- `USER_COOKIE_SECRET`: ít nhất 16 ký tự. Link xác minh email được ký bằng khoá này, nên thiếu thì app từ chối gửi link xác minh.

## 4. Hai cron hằng ngày

Khai báo trong `vercel.json`, giờ Việt Nam:

- 06:00 (`/api/cron/notifications-daily`): báo mở vote cho buổi sắp tới, chạy lại các job hẹn giờ bị lỡ, hẹn lại nhắc giờ, nhắc nợ (tối đa một tin mỗi người mỗi ngày), tóm tắt tuần, báo tiền sân, kiểm sổ quỹ, dọn tin cũ.
- 07:00 (`/api/cron/notifications-mail`): gửi các email đã dồn qua đêm (giờ yên lặng là 22:00 tới 07:00) rồi gửi tóm tắt ngày.

Sau khi deploy, mở trang Crons của project trên Vercel và kiểm hai cron này đã xuất hiện.

## 5. Bật công tắc

1. Vào admin, Cài đặt, mục thông báo, bật "Bật thông báo trong app", bấm Lưu.
2. Nếu thiếu khoá, trang cài đặt hiện cảnh báo: thiếu QStash thì nhắc giờ chạy theo cron hằng ngày, thiếu SMTP thì email chưa gửi được.
3. Thử: tự vào `/me`, mở thẻ Thông báo, điền email, bấm "Gửi link xác minh", mở email và bấm link. Không tạo hay hủy buổi giả trên bản thật để thử.

Tắt công tắc bất cứ lúc nào để dừng tạo tin mới.

## Giới hạn đã biết

Khi chưa có khoá QStash, các tin nhắc trong ngày và việc thử lại email lỗi phải chờ hai cron hằng ngày (06:00 và 07:00). Không có tin nào bị mất, chỉ đến chậm. Nhắc "sắp hết hạn vote" cách giờ hẹn vài giờ có thể tới sau giờ đó.
