# Trang sân kiểu bản đồ trước (làm lại `/venues`)

Ngày: 9/11/2026. User xem `lwcifer.io.vn/san` và chê "sơ sài", bảo tham khảo Google Maps và Alobo cả về UI/UX lẫn tính năng. Việc user cần: **tìm sân quanh một vị trí bất kỳ, và nhìn trên bản đồ sân nào quanh đó đang có buổi giao lưu**. Khi được hỏi chọn bản đồ trước hay danh sách trước, user trả lời "tùy mày, xem cái nào UI/UX ok hơn thì làm". Vì vậy mọi lựa chọn bố cục dưới đây là của người viết, ghi rõ để user soát.

## Hiện trạng (bản mới nhất trên nhánh, đã có bản đồ G3, chưa lên prod)

Ảnh chụp 390px: `scratchpad/venues-shots/1-list.png`, `2-map.png`. Code: `src/app/(exchange)/venues/{page,venue-directory,venue-map-panel}.tsx`, `src/components/map/map-view.tsx`, `src/components/venues/{venue-card,location-fallback,use-user-location}.tsx|ts`, `src/actions/venues.ts` (`listVenuesNear`, `geocodeAddress`), `src/actions/exchange-read.ts` (`countUpcomingByVenue`, `listUpcomingAtVenue`).

Vấn đề thấy được:
1. Bộ lọc (4 bán kính + 6 tiện ích + "Đang có giao lưu") chiếm 4 hàng, bản đồ bắt đầu từ giữa màn hình.
2. Không có ô tìm địa chỉ thường trực. `geocodeAddress` (Nominatim, cache 7 ngày, giới hạn theo IP và toàn cục) chỉ hiện khi từ chối GPS.
3. Ghim sân có giao lưu trông giống ghim sân thường.
4. Thẻ sân cao, nút "Chỉ đường" to nhất thẻ; thông tin giao lưu chỉ là một dòng chữ nhỏ.

## Mục tiêu

1. **Mobile mở ra là bản đồ gần toàn màn hình** (trừ header app), với:
   - **Ô tìm kiếm nổi** trên cùng: "Tìm khu vực, địa chỉ, tên sân". Gõ tên sân thì gợi ý ngay các sân đã tải có tên khớp (không gọi server). Bấm Enter / nút tìm thì gọi `geocodeAddress` (đã có), bay bản đồ tới đó và tìm sân quanh đó. Bên phải ô có nút "vị trí của tôi".
   - **Một hàng chip vuốt ngang** dưới ô tìm: "Có giao lưu" (bật/tắt), "Bán kính 5 km ▾" (mở bảng chọn), "Tiện ích ▾" (mở bảng chọn nhiều), "Đang mở cửa" (lọc theo `open_hours` và giờ hiện tại, tính ở client). Chip đang bật có màu nhấn.
   - **Ngăn danh sách kéo từ dưới lên** (bottom sheet 3 nấc: thấp chỉ hiện tiêu đề "N sân quanh đây", giữa ~45% màn hình, cao gần toàn màn hình). Kéo bằng tay cầm hoặc vuốt; bấm tiêu đề thì nhảy nấc. Danh sách trong ngăn là thẻ sân gọn.
2. **Ghim:**
   - Sân có buổi giao lưu sắp tới: ghim màu nhấn khác (token theme, không gõ cứng màu) kèm số buổi trên ghim, nằm trên các ghim thường.
   - Ghim đang chọn to hơn và nổi lên.
   - Bấm ghim: ngăn danh sách chuyển sang **thẻ xem nhanh** của sân đó (tên, khoảng cách, giá/giờ, giờ mở cửa và trạng thái "Đang mở/Đã đóng", tiện ích dạng icon, tối đa 3 buổi giao lưu sắp tới có giờ, phí, slot còn trống; nút Chỉ đường, Gọi (nếu có số), Chia sẻ, Xem chi tiết). Vuốt xuống hoặc bấm X thì về danh sách.
   - Bấm thẻ trong danh sách thì bản đồ bay tới ghim đó và mở thẻ xem nhanh.
3. **Thẻ sân gọn (dùng chung danh sách và desktop):** một hàng tên + khoảng cách; một hàng "N sân · giá/giờ · Đang mở/Đã đóng (giờ)"; một hàng icon tiện ích; nếu có giao lưu thì một dải nổi bật "2 buổi giao lưu: T3 19:30, CN 8:00". "Chỉ đường" thành nút icon nhỏ, không chiếm cả hàng.
4. **Desktop (`md:` trở lên):** bố cục 2 cột như Google Maps: cột trái rộng ~400px có ô tìm, chip, danh sách cuộn; bên phải bản đồ chiếm phần còn lại; chọn sân thì cột trái hiện thẻ xem nhanh thay danh sách (có nút quay lại).
5. **Kéo bản đồ sang chỗ khác:** hiện nút nổi "Tìm ở khu vực này" (giữ quy tắc G3: không tự gọi server khi kéo/zoom). Bấm thì tìm quanh tâm bản đồ với bán kính đang chọn.
6. **Trang chi tiết `/venues/[id]`:** làm lại cho đầy đặn: ảnh bản đồ nhỏ ở đầu, khối thông tin (địa chỉ, giờ mở cửa và trạng thái, số sân, giá tham khảo, SĐT bấm gọi được, tiện ích có nhãn), hàng nút (Chỉ đường, Gọi, Chia sẻ, Đề xuất sửa nếu đã có), danh sách buổi giao lưu sắp tới dạng thẻ có nút vào buổi, và chỗ trống "Đánh giá sân: sắp có" (G2d sẽ lấp vào, không làm ở đây).
7. **URL giữ trạng thái** (nuqs, tên tiếng Anh): `view` bỏ đi (luôn bản đồ trên mobile), giữ `r` (bán kính), `amenities`, `exchange` (có giao lưu), thêm `open` (đang mở cửa), `lat`/`lng` khi người dùng tìm theo địa chỉ hoặc "Tìm ở khu vực này" (để chia sẻ link một khu), `venue` (sân đang chọn). Link `/venues?view=list` cũ vẫn mở được (bỏ qua tham số lạ).

## Không làm

- Không thêm truy vấn DB mới cho danh sách/bản đồ; dùng `listVenuesNear` + `countUpcomingByVenue` có sẵn. Thẻ xem nhanh lấy buổi giao lưu qua `listUpcomingAtVenue` (đã có cache tag `exchange`) chỉ khi người dùng bấm ghim.
- Không tự gọi server khi kéo/zoom, không polling.
- Không đổi nguồn tìm địa chỉ (giữ Nominatim qua `geocodeAddress`, giữ giới hạn tần suất), không gợi ý địa chỉ theo từng phím gõ (Nominatim cấm autocomplete).
- Không đánh giá sân, không ảnh sân, không đặt sân (G2d / sau này).
- Không đổi trang `/exchanges` (bản đồ giao lưu riêng) ngoài việc dùng chung thẻ/ghim nếu tiện.
- Không thêm thư viện bottom sheet; tự làm bằng framer-motion `drag="y"` (đã có trong dự án).

## Ràng buộc

- Mobile-first 390px, vùng chạm ≥ 44px, chữ ≥ 16px, không cuộn ngang. Bản đồ không cướp cuộn: trên trang này bản đồ chiếm màn hình nên kéo một ngón là kéo bản đồ (bỏ cooperative gestures ở trang này, vì không còn nội dung trang để cuộn phía trên bản đồ); trang chi tiết vẫn dùng bản đồ tĩnh.
- Thư viện bản đồ vẫn tải lười; skeleton đúng cỡ; máy không có WebGL thì tự rơi về dạng danh sách đầy đủ (không có bản đồ) kèm một dòng giải thích.
- Giữ nguyên quy tắc chủ quyền ở mọi bản đồ: nhãn Quần đảo Hoàng Sa / Trường Sa (Việt Nam), ẩn tên nước ngoài và biên tranh chấp, "Biển Đông". Kết quả tìm địa chỉ rơi vào hai vùng này thì nhãn hiển thị dùng tên Việt Nam (không dùng nhãn Nominatim trả về).
- Màu theo CSS variables của theme (sáng, tối, hồng). Chữ đủ vi/en/zh, không em dash.
- Quota Turso: số truy vấn mỗi lần tải trang không tăng so với hiện tại; bấm ghim tốn tối đa 1 lần đọc qua cache.
- Route và tham số tiếng Anh (user 6/11/2026).
- Không lên prod lẻ: nằm trong đợt deploy chung của G2 (user 4/11/2026). Nhánh `feat/venues-map-first` từ `ac24260`.

## Thất bại nếu

- Mở trang trên điện thoại mà vẫn phải cuộn mới thấy bản đồ.
- Gõ một địa chỉ (vd "Cầu Giấy") mà không có gì xảy ra hoặc không bay tới đó.
- Nhìn bản đồ không phân biệt được sân có giao lưu.
- Ngăn kéo giật, kẹt, hoặc chặn thao tác bản đồ khi đang ở nấc thấp.
- Trong trình duyệt nhúng Zalo/Messenger không dùng được (trắng màn hình, không kéo được ngăn).

## Để lại cho người xây

Tên component, cách chia file, ngưỡng vận tốc vuốt của ngăn kéo, icon cụ thể cho tiện ích, cách parse `open_hours` (định dạng hiện có `HH:MM-HH:MM`; không parse được thì không hiện trạng thái mở cửa và không lọc sân đó ra khi bật "Đang mở cửa"... người xây quyết, ghi trong plan).

## Quyết định sau khi rà (của người viết, 9/11/2026)

1. "Tìm ở khu vực này" tìm quanh **tâm bản đồ** với bán kính đang chọn (giữ cách G3, `listVenuesNear` không đổi). Vòng bán kính vẽ trên bản đồ. "N sân quanh đây" là số sân trong bán kính quanh điểm tìm, không phải số ghim đang nhìn thấy.
2. Enter trong ô tìm: nếu khớp tên một sân đã tải thì chọn sân đó (bay tới + thẻ xem nhanh); không khớp thì gọi `geocodeAddress`; không thấy thì báo "Không tìm thấy địa điểm này" ngay dưới ô (không im lặng).
3. Tâm ban đầu: tham số `lat`/`lng` trên URL nếu có (và tải luôn sân quanh đó); không có thì GPS; trong lúc chờ GPS hoặc khi bị từ chối thì dùng điểm tìm gần nhất lưu ở `localStorage`, không có nữa thì trung tâm Hà Nội (21.0285, 105.8542), zoom ~12, tải sân quanh đó ngay và hiện một dòng nhỏ "Đang xem quanh Hà Nội. Bật vị trí hoặc gõ khu vực để đổi." Bản đồ hiện ngay từ lần vẽ đầu, không chờ GPS.
4. "Đang mở cửa": tính theo giờ Việt Nam (Asia/Ho_Chi_Minh), hỗ trợ khoảng qua nửa đêm (`22:00-02:00`). Không parse được giờ thì hiện "Chưa rõ giờ" và **bị loại** khi bật chip "Đang mở cửa" (chip có nghĩa là chắc chắn đang mở).
5. Không gom cụm ghim (giữ G3-R2, tối đa 50 ghim). Ghim giao lưu luôn nằm trên ghim thường.
6. Khung bản đồ toàn màn hình trừ header app và thanh điều hướng dưới (member đăng nhập có bottom nav, khách thì không), cộng safe-area. Ngăn kéo nấc thấp nằm ngay trên bottom nav.
7. Test: test G3 về chủ quyền, ghim, `map-view`, `map-points` giữ xanh nguyên văn. Test của phần bị thay (nút Danh sách/Bản đồ, bố cục cũ của `venue-directory`, `venue-map-panel`) được viết lại theo bố cục mới, nêu rõ test nào thay và vì sao.
