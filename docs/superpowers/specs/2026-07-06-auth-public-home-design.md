# Auth overhaul + Public home — Design

Ngày: 2026-07-06. Trạng thái: design đã duyệt (user chọn "làm tất cả 1 spec, làm luôn"). Nguồn: brainstorm phiên 2026-07-06.

## Mục tiêu (4 phần, làm chung 1 spec, có thể ship theo 2 đợt)

A. **Public home** — khách chưa đăng nhập xem được lịch tuần + số người vote ở `/` (CHỈ trang chủ). Bấm vote → CTA đăng nhập/đăng ký. /history, /stats, /me, /my-fund vẫn cần login.
B. **Login đa kênh** — đăng nhập bằng username HOẶC số điện thoại HOẶC email HOẶC SSO.
C. **/me tự sửa** — user tự sửa username, số điện thoại, email.
D. **Admin reset password** — sinh mật khẩu tạm random hạn 24h, member login bằng nó bị bắt đổi mật khẩu mới ngay mới vào được. Admin xem plaintext 1 lần rồi tự gửi (app không gửi mail).

## Quyết định đã chốt

- 1 spec cho cả 4; reset password = admin xem 1 lần, gửi tay (không mail).
- Form login: 1 ô "Username / SĐT / Email" + mật khẩu; nút SSO Google (Facebook đang ẩn tạm) bên dưới.
- Username: tùy chọn, unique (nullable), user tự đặt ở /me.
- Phone KHÔNG unique ở DB (đang có cặp trùng lịch sử; giờ đã gộp còn 0 trùng, nhưng vẫn không ràng buộc cứng để admin nhập cùng 1 sđt liên hệ cho 2 người được). Login-by-phone chỉ chấp nhận khi khớp ĐÚNG 1 member.
- Public home cố ý lộ tên member + lịch cho khách (đúng ý user).

## A. Public home

Hiện `(public)/layout.tsx` chặn cứng: `!user` → chỉ render `FacebookLoginGate`. Đổi:

- Layout: khi `!user` → render shell (Header + `<main>{children}</main>`), KHÔNG bottom nav. Cho home render.
- 4 trang cá nhân tự gate khi `!user`: `/history`, `/stats` → render `<FacebookLoginGate>`; `/me` đã `redirect("/")`, `/my-fund` đã handle null (giữ, nhưng đổi sang render login gate cho nhất quán). Giữ nguyên các nhánh logged-in (disabled/pending/normal + force-change mới ở D).
- `session-vote-optimistic-panel.tsx`: khi `currentMemberId == null` → thay card VoteButtons bằng CTA "Đăng nhập / Đăng ký để vote" (link về `/` gate hoặc mở login). VoteList vẫn hiện (read-only).
- Test: guest thấy `/` (schedule + counts), guest vào `/history` thấy login gate, guest bấm vote thấy CTA.

## B. Login đa kênh + schema

Migration (chỉ ADD COLUMN + CREATE UNIQUE INDEX — KHÔNG recreate-table, tránh Turso rớt index, xem [[reference-turso-migration-gotcha]]):

- `username text` (nullable).
- `CREATE UNIQUE INDEX members_username_unique ON members(username)` — app lưu username đã lowercase, so sánh lowercase.
- `password_reset_expires_at text` (nullable, ISO).
- `must_change_password integer NOT NULL DEFAULT 0` (boolean).

Resolver `findMemberByIdentifier(identifier)` (server, trong password-auth.ts hoặc lib mới):

- Thứ tự: nếu chứa `@` → tìm theo email (lowercase). Else nếu match regex username hợp lệ → tìm theo username (lowercase). Else digits → tìm theo phone, CHỈ trả khi đúng 1 match (COUNT=1); >1 hoặc 0 → null.
- Fallback: thử cả 3 nếu cần, nhưng deterministic (email→username→phone).

`loginWithPassword({ identifier, password })` (đổi từ `email`):

- Resolve member; sai/không thấy → lỗi chung "Định danh hoặc mật khẩu không đúng" (không lộ tồn tại).
- Check bcrypt. Nếu `password_reset_expires_at` có và < now → từ chối "Mật khẩu tạm đã hết hạn, liên hệ admin".
- OK → set cookie. (Force-change xử lý ở gate, không chặn ở đây.)
- Rate-limit theo `login:{ip}:{identifierNorm}` + `login-user:{identifierNorm}` (như hiện tại).

Login form (`password-auth-form.tsx`): đổi field email → 1 ô identifier (label "Username / SĐT / Email").

## C. /me tự sửa

Thêm form ở /me: username (validate: 3-32 ký tự [a-z0-9_.], lowercase, unique check trừ chính mình), phoneNumber (digits), email (unique check). Action `updateMyProfile` (đã có type `UpdateMyProfileState` trong members.ts — mở rộng hoặc viết action mới `updateMyIdentifiers`). Đổi mật khẩu dùng lại `setPassword` sẵn có.

## D. Admin reset password + force-change gate

Action `resetMemberPassword(memberId)` (admin-gated):

- Sinh temp password random (10 ký tự A-Za-z0-9, dùng crypto).
- bcrypt hash (rounds 12), set `passwordHash`, `password_reset_expires_at = now+24h`, `must_change_password = true`.
- Trả `{ tempPassword }` plaintext 1 lần cho UI (KHÔNG lưu plaintext, KHÔNG log).
- UI: menu ⋮ ở /admin/members → "Đặt lại mật khẩu" → confirm → dialog hiện temp password + nút copy + ghi chú "gửi member, hết hạn 24h".

Force-change gate (`(public)/layout.tsx`): member đã login mà `must_change_password = true` → render màn "Đặt mật khẩu mới" (chặn mọi thứ, giống pending gate). Form gọi `setPassword` (không cần currentPassword vì đang ở chế độ reset — nhưng `setPassword` hiện yêu cầu currentPassword khi đã có hash; cần biến thể: khi `must_change_password` true, cho đổi không cần current). Sau khi đổi thành công → clear `must_change_password` + `password_reset_expires_at`.

## Bảo mật (chạy security-review skill trước deploy)

- Resolver không lộ định danh tồn tại (lỗi chung).
- Temp password chỉ hash; plaintext hiện 1 lần, không log/không lưu.
- Force-change gate chặn toàn bộ tới khi đổi; temp hết hạn → login bị từ chối.
- Public home cố ý lộ tên+lịch cho khách (ghi rõ, user đồng ý). KHÔNG lộ /history, /stats, /me, /my-fund.
- reset password action admin-gated (requireAdmin).
- rate-limit login/reset giữ nguyên pattern.

## Test

- Unit: `findMemberByIdentifier` (email/username/phone/ambiguous/none), normalize username.
- Integration: login đa kênh; reset→login temp→force-change→clear cờ; temp hết hạn→từ chối; /me unique checks (username/email trùng người khác vs chính mình).
- Migration verify: sqlite_master có index username sau apply (Turso gotcha).
- E2E tay: guest xem home, guest /history→login, guest bấm vote→CTA, admin reset→copy→member login→bắt đổi.

## Ngoài phạm vi

- Gửi mail/SMS (app không có). Reset qua admin thủ công.
- Bắt buộc username toàn bộ member (để tùy chọn).
- Đổi cơ chế cookie/session-version (residual risk merge-reset session cũ vẫn để ngỏ, xem [[project-security-posture]]).
