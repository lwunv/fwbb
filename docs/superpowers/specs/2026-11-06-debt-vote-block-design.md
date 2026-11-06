# Chặn vote khi nợ quá hạn mức + báo admin khi member vừa âm quỹ: thiết kế

Ngày: 6/11/2026. Trạng thái: chờ user duyệt.

## 1. Vì sao

Ca thật 6/11/2026: member Nguyen Thanh có số dư -188.000 (vượt hạn mức nợ chặn vote 100.000 trong cài đặt) nhưng vẫn có phiếu vote buổi sắp tới, đi 2 người. Admin không hề được báo là member này đã rơi vào nợ.

Hiện trạng trong code (kiểm 6/11/2026):

- Setting `voteBlockDebtThreshold` (mặc định 100.000) đã có, admin sửa ở trang Cài đặt > Ngưỡng.
- Chỉ **trang chủ** dùng setting này (`src/app/(public)/page.tsx`): nợ ≥ hạn mức thì ẩn khung vote, hiện màn thanh toán.
- **Trang `/vote/[id]` không kiểm nợ.** Admin hay copy link này (`copy-link-button.tsx`) gửi vào nhóm, member bấm là vote được. Đây là đường lọt chính.
- **Server không kiểm nợ**: `submitVote` (`src/actions/votes.ts`) chỉ kiểm hạn vote, trạng thái buổi, số chỗ.
- Phiếu vote từ **trước khi** member rơi vào nợ (ví dụ chốt sổ buổi trước mới đẩy số dư xuống) vẫn nằm nguyên.
- Dashboard admin đã có danh sách "top 5 member đang nợ", nhưng không có tín hiệu "vừa có người mới âm".
- Hệ thống chuông thông báo (N1, có chuông riêng cho admin) đã làm xong trên nhánh `feat/notifications`, chưa lên prod, và theo quyết định của user ngày 4/11/2026 chỉ lên prod cùng cả cụm G2.

## 2. Quyết định của user (6/11/2026)

1. Nợ quá hạn mức trong setting thì **chặn vote hẳn**. Phiếu đã vote thì **tự động bỏ**.
2. Báo admin **ngay khi số dư member vừa chuyển sang âm**, báo **trong site Admin**.
3. User giao: "tự check rồi thống nhất 1 kiểu".

## 3. Mục tiêu / không làm / không được xảy ra

**Mục tiêu**

- Member nợ ≥ hạn mức không thể vote (chơi hoặc nhậu) cho buổi đang mở vote, dù vào từ trang chủ, link `/vote/[id]` hay gọi thẳng server.
- Khi một thao tác tiền làm member chạm hạn mức, phiếu của member đó ở các buổi đang mở vote bị bỏ ngay trong cùng thao tác.
- Admin thấy tin "member X vừa âm quỹ: số dư Y" trong chuông admin, đúng 1 lần mỗi lần chuyển từ ≥ 0 sang < 0.

**Không làm**

- Không đổi cách tính tiền, sàn, ledger. Không thêm cột lưu số dư.
- Không báo qua email/Messenger/Zalo cho tin này.
- Không tự trả phiếu lại khi member nạp tiền: member tự vote lại.

**Không được xảy ra**

- Bỏ nhầm phiếu của member không nợ tới hạn mức (ví dụ vì số dư tạm thời trong lúc chốt sổ lại).
- Bỏ phiếu ở buổi đã đóng vote / đã chốt / đã hủy (lúc đó danh sách là việc của admin).
- Một lần âm quỹ mà admin nhận nhiều tin trùng.
- Chặn cả việc member **bỏ** phiếu của mình.

## 4. Thiết kế

### 4.1 Một hàm kiểm nợ dùng chung (lib)

`isVoteBlockedByDebt(balance, threshold)` = `balance <= -threshold` (giữ đúng phép so sánh trang chủ đang dùng; hạn mức đặt 0 thì member số dư 0 cũng bị chặn, đúng như trang chủ hiện nay), đặt trong `src/lib/fund-core.ts` cạnh `VOTE_BLOCK_DEBT_THRESHOLD`. Trang chủ, trang `/vote/[id]`, `submitVote`, admin UI, và bước tự bỏ phiếu đều gọi hàm này. Không ai tự viết lại phép so sánh.

### 4.2 Chặn ở server và ở trang vote (lên prod ngay, trên `main`)

- `submitVote`: sau khi kiểm buổi, tính số dư member, nếu bị chặn và lần gửi này **có** chơi hoặc nhậu thì trả `{ error }` kèm số nợ và hạn mức (i18n vi/en/zh). Gửi "bỏ vote" (không chơi, không nhậu) vẫn cho qua.
- Trang `/vote/[id]`: cùng logic trang chủ. Bị chặn thì hiện banner nợ + nút nạp quỹ (`FundBalanceBanner`) thay cho nút vote, kèm câu nói rõ "nợ từ X trở lên thì không vote được".
- Admin vote hộ (`adminSetVote`, `adminSetPartner`, `adminSetGuestCount`) **không bị chặn** (quyết định của mình: admin chủ động thêm là quyết định có chủ đích, ví dụ member đã chuyển khoản nhưng chưa ghi sổ). Trong danh sách vote của admin, MỌI dòng member đang nợ quá hạn mức đều có chip cảnh báo "Nợ quá hạn mức" cạnh tên (kể cả buổi đã quá hạn vote, nơi phiếu không tự bị bỏ), để admin tự quyết.

### 4.3 Tự bỏ phiếu khi chạm hạn mức (lên prod ngay, trên `main`)

- Hàm `enforceDebtVoteBlock(tx, memberIds)`: với mỗi member, tính số dư **trong tx**, nếu bị chặn thì xoá phiếu của member đó ở các buổi **vote còn mở** theo đúng `isVoteOpen` (`src/lib/session-status.ts`: trạng thái `voting` hoặc `confirmed` và chưa quá hạn vote), tức đúng điều kiện `submitVote` đang cho vote. Xoá dòng phiếu, đúng cách "bỏ vote" hiện tại (`submitVote` xoá dòng, xem `splitMembersByVote`).
- **Gọi ở cuối mỗi thao tác tiền có ghi sổ cho member, sau khi đã ghi xong mọi dòng sổ của thao tác đó**, KHÔNG gọi sau từng dòng (chốt sổ lại có bước đảo khoản cũ rồi ghi khoản mới; kiểm giữa chừng có thể thấy số dư tạm thời thấp và bỏ nhầm). Gọi cả với thao tác làm TĂNG số dư cũng vô hại (không chặn thì không làm gì), nên quy tắc đơn giản là: thao tác nào ghi sổ có `memberId` thì gọi.
- Một hàm chung `afterMemberMoneyChange(tx, changes)` (`changes` = danh sách `{ memberId, balanceBefore }`) gánh cả 4.3 lẫn 4.4. Thao tác nào chưa có `db.transaction` thì bọc lại để số dư trước/sau và việc xoá phiếu nằm cùng một tx.
- Các chỗ ghi sổ hiện có (kiểm 6/11/2026, theo file gọi `recordFinancialTransaction`): `src/actions/finance.ts` (`finalizeSession`, `finalizeSessionAuto`, `confirmPayment*`, `undoPaymentByAdmin`...), `src/actions/fund.ts` (`recordContribution`, `recordRefund`, `reverseFinancialTransaction`, `confirmFundClaim`), `src/actions/sessions.ts` (`deleteSession`, `reopenSession`, `cancelSession`...), `src/actions/members.ts` (`mergeMember`), `src/actions/merge-debt-fund.ts`, `src/lib/auto-fund-core.ts`, `src/lib/payment-matcher.ts`. Không áp: `court-rent.ts`, `inventory.ts` (không ghi cho member), `ledger-restore.ts` (khôi phục sao lưu, không phải thao tác nghiệp vụ). Builder rà lại từng hàm trong các file trên.
- **Chống sót về sau:** thêm một test quét mã nguồn: file nào gọi `recordFinancialTransaction` thì phải gọi `afterMemberMoneyChange`, trừ danh sách miễn ghi rõ (3 file ở trên). Thêm chỗ ghi sổ mới mà quên thì test đỏ.
- Admin hạ hạn mức trong Cài đặt: chạy `enforceDebtVoteBlock` cho mọi member đang có phiếu ở buổi mở vote (thao tác hiếm, chấp nhận chi phí).
- **Ngoại lệ (thêm sau review cuối 6/11/2026):** không bao giờ tự bỏ phiếu ở buổi ĐÃ TỪNG chốt sổ (còn dòng `fund_deduction` gắn buổi, kể cả khi đã mở khoá). Mở khoá đưa buổi về `voting` không hạn, mà chốt lại lấy người chơi từ phiếu, nên xoá ở đây làm bỏ sót tiền của member nợ. Member là admin cũng không bị tự bỏ phiếu (số dư admin lên xuống theo tiền pass sân / phần dư sàn, và admin tự vote hộ).
- Phiếu có khách do admin thêm trên dòng của member (`votes.guestPlayCount`, ghi qua `adminSetGuestCount`) và người đi kèm (`votes.withPartner`): bị xoá cùng dòng (vì member trả tiền cho họ). Admin thêm lại nếu muốn. Khách của chính admin nằm ở `sessions.adminGuest*`, không bị đụng.
- Mỗi lần tự bỏ: `revalidatePath` trang chủ, `/vote/[id]`, trang admin buổi đó.
- Member hiện đã quá hạn mức mà còn phiếu (như Nguyen Thanh): chạy `enforceDebtVoteBlock` một lần sau deploy bằng script có chế độ chạy thử (in danh sách trước, user xác nhận rồi mới xoá thật). Script đọc hạn mức từ setting hiện tại trên DB (không nhận tham số), dùng đúng `isVoteBlockedByDebt` và cùng điều kiện buổi như 4.3.

### 4.4 Báo admin khi vừa âm quỹ (vào chuông N1, nhánh `feat/notifications`)

Quyết định của mình: **đưa vào chuông admin của N1**, không làm khung cảnh báo riêng trên `main`. Lý do:

- N1 chính là "thông báo trong site Admin" user đã duyệt 4/11: có chuông admin, chống gửi trùng theo khoá, danh mục tin admin. Làm thêm một khung riêng trên `main` thì sau này có 2 nơi báo cùng một việc, phải gỡ một cái.
- Dashboard admin hiện đã liệt kê member đang nợ, nên trong lúc chờ N1, admin vẫn xem được ai đang âm.
- Đánh đổi: tin này chỉ có khi N1 lên prod (cùng cụm G2, theo quyết định 4/11).

Cách làm:

- Loại tin mới `member_balance_negative` trong `catalog.ts` của N1, gửi superadmin (`superadminRecipients`), nội dung: tên member, số dư mới, thao tác gây ra (chốt sổ buổi ngày D / hoàn tiền / chỉnh tay...). Link tới trang quỹ của member đó.
- Phát hiện "vừa âm" theo **từng thao tác**, như 4.3: lấy số dư ở ĐẦU thao tác (trước mọi dòng sổ của nó, kể cả bước đảo khoản cũ khi chốt lại) và ở CUỐI thao tác, chỉ báo khi đầu ≥ 0 và cuối < 0. Chốt lại một buổi mà member đã âm từ lần chốt trước thì đầu đã < 0, không báo lại. Khoá chống trùng: `member_balance_negative:<memberId>:<id dòng sổ cuối của thao tác>`.
- Dùng chung chỗ gọi với `enforceDebtVoteBlock` (một hàm "sau thao tác tiền" nhận danh sách member + số dư trước), để không phải rải 2 lần gọi ở mọi action.

## 5. Kiểm thử

- Unit: `isVoteBlockedByDebt` (đúng bằng hạn mức thì chặn, thiếu 1 đồng thì không).
- Integration (DB thử, không đụng prod): `submitVote` bị chặn khi nợ ≥ hạn mức; bỏ vote vẫn được; admin vote hộ vẫn được.
- Integration: chốt sổ đẩy member qua hạn mức thì phiếu ở buổi đang mở vote bị xoá, phiếu ở buổi đã quá hạn vote hoặc đã chốt còn nguyên; chốt sổ lại (đảo rồi ghi lại) với member vẫn dưới hạn mức thì KHÔNG bỏ phiếu.
- Integration (nhánh N1): ≥0 sang <0 báo đúng 1 tin; đang âm rồi âm thêm không báo; chạy lại thao tác (idempotent) không báo trùng.
- E2E: member nợ mở `/vote/[id]` thấy banner nợ, không có nút vote.
- Mọi thay đổi đụng code tiền chạy qua agent `finance-invariant-reviewer` trước khi merge.

## 6. Thứ tự giao

1. Phần 4.1 + 4.2 + 4.3 trên `main`, deploy prod ngay sau khi đủ 4 cổng + e2e, rồi chạy script dọn phiếu (có xác nhận).
2. Phần 4.4 trên `feat/notifications`, lên prod cùng N1/G2.
