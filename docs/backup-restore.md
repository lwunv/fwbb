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

---

# Bản dự phòng chạy được (thêm 30/10/2026)

Sao lưu cứu được dữ liệu nhưng không cứu được việc site đang chết. Phần này là
lớp thứ hai: khi Turso không phục vụ nữa, app tự chuyển sang một database khác
và **vẫn ghi được**, không chỉ xem.

## Bốn lớp, ba công ty

| Lớp            | Ở đâu                  | Vai trò                      | Ghi được |
| -------------- | ---------------------- | ---------------------------- | -------- |
| Bản chính      | Turso                  | chạy hàng ngày               | có       |
| Bản dự phòng   | máy chủ libsql tự dựng | thay thế khi Turso chết      | có       |
| Kho phòng thân | Cloudflare D1          | còn dữ liệu khi mất cả hai   | không    |
| Sao lưu        | GitHub Actions, mã hoá | dựng lại từ đầu ở bất cứ đâu | không    |

Bản dự phòng phải là **libsql**, không phải D1. D1 không có giao dịch kiểu
đọc-rồi-ghi, mà 35 chỗ trong app đang dựa vào đúng thứ đó để hai người bấm cùng
lúc không ghi đè số tiền của nhau. Trỏ app vào D1 để ghi là mở lại đúng loại
lỗi mà `db.transaction` sinh ra để chặn.

## App tự chuyển thế nào

`src/db/failover.ts` bọc client database. Luật của nó:

1. **Chưa khai `STANDBY_DATABASE_URL` thì không đổi gì cả.** Nó trả thẳng
   client chính về, không thêm một lần gọi mạng nào. Gỡ biến môi trường ra là
   quay lại trạng thái cũ ngay, không cần deploy lại code.
2. Gặp lỗi kiểu **máy chủ không phục vụ** (kết nối đứt, DNS chết, 403 tài khoản
   bị khoá, 5xx) thì chuyển sang bản dự phòng và chạy lại câu lệnh đó.
3. Gặp lỗi **tầng SQL** (trùng khoá, sai cú pháp) thì ném lên như cũ. Chuyển vì
   một câu INSERT trùng khoá nghĩa là từ đó cả nhóm ghi vào một nơi khác trong
   khi bản chính vẫn sống: hai nơi cùng được ghi là kiểu hỏng không sửa tự động
   được.
4. Cờ trạng thái nằm ở **chính bản dự phòng** (bảng `replica_state`), vì lúc
   cần đọc cờ là lúc bản chính đang chết. Mọi instance đọc chung một cờ nên
   chúng chuyển cùng nhau.
5. **Không bao giờ tự quay về.** Quay về phải có người đồng bộ ngược trước.

## Lệnh

```bash
# Đang chạy ở đâu
node scripts/failover.mjs --status

# Chuyển tay sang bản dự phòng (diễn tập, hoặc biết trước sắp có sự cố)
node scripts/failover.mjs --to-standby --apply

# Turso sống lại: copy NGƯỢC về rồi mới hạ cờ. Đúng thứ tự này.
node scripts/failover.mjs --recover --apply

# Copy bản chính sang bản dự phòng (workflow sao lưu tự gọi mỗi lần chạy)
node scripts/replicate-to-standby.mjs --apply
```

`replicate-to-standby.mjs` **tự bỏ qua** khi cờ đang là `standby`. Nếu không,
mỗi lần sao lưu chạy là một lần xoá sạch những gì cả nhóm vừa nhập trong lúc sự
cố.

## Bí mật cần khai thêm

| Tên                     | Là gì                             |
| ----------------------- | --------------------------------- |
| `STANDBY_DATABASE_URL`  | đường dẫn máy chủ libsql dự phòng |
| `STANDBY_AUTH_TOKEN`    | token của nó                      |
| `D1_DATABASE_NAME`      | tên database D1                   |
| `CLOUDFLARE_API_TOKEN`  | token có quyền D1 Edit            |
| `CLOUDFLARE_ACCOUNT_ID` | id tài khoản Cloudflare           |

Khai ở hai nơi: **GitHub** (để workflow nhân bản) và **Vercel** (để app chuyển
được). Hai cái D1 chỉ cần ở GitHub, vì app không bao giờ nói chuyện với D1.

## Cửa sổ mất mát của lớp này

Bản dự phòng chỉ mới bằng lần nhân bản gần nhất. Nhân bản đi kèm workflow sao
lưu, mà GitHub giãn lịch của repo ít hoạt động nên thực tế là **khoảng 5 tiếng
một lần**, không phải mỗi giờ như đặt trong cron. Mất tối đa là chừng đó.

Muốn 0 mất mát thì app phải ghi đồng thời cả hai nơi và chỉ báo thành công khi
cả hai xong. Cái đó làm mọi thao tác ghi chậm lại và đẻ ra tình huống một bên
ghi được một bên hỏng. Với một nhóm cầu lông, không đáng.

## Đã kiểm tới đâu (30/10/2026)

Chạy thật trên máy, hai database dạng file, không đụng prod:

- Nhân bản bản chính sang bản dự phòng: **18/18 bảng khớp từng bit**.
- Bật cờ `standby` rồi chạy lại nhân bản: **tự bỏ qua**, không ghi đè.
- Ghi một bản ghi mới vào bản dự phòng (giả lập người dùng nhập trong lúc sự
  cố), rồi `--recover --apply`: dữ liệu đó **về tới bản chính**, cờ hạ sau khi
  dữ liệu đã về.
- Sinh SQL cho D1 từ bản chụp thật rồi nạp vào một database sạch: **18/18 bảng
  khớp từng bit**.
- 14 bài kiểm tự động cho phần quyết định "khi nào được chuyển", gồm ca tên cột
  có chữ `quota` làm lỗi ràng buộc bị đọc nhầm thành tài khoản bị khoá.

Chưa kiểm: đường chạy thật với một máy chủ libsql ở xa và với D1 thật. Hai cái
đó cần tài khoản đã dựng xong.

## Canh cho bản dự phòng khỏi mục (thêm 01/11/2026)

Một bản dự phòng không ai đụng tới sẽ hỏng dần trong im lặng và chỉ lộ ra
đúng lúc bản chính chết. Ba thứ dưới đây để chuyện đó không xảy ra.

### Mốc thời gian nhân bản

Mỗi lần copy xong, `replicate-to-standby.mjs` ghi một dòng vào bảng
`replica_sync` trên chính bản dự phòng. Ghi SAU khi nạp xong, không phải
trước, nếu không thì mốc nói dối mỗi lần nạp hỏng giữa chừng.

Hai bảng `replica_state` và `replica_sync` **không bao giờ** được đưa vào bản
chụp. Chúng là trạng thái điều khiển, chỉ có nghĩa trên đúng database đang giữ
chúng. Chép đi nơi khác thì bản chính vừa khôi phục xong đã mang sẵn cờ "đang
chạy ở dự phòng".

### Việc canh theo lịch

`.github/workflows/standby-health.yml` chạy 6 tiếng một lần và làm job đỏ khi:

- đường kết nối không mã hoá, hoặc thiếu token;
- không nối tới được bản dự phòng;
- thiếu bảng (chưa chạy migration);
- bảng `members` rỗng (nối được nhưng chẳng có gì để cứu);
- lần nhân bản gần nhất quá 12 tiếng (đổi bằng `STANDBY_MAX_AGE_HOURS`);
- **app đang chạy trên bản dự phòng**, tức bản chính đang hỏng.

Chạy tay: `node scripts/check-standby.mjs`.

### Chặn đường kết nối không mã hoá

Bản dự phòng giữ toàn bộ họ tên, số điện thoại, **số tài khoản ngân hàng** và
mã băm mật khẩu. `validateStandbyConfig` trong `src/db/failover.ts` từ chối
`http://` và `ws://`, và từ chối một database ở xa không có token.

Khi cấu hình sai, app **không** chết. Nó bỏ qua bản dự phòng, in một dòng lỗi
vào log, và chạy tiếp bằng bản chính. Lý do: làm chết cả site vì một biến môi
trường gõ nhầm là hỏng nặng hơn thứ cần chữa. Bù lại, việc canh ở trên sẽ báo
đỏ nên không ai tưởng mình có dự phòng mà thật ra không có.

### Chỗ còn rủi ro, nói thẳng

- **Mất tối đa một cửa sổ nhân bản.** Bản dự phòng chỉ mới bằng lần copy gần
  nhất. Không có cách nào về 0 mà không ghi đồng thời hai nơi.
- **Chưa chạy thật với một máy chủ ở xa.** Mọi thứ trên đây đã chạy với hai
  database dạng file trên máy. Đường mạng thật còn có thể lòi ra chuyện khác.
- **Mất `BACKUP_PASSPHRASE` là mất toàn bộ bản sao lưu.** Không ai cứu được.
- **Token của bản dự phòng nằm trong biến môi trường của Vercel và GitHub.**
  Ai vào được hai chỗ đó là đọc được cả database. Đổi token định kỳ, và đổi
  ngay khi có người rời nhóm.
