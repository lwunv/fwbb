# Sao lưu và khôi phục database

Viết sau sự cố 24/10/2026: tài khoản Turso bị khoá vì vượt hạn mức đọc, và lúc
đó mới phát hiện **không lấy được dữ liệu ra**, vì chính thao tác export cũng bị
tính là đọc. Không có bản sao lưu nào ở ngoài thì dữ liệu của cả nhóm bị nhốt
trong một tài khoản đang bị khoá.

Tài liệu này nói ba việc: sao lưu chạy thế nào, khôi phục ra sao, và làm gì khi
nhà cung cấp chết.

## Sao lưu tự động

`.github/workflows/backup-db.yml` chạy **mỗi giờ** trên máy của GitHub, nên
không phụ thuộc máy ai có bật hay không. Nó dump toàn bộ database ra JSON, kiểm
sơ bộ xem dump có thật sự chứa dữ liệu, mã hoá, rồi cất vào kho lưu trữ của
Actions trong 90 ngày.

Ba bí mật phải khai trong repo (Settings → Secrets and variables → Actions):

| Tên                  | Là gì                            |
| -------------------- | -------------------------------- |
| `TURSO_DATABASE_URL` | đường dẫn database               |
| `TURSO_AUTH_TOKEN`   | token đọc                        |
| `BACKUP_PASSPHRASE`  | mật khẩu mã hoá bản dump, tự đặt |

> **Mất `BACKUP_PASSPHRASE` là mất toàn bộ các bản sao lưu.** Cất nó trong trình
> quản lý mật khẩu, đừng để nó chỉ tồn tại duy nhất ở GitHub.

Bản dump chứa họ tên, email, số điện thoại, **số tài khoản ngân hàng** và mã băm
mật khẩu của cả nhóm. Vì vậy bước mã hoá là bắt buộc, không phải tuỳ chọn, và
file dạng đọc được bị xoá ngay trong cùng bước đó.

### Vì sao mỗi giờ, không dày hơn

| Nhịp            | Hạn mức đọc DB | Phút Actions (repo riêng tư, 2.000 phút/tháng) |
| --------------- | -------------- | ---------------------------------------------- |
| 6 tiếng/lần     | 0,12%          | 6%                                             |
| **1 tiếng/lần** | **0,72%**      | **18%**                                        |
| 15 phút/lần     | 2,88%          | 72%                                            |

Lượt đọc thì rẻ, nhưng phút Actions mới là thứ cạn trước. 15 phút/lần ngốn gần
hết chỗ dự phòng cho mọi việc khác. Job cố ý chỉ cài hai gói cần dùng thay vì
`pnpm install` cả dự án, để mỗi lần chạy không tốn thêm vài chục giây.

### Cửa sổ mất mát

**Mất nhiều nhất là số phút kể từ lần chạy gần nhất, tức dưới một tiếng.** Không
phải số 0, và không có cách nào thành 0 với kiểu sao lưu theo lịch. Muốn 0 thì
app phải ghi song song sang nơi thứ hai ngay lúc ghi, đó là đổi kiến trúc lớn và
tự nó đẻ ra lỗi mới khi một bên ghi hỏng. Với một nhóm cầu lông, dưới một tiếng
là đánh đổi hợp lý.

## Giải mã một bản sao lưu

Tải file `.enc` từ tab Actions của lần chạy tương ứng, rồi:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 \
  -in fwbb-backup-<ngay>.json.enc \
  -out dump.json \
  -pass pass:'<BACKUP_PASSPHRASE>'
```

Xong việc thì **xoá `dump.json`**. Nó là dữ liệu cá nhân dạng đọc được.

## Khôi phục

`scripts/restore-db.mjs` nạp một bản dump vào bất kỳ database libsql nào. Bản
dump chỉ chứa DỮ LIỆU, không chứa cấu trúc bảng, nên đích phải được chạy
migration trước. Script sẽ dừng và liệt kê nếu đích thiếu bảng.

```bash
# 1. Chạy thử, không ghi gì
node scripts/restore-db.mjs dump.json --target=file:./khoi-phuc.db

# 2. Ghi thật
node scripts/restore-db.mjs dump.json --target=file:./khoi-phuc.db --apply
```

Ba chốt chặn, cố ý làm phiền:

1. Phải truyền `--target=` tường minh. Script **không bao giờ** đọc `.env.local`,
   nên không có đường nào nó tự trỏ vào database thật.
2. Mặc định là chạy thử, phải thêm `--apply` mới ghi.
3. Đích không phải `file:` thì phải thêm `--remote-i-am-sure`. Khôi phục là xoá
   sạch rồi ghi lại; bắn nhầm vào database đang sống là mất dữ liệu.

Toàn bộ phần ghi nằm trong một giao dịch: hỏng giữa chừng thì hoàn tác sạch, chứ
không để database nửa vời. Ghi xong script tự đếm lại từng bảng và báo đỏ nếu
lệch.

## Kiểm chứng một lần khôi phục

Đếm dòng khớp chưa chứng minh nội dung đúng. So nội dung bằng:

```bash
A_URL=file:goc.db B_URL=file:khoi-phuc.db node scripts/compare-db.mjs
```

Nó băm từng bảng sau khi sắp xếp ổn định và so, thoát 0 nếu mọi bảng khớp.

Lần kiểm gần nhất: 24/10/2026, 18/18 bảng khớp từng bit sau khi khôi phục một
database đã bị xoá bảng `votes`, `session_debts` và đổi tên 20 thành viên.

## Cảnh báo trước khi bị khoá

`.github/workflows/turso-quota-alert.yml` chạy 4 lần mỗi ngày, gọi Platform API
của Turso lấy mức dùng của chu kỳ hiện tại, và **làm job đỏ khi vượt 70%**.
GitHub mặc định gửi mail khi workflow đỏ nên không cần dựng kênh báo riêng.

Cần hai bí mật nữa:

| Tên               | Là gì                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `TURSO_API_TOKEN` | token Platform, tạo bằng `turso auth api-tokens mint canh-bao`. **Khác** `TURSO_AUTH_TOKEN` |
| `TURSO_ORG`       | slug tổ chức, nhìn trên thanh địa chỉ `app.turso.tech/<slug>`                               |

Thiếu bí mật thì job cũng đỏ, có chủ ý: một cảnh báo chưa lắp mà im lặng còn tệ
hơn không có cảnh báo.

Script cũng báo đỏ khi API trả về hình dạng lạ, thay vì đoán bừa một con số rồi
báo "an toàn". Phần quyết định đó có test riêng
(`scripts/check-turso-quota.test.mjs`), gồm cả ca dựng lại đúng con số của sự cố
24/10 (653.834.434 dòng trên hạn mức 500 triệu = 131%) để chắc chắn nó sẽ kêu.

## Khi nhà cung cấp chết hoặc bị khoá

Cố ý **không** dựng một database thứ hai chạy song song. Đồng bộ hai chiều giữa
hai nơi phải xử lý xung đột khi cả hai cùng ghi, đó là việc nặng và dễ sai, không
xứng với một app nhóm cầu lông. Thay vào đó là một quy trình ngắn:

1. Tải bản sao lưu mới nhất từ tab Actions, giải mã.
2. Dựng một database libsql mới ở đâu đó và chạy migration cho nó
   (`node scripts/apply-migration.mjs`, nhớ trỏ đúng đích).
3. Khôi phục, truyền token của đích qua biến môi trường (không đặt trong
   dòng lệnh để nó không nằm lại trong lịch sử shell):
   ```bash
   RESTORE_TARGET_TOKEN='<token cua dich>' \n     node scripts/restore-db.mjs dump.json \n       --target=<url moi> --apply --remote-i-am-sure
   ```
4. Đối chiếu bằng `compare-db.mjs`.
5. Đổi `TURSO_DATABASE_URL` và `TURSO_AUTH_TOKEN` trên Vercel, deploy lại.

Mất khoảng 10 phút, và mất nhiều nhất là số giờ kể từ lần sao lưu gần nhất.

## Điều quan trọng nhất

Sự cố 24/10 **không phải** do nhà cung cấp hỏng. Nó do chính app đọc lãng phí:
hai chỗ truy vấn lặp theo từng bản ghi, cộng với màn quản lý tự làm mới 5 giây
một lần kể cả khi không ai nhìn. Một database 1 MB mà bị đọc 653 triệu dòng
trong một tháng. Phần đó đã vá (xem `perf(db): batch two n+1 queries and stop
polling hidden tabs`), và có test đếm truy vấn chặn nó quay lại. Sao lưu là lưới
an toàn, không phải thứ thay cho việc đừng đọc lãng phí.
