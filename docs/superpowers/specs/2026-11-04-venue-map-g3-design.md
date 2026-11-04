# G3: Bản đồ sân trong app

Ngày: 4/11/2026. User chọn làm G3 trước G2b ("có bản đồ chưa?" → chọn hướng 1, rồi "ok rồi" = cho tự làm, không hỏi thêm). Mọi quyết định dưới đây là của người viết spec, ghi rõ để user soát.

## Vì sao

Trang `/san` (G1, đã lên prod) chỉ có danh sách sân xếp theo khoảng cách và nút chỉ đường Google Maps. Người tìm sân muốn nhìn sân nằm ở đâu so với mình, thấy cụm sân trong khu vực, và dò sang khu khác mà không phải chọn quận lại. Bản đồ cũng là nền để G2b thêm ghim buổi giao lưu.

## Mục tiêu

1. Trang `/san` có nút chuyển **Danh sách / Bản đồ** (lưu trên URL bằng nuqs `view=list|map`, mặc định `list`). Bản đồ hiện đúng các sân của truy vấn đang có (cùng bán kính, cùng bộ lọc tiện ích), chấm "bạn đang ở đây", vòng tròn bán kính.
2. Bấm một ghim: mở thẻ sân ở dạng bottom sheet trên mobile (popup/panel cạnh bản đồ từ `sm:`), dùng lại `VenueCard`, có link xem chi tiết và chỉ đường.
3. Kéo bản đồ sang chỗ khác thì hiện nút **"Tìm ở khu vực này"**. Chỉ khi bấm nút mới gọi lại `listVenuesNear` với tâm bản đồ (không tự gọi khi kéo, để giữ quota Turso).
4. Trang chi tiết `/san/[id]`: bản đồ nhỏ tĩnh (không kéo được trên mobile để không cướp thao tác cuộn) với một ghim, bấm vào mở chỉ đường.
5. Form đề xuất / sửa sân (`venue-form.tsx`): thêm "Chọn trên bản đồ" khi người dùng không có link Google Maps tách được toạ độ: kéo ghim, ghi lat/lng vào đúng các ô toạ độ hiện có.
6. Sẵn chỗ cho G2b: lớp ghim được viết dạng danh sách điểm có `kind` (`venue` hôm nay; `exchange` sau này) để G2b chỉ thêm dữ liệu và kiểu ghim.

## Không làm

- Không thêm truy vấn server mới, không đổi `listVenuesNear` (trừ khi cần thêm tham số tâm, mà tâm đã là `lat/lng`).
- Không tự gọi server khi kéo/zoom bản đồ. Không polling.
- Không định tuyến đường đi trong app (vẫn mở Google Maps).
- Không ghim buổi giao lưu (G2b).
- Không bản đồ ở trang admin duyệt sân (để sau nếu cần).
- Không key/API trả phí.

## Thất bại nếu

- Trang `/san` chậm hơn hoặc tải nặng hơn khi người dùng không bấm "Bản đồ" (thư viện bản đồ phải tải lười, chỉ khi mở chế độ bản đồ hoặc khi trang chi tiết có bản đồ).
- Trong trình duyệt nhúng Zalo/Messenger bản đồ trắng mà không có lời giải thích (máy không có WebGL thì hiện thông báo + nút quay về danh sách).
- Bản đồ cướp cuộn trang trên mobile.

## Cách làm (quyết định của người viết)

- Thư viện: `maplibre-gl` (ghim đúng phiên bản đã phát hành ≥ 2 tuần), dùng trực tiếp qua một component client nạp bằng `next/dynamic` `ssr: false`. Không thêm `react-map-gl` (một lớp phụ thuộc nữa không cần cho vài ghim).
- Nền bản đồ: OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`), miễn phí, không key. Ghi công OSM/OpenFreeMap hiển thị đúng yêu cầu giấy phép. Theme tối: dùng style tối nếu OpenFreeMap có, không thì giữ liberty (người xây quyết sau khi xem thực tế).
- Ghim: phần tử HTML (marker) theo màu theme qua CSS variables, vùng chạm ≥ 44px; nhiều sân trùng chỗ thì gom cụm bằng `cluster` của nguồn GeoJSON maplibre nếu > 30 điểm, không thì ghim thường.
- `next.config.ts` hiện chưa có CSP, nên tải tile từ openfreemap không bị chặn. Permissions-Policy geolocation đã là `(self)` từ G1.
- Mobile-first: bản đồ cao `60dvh` trên mobile, bottom sheet framer-motion; từ `sm:` bản đồ + panel thẻ sân. Skeleton đúng kích thước khi đang tải thư viện.
- Chuỗi vi/en/zh trong namespace `venues`.

## Nhánh và thứ tự merge

Worktree `D:/Lwcifer/LW/FWBB-g3`, nhánh `feat/g3-map` từ `feat/g2-exchange` 301d835 (trang sân nằm ở route group `(exchange)` của G2a). Không migration. Theo quyết định của user 4/11: không lên prod cho tới khi xong hết luồng (G2a + N1 + G2b + ...); merge sau G2a, cùng đợt với N1.

## Để lại cho người xây

Kích thước ghim, mức zoom mặc định theo bán kính, chi tiết gom cụm, style tối cụ thể, cách test component bản đồ (mock `maplibre-gl` trong jsdom; e2e Playwright chỉ kiểm nút chuyển chế độ, ghim hiện, bấm ghim mở thẻ).
