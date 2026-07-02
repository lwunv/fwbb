# Lịch sử chơi của member trong /admin/members

Ngày: 2026-07-02. Trạng thái: đã duyệt thiết kế (chọn phương án overlay), chờ plan + implement.

## Mục tiêu

Admin đang ở trang `/admin/members` bấm 1 nút trên hàng member để xem lịch sử chơi của người đó: chơi ngày giờ nào, buổi đó bị tính bao nhiêu tiền, và đã trả tiền buổi đó chưa. Hai chế độ xem: dạng lịch (mặc định) và dạng danh sách có phân trang.

## Phạm vi

- Chỉ đọc. Không sửa bất kỳ logic tiền hiện có.
- Chỉ buổi đã chốt sổ (`sessions.status = 'completed'`) mới vào lịch sử, vì buổi chưa chốt chưa có số tiền thật.
- Chỉ admin xem được (trang thuộc khu `/admin`, đã có auth gate ở proxy).

## Nghĩa "đã trả" cho từng buổi (quyết định 2026-07-02)

Mô hình quỹ gộp chỉ có 1 balance tổng, không lưu "buổi nào đã trả". Đã chốt với user: phân bổ **FIFO**, tiền nạp trừ dần cho buổi CŨ trước. Cài đặt tương đương và đơn giản hơn:

1. Lấy `balance` hiện tại của member bằng helper chuẩn (`computeBalancesForMembers` / `fund-core`). KHÔNG tự viết vòng lặp cộng ledger mới.
2. `deficit = max(0, -balance)`.
3. Duyệt các buổi từ MỚI nhất về CŨ, trừ `deficit` vào `totalAmount` từng buổi:
   - `deficit >= totalAmount` → buổi đó `unpaid`, trừ tiếp.
   - `0 < deficit < totalAmount` → buổi đó `partial`.
   - `deficit = 0` → buổi đó `paid` (và mọi buổi cũ hơn đều `paid`).
4. Nếu trừ hết các buổi mà `deficit` vẫn còn (nợ do khoản trừ ngoài buổi chơi), không đánh dấu gì thêm; phần dư chỉ thể hiện ở dòng tổng trên header.

Cách này cho kết quả trùng với phân bổ FIFO đầy đủ nhưng chỉ cần balance chuẩn + danh sách charge, không đụng semantics ledger.

Logic bước 2-4 viết thành hàm pure `attributePaidFifo()` trong `src/lib/fifo-paid-attribution.ts`, có unit test vitest (các case: đủ tiền, âm 1 phần buổi mới nhất, âm nhiều buổi, âm vượt tổng charge, không có buổi nào).

## Dữ liệu

Server action mới `getMemberPlayHistory(memberId: number)` trong file mới `src/actions/member-history.ts` (members.ts đã ~700 dòng, không nhét thêm):

- Gate `requireAdmin()`.
- Query `session_debts` của member, join `sessions` (chỉ `completed`) + `courts`. Mỗi phần tử trả về: `sessionId`, `date`, `startTime`, `endTime`, `courtName`, `totalAmount`, breakdown (`playAmount`, `dineAmount`, `guestPlayAmount`, `guestDineAmount`), `paidStatus` (`paid | partial | unpaid`).
- Kèm `balance` hiện tại để header hiện dòng tổng.
- Trả TOÀN BỘ lịch sử 1 lần (nhóm chơi ~3 buổi/tuần, dữ liệu nhỏ). Client tự phân trang / lọc theo tháng. Không cần pagination phía server.

## UI

Vỏ: overlay ngay trong trang members (phương án A đã duyệt).

- `member-list.tsx`: thêm nút icon (History/CalendarDays, vùng chạm ≥ 44px) trên mỗi hàng member.
- Bấm nút mở **bottom sheet** (mobile, framer-motion trượt lên) / **dialog** (từ `md:` trở lên). Component client mới `member-play-history-sheet.tsx` đặt cạnh member-list trong `src/app/(admin)/admin/members/` (mới dùng 1 chỗ; khi nào trang user cần thì mới nhấc ra `src/components/`).
- Data load khi mở bằng TanStack Query gọi server action (KHÔNG useEffect + fetch), có skeleton đúng layout khi loading, empty state khi member chưa có buổi nào.
- Header sheet: tên member + dòng tổng ("đang nợ 109K" đỏ / "còn quỹ 50K" xanh / "0đ").
- Toggle 2 chế độ: **Lịch** (mặc định) | **Danh sách**. State cục bộ trong sheet, không cần nuqs (overlay không có URL).
- **Lịch**: grid tháng (tuần bắt đầu Thứ 2), nút chuyển tháng trước/sau, mặc định tháng hiện tại. Ngày có buổi chơi hiện chấm màu: xanh = đã trả, vàng = trả một phần, đỏ = chưa trả. Desktop hover, mobile chạm → popover chi tiết: ngày giờ chơi, sân, số tiền, trạng thái trả, breakdown nếu có khách/nhậu.
- **Danh sách**: buổi mới nhất trước, mỗi hàng: ngày + giờ + số tiền + badge trạng thái. Chạm hàng expand inline (accordion) hiện chi tiết, cùng nội dung với popover lịch. Phân trang 10 buổi/trang (Prev/Next, client-side).
- Tiền hiển thị format nghìn VND như phần còn lại của app. Màu dùng CSS custom properties theo theme, không hardcode hex.
- i18n đủ vi/en/zh cho mọi label mới.

## Testing

- Unit test `fifo-paid-attribution.ts` (vitest) như trên.
- Test action (integration, nếu nhanh): member có 3 buổi + balance âm 1 phần → đúng trạng thái từng buổi.
- Verify tay: mở sheet cho cún (-109K) thấy buổi mới nhất chưa trả; member dương quỹ thấy tất cả đã trả.

## Ngoài phạm vi

- Buổi chưa chốt sổ, buổi bị hủy.
- Lịch sử vote (chỉ lịch sử bị tính tiền).
- Xuất file, chia sẻ link.
- Member tự xem lịch sử của mình ở trang user (có thể làm sau, tái dùng cùng action + component).
