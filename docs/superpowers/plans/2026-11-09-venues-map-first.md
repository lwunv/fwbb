# Trang sân kiểu bản đồ trước (`/venues`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở `/venues` trên điện thoại là thấy ngay bản đồ gần toàn màn hình, có ô tìm nổi, một hàng chip lọc, ngăn danh sách kéo 3 nấc, ghim sân có giao lưu nổi bật, thẻ xem nhanh khi bấm ghim; desktop 2 cột kiểu Google Maps; trang chi tiết `/venues/[id]` đầy đặn hơn. Không thêm truy vấn DB, không tự gọi server khi kéo/zoom.

**Architecture:** Logic thuần (giờ mở cửa, tâm bản đồ, lọc, khớp tên, nấc ngăn kéo, nhãn quần đảo) nằm ở `src/lib/venues/*` và `src/lib/map/island-label.ts`, test bằng vitest không cần DOM. Trạng thái URL đi qua hook nuqs `useVenueUrlState`; mọi trạng thái dữ liệu của màn (tâm, quyền GPS, truy vấn, lọc, chọn sân) gom trong hook `useVenueDirectoryState` để test riêng. `VenueDirectory` chỉ còn là màn ghép: khung dựng bằng CSS mobile-first, `LazyMapView` luôn ở một chỗ trong cây (trong lớp `isolate`), lớp nổi `VenueSearchBar` + `VenueFilterChips` (`z-20`), `VenueSheet` (framer-motion, `z-10`, ẩn từ `md:`) hoặc cột trái desktop. `MapView` chỉ được thêm prop, hành vi cũ giữ nguyên. `venue-map-panel.tsx` bị xoá.

**Tech Stack:** Next.js 16.2.1 App Router (docs: `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, `01-app/03-api-reference/04-functions/use-search-params.md`, `01-app/03-api-reference/03-file-conventions/page.md`), React 19 (`useSyncExternalStore`), nuqs 2.8.9 (`useQueryStates`, `NuqsTestingAdapter`), @tanstack/react-query 5, framer-motion 12 (`useMotionValue`, `animate`, `useDragControls`), maplibre-gl 6.15.0, next-intl (vi/en/zh, ICU plural), Tailwind v4 token theme, vitest + jsdom, Playwright (chromium, `hasTouch`).

**Spec:** `docs/superpowers/specs/2026-11-09-venues-map-first-design.md` (mục "Quyết định sau khi rà" là ràng buộc cứng). Quy ước kế thừa: `D:/Lwcifer/LW/FWBB-g2c/docs/superpowers/plans/2026-11-06-exchange-comments-g2c.md`. Bản rà plan: `.superpowers/venues/plan-review.md` (33 mục, xử lý ở cuối plan).

## Global Constraints

- **Nơi làm:** chỉ worktree `D:/Lwcifer/LW/FWBB-venuesux`, nhánh `feat/venues-map-first` (từ `ac24260`, HEAD lúc viết plan `45a2b5a`). Không push, không merge, không deploy: nhánh lên prod cùng đợt G2 (memory `feedback_g2_local_until_complete`).
- **Env và DB:** KHÔNG đọc, tạo hay sửa file `.env*`. Env test: `.superpowers/venues/test-env.sh` và `.superpowers/venues/local-db.env` (Task 0 copy từ `D:/Lwcifer/LW/FWBB-g2c/.superpowers/g2c/`). DB test `e2e/local.db` (kèm `-wal`, `-shm` nếu có) copy từ `D:/Lwcifer/LW/FWBB-g2c`, kiểm `pragma integrity_check` = `ok`.
- **4 cổng, đọc exit trực tiếp** (`cmd > .superpowers/venues/<tên>.log 2>&1; echo "x_exit=$?"`, không qua `| tail`): `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/venues/test-env.sh && pnpm build`, cộng full e2e `source .superpowers/venues/test-env.sh && pnpm test:e2e`. Playwright chạy bản `next build` gần nhất: sửa `src/` thì build lại trước e2e.
- **Lỗi có sẵn:** `e2e/product-tour.spec.ts` đỏ sau 20:30 giờ máy, không phải lỗi của nhánh; chạy lại trước 20:30 hoặc ghi rõ. Cổng 3101 bận thì dùng `.superpowers/venues/playwright.3111.config.ts`.
- **Quota Turso:** không thêm truy vấn DB khi tải trang; chỉ `listVenuesNear` + `countUpcomingByVenue` có sẵn, và chỉ bắn sau khi đã biết quyền GPS và vùng đã lưu (Task 7). Không gọi server khi kéo/zoom, không `usePolling`, không `refetchInterval`, không `setInterval`. Bấm ghim tốn tối đa 1 lần `listUpcomingAtVenue` (qua cache tag `exchange`; cộng 1 lần đọc settings trong `exchangeGate`), react-query `staleTime: 60_000`. Kết quả tìm địa điểm thành công được nhớ ở client theo chuỗi đã chuẩn hoá, Enter lại cùng chuỗi không gọi server.
- **Chủ quyền (G3):** mọi bản đồ giữ nhãn "Quần đảo Hoàng Sa (Việt Nam)" / "Quần đảo Trường Sa (Việt Nam)", ẩn tên nước ngoài và biên tranh chấp, "Biển Đông". Kết quả tìm địa chỉ trong 2 vùng `VN_ISLAND_AREAS` vẫn bay tới đó và hiển thị nhãn Việt Nam. `isInVietnam` (dùng cho đề xuất sân) KHÔNG đổi. `src/lib/map/sovereignty.test.ts`, `src/lib/map/map-points.test.ts`, `src/components/map/map-view.test.tsx` giữ xanh NGUYÊN VĂN (chỉ thêm test ở file mới; không thêm method vào mock cũ).
- **Giao diện:** mobile-first 390px, vùng chạm ≥ 44px (`min-h-11`), chữ nội dung ≥ 16px (`text-base`), nhãn ≥ 14px, không cuộn ngang trang (hàng chip cuộn ngang bên trong là chủ ý). Chỉ màu token theme (sáng/tối/hồng). Ngăn kéo bằng framer-motion, không thêm thư viện sheet. Skeleton đúng cỡ. HTML từ server không được phụ thuộc bề rộng máy hay WebGL (không lệch hydrate).
- **Chữ:** mọi chuỗi mới ở namespace `venues` đủ vi/en/zh (en dùng ICU plural khi có `{count}`), `src/i18n/locale-parity.test.ts` xanh, không em dash ("—") hay en dash ("–") trong chuỗi.
- **Route và tham số tiếng Anh:** `r`, `amenities`, `exchange`, `open`, `lat`, `lng`, `venue`.
- **Commit:** Conventional Commits 1 dòng, không body, không trailer.

### Quy ước dùng chung

| Việc | Quy ước |
|---|---|
| Bán kính | `VENUE_RADII = [3, 5, 10, 20] as const`, mặc định 5 |
| Tâm mặc định | `DEFAULT_CENTER = { lat: 21.0285, lng: 105.8542 }` (Hà Nội), zoom 12 (`zoomForRadiusKm(5)`) |
| "Tìm ở khu vực này" | hiện khi tâm bản đồ lệch tâm tìm hơn `radius * 0.3` km (`SEARCH_HERE_RATIO`, giữ từ G3) |
| Toạ độ trên URL | làm tròn 5 chữ số; chỉ nhận khi hữu hạn và `isInVietnamOrIslands` |
| localStorage | khoá `fwbb.venues.lastArea`, `{ lat, lng, label }`; mọi truy cập trong `try/catch` |
| Lịch sử URL | `venue` ghi bằng `history: "push"` (Back đóng thẻ xem nhanh); tham số khác `replace`; luôn `shallow` |
| Tầng z trong khung trang | lớp bản đồ `isolate` (z của ghim bị giam trong đó); ngăn kéo `z-10`; lớp nổi (ô tìm, chip, viên trạng thái) `z-20`, hàng ngoài `pointer-events-none`, từng control `pointer-events-auto` |
| Nấc ngăn kéo | `low` lộ 72px; `mid` mép trên ở 55% khung; `high` mép trên = đáy lớp nổi đo thật + 8px |
| Bố cục | khung và lưới dựng bằng class CSS (`md:` = 768px); hook `useMediaQuery("(min-width: 768px)")` chỉ quyết nội dung panel, trả `null` trước khi mount (khi đó panel là skeleton) |
| Màu ghim giao lưu | token `--warning`, lái bằng `data-exchange="true"` |

## Review Focus

1. **Trình duyệt nhúng Zalo/Messenger, ngăn ở nấc thấp:** một ngón kéo trên vùng bản đồ (kể cả dải dưới ô tìm) kéo được bản đồ; ghim không vẽ đè hay ăn chạm trên ngăn và ô tìm; thả ngăn giữa chừng luôn về một nấc. Test ở Task 5, 8, 12.
2. **Giờ mở cửa gõ tự do:** "5:00 - 23:00", "5h-22h", "22:00-02:00", "24/7", "05:00-11:00, 14:00-22:00", chuỗi rỗng, "6:00-6:00", "T2-T6 5:00-22:00", "Sáng 5-9": parse đúng, hoặc "Chưa rõ giờ" và bị loại khi bật chip, không bao giờ báo sai "Đang mở". Test ở Task 1.
3. **Máy không ở múi giờ Việt Nam:** trạng thái theo giờ Việt Nam. Test ở Task 1.
4. **URL bị sửa tay hoặc link cũ:** `?lat=abc&lng=999`, `?r=7`, `?venue=-1`, `?amenities=foo`, `?view=list`, và `?lat=10&lng=114` (Trường Sa, hợp lệ): trang mở bình thường, không gửi giá trị bậy lên server. Test ở Task 1 và Task 7.
5. **Tìm địa chỉ khi Nominatim bận hoặc bị giới hạn, Enter liên tục, tên sân trùng tên khu:** câu lỗi server hiện dưới ô, không gọi trùng khi đang chờ, Enter rỗng không làm gì, "Cầu Giấy" bay tới quận chứ không chọn "Sân cầu lông Cầu Giấy". Test ở Task 6.

---

### Task 0: Chuẩn bị env và đo baseline

**Files:** không sửa code. Tạo `.superpowers/venues/` (gitignored).

- [ ] **Step 1:** `git -C D:/Lwcifer/LW/FWBB-venuesux status --short` chỉ có plan và `.superpowers/` chưa theo dõi; nhánh là `feat/venues-map-first`. `pnpm install`.
- [ ] **Step 2:** Copy `D:/Lwcifer/LW/FWBB-g2c/.superpowers/g2c/{test-env.sh,local-db.env,playwright.3111.config.ts}` sang `.superpowers/venues/`, đổi mọi đường dẫn `.superpowers/g2c` trong bản copy thành `.superpowers/venues`. `grep -n "TURSO_DATABASE_URL" .superpowers/venues/test-env.sh .superpowers/venues/local-db.env` ra `file:e2e/local.db` (chỉ in dòng này).
- [ ] **Step 3:** Kiểm không có tiến trình node nào mở `D:/Lwcifer/LW/FWBB-g2c/e2e/local.db`, rồi copy `local.db` (và `local.db-wal`, `local.db-shm` nếu có) sang `e2e/`. `node -e "require('@libsql/client').createClient({url:'file:e2e/local.db'}).execute('pragma integrity_check').then(r=>console.log(r.rows[0]))"` in `ok`. `git check-ignore .superpowers/venues/test-env.sh e2e/local.db` in cả hai.
- [ ] **Step 4:** Baseline 4 cổng + e2e, log `.superpowers/venues/base-<x>.log`, exit riêng. Expected: exit 0 hết (trừ product-tour sau 20:30, ghi rõ). Ghi số test pass vào `.superpowers/venues/ledger.md`. Đỏ sẵn ngoài product-tour thì dừng và báo.

### Task 1: Logic thuần: giờ mở cửa, tâm bản đồ, nhãn quần đảo, lọc, khớp tên, URL

**Files:**
- Create: `src/lib/venues/open-hours.ts`, `src/lib/venues/directory-state.ts`, `src/lib/map/island-label.ts`, `src/app/(exchange)/venues/use-venue-url-state.ts`
- Test: `src/lib/venues/open-hours.test.ts`, `src/lib/venues/directory-state.test.ts`, `src/lib/map/island-label.test.ts`, `src/app/(exchange)/venues/use-venue-url-state.test.tsx`

**Interfaces:**
- Produces (`open-hours.ts`):
  - `type OpenRange = { start: number; end: number }` (phút, `0..1440`).
  - `parseOpenHours(raw: string | null | undefined): OpenRange[] | null`. `null` = không parse được. Cả chuỗi (trim, chữ thường) chỉ gồm các khoảng cách nhau bởi `,` hoặc `;`; có chữ khác là `null`. Một khoảng: `H[:MM|hMM|.MM][h] <sep> H[:MM|hMM|.MM][h]`, `<sep>` là `-`, `–`, `~` hoặc `đến`, cho phép khoảng trắng. Giờ 0..24, phút 0..59, `24` chỉ với `00`. `"24/7"`, `"24h"`, `"0:00-24:00"` → `[{ start: 0, end: 1440 }]`. start = end (vd "6:00-6:00") → `null`.
  - `minutesInVietnam(now: Date): number` (`Intl.DateTimeFormat`, `timeZone: "Asia/Ho_Chi_Minh"`, `hourCycle: "h23"`).
  - `type OpenStatus = "open" | "closed" | "unknown"`; `openStatus(raw, now: Date): OpenStatus`. Khoảng thường mở khi `start <= m < end`; qua nửa đêm (`end < start`) mở khi `m >= start || m < end`.
- Produces (`island-label.ts`): `islandLabelAt(p: LatLng, locale: "vi" | "en" | "zh"): string | null` (hộp thứ i của `VN_ISLAND_AREAS.coordinates` → `VN_ISLAND_LABELS[i].name[locale]`); `isInVietnamOrIslands(p: LatLng): boolean` (= `isInVietnam(p) || islandLabelAt(p, "vi") !== null`). Không sửa `sovereignty.ts`, `geo.ts`.
- Produces (`directory-state.ts`):
  - `VENUE_RADII`, `type VenueRadius`, `DEFAULT_CENTER`, `SEARCH_HERE_RATIO = 0.3`, `LAST_AREA_KEY = "fwbb.venues.lastArea"`.
  - `parseUrlCenter(lat: number | null, lng: number | null): LatLng | null` (dùng `isInVietnamOrIslands`); `roundCoord(n: number): number`.
  - `type StoredArea = { lat: number; lng: number; label: string }`; `readStoredArea(): StoredArea | null`; `writeStoredArea(a: StoredArea): void` (nuốt lỗi storage, comment lý do: tiện ích, không phải nghiệp vụ).
  - `type CenterSource = "url" | "gps" | "stored" | "default"`; `resolveCenter(i: { url: LatLng | null; gps: LatLng | null; stored: StoredArea | null }): { center: LatLng; source: CenterSource; label: string | null }`, thứ tự url > gps > stored > default.
  - `filterVenues<T extends { id: number; openHours: string | null }>(venues: T[], o: { exchangeOnly: boolean; counts: Map<number, number> | undefined; openNow: boolean; now: Date }): T[]` (`exchangeOnly` mà `counts` undefined thì không lọc; hook ở Task 7 lo trạng thái đang đếm).
  - `normalizeName(s: string): string` (NFD, bỏ `\p{M}`, `đ` → `d`, chữ thường, gộp khoảng trắng); `matchVenuesByName<T extends { name: string; distanceM?: number }>(venues: T[], q: string, limit = 5): T[]` (dưới 2 ký tự → `[]`; tên chứa `q`; tiền tố trước rồi gần trước); `exactVenueMatch<T extends { name: string }>(venues: T[], q: string): T | null` (tên chuẩn hoá BẰNG `q` chuẩn hoá).
- Produces (`use-venue-url-state.ts`, `"use client"`): `venueUrlParsers = { r: parseAsNumberLiteral(VENUE_RADII).withDefault(5), amenities: parseAsArrayOf(parseAsStringLiteral(VENUE_AMENITIES)).withDefault([]), exchange: parseAsBoolean.withDefault(false), open: parseAsBoolean.withDefault(false), lat: parseAsFloat, lng: parseAsFloat, venue: parseAsInteger }`; `useVenueUrlState()` = `useQueryStates(venueUrlParsers, { history: "replace", shallow: true })`.

- [ ] **Step 1: Test đỏ** (`open-hours.test.ts`): `parses "5:00 - 23:00", "05:00-23:00", "5h-22h", "5h30-22h", "5.30-22.00", "5:00 đến 23:00"`; `two ranges "05:00-11:00, 14:00-22:00" are closed at 12:00 VN`; `"22:00-02:00" is open at 23:30 and 01:00, closed at 03:00`; `end is exclusive: "5:00-23:00" closed at 23:00, open at 5:00`; `"24/7", "24h", "0:00-24:00" are open all day`; `returns null for "", "   ", "abc", "6:00-6:00", "25:00-26:00", "5:61-6:00", "T2-T6 5:00-22:00", "Sáng 5-9"`; `openStatus is unknown for null and unparseable`; `2026-11-09T16:30:00Z is minute 1410 in Vietnam`.
- [ ] **Step 2: Test đỏ** (`island-label.test.ts`): `16.5,112.0 gives the Hoàng Sa label in vi`; `10.0,114.0 gives "Truong Sa Archipelago (Viet Nam)" in en`; `Hà Nội gives null`; `areas and labels have the same length`; `isInVietnamOrIslands accepts Hà Nội and 10,114, rejects Bangkok`.
- [ ] **Step 3: Test đỏ** (`directory-state.test.ts`): `parseUrlCenter rejects null, NaN, Infinity, lat 999 and Bangkok, accepts Hà Nội and 10,114`; `roundCoord keeps 5 decimals`; `resolveCenter prefers url, then gps, then stored, then Hà Nội`; `readStoredArea returns null for garbage JSON, wrong shape, outside Vietnam and when localStorage throws, and accepts a Trường Sa area`; `writeStoredArea round-trips and never throws when storage throws`; `filterVenues exchangeOnly keeps count > 0 and ignores the filter when counts is undefined`; `filterVenues openNow drops closed and unknown hours`; `matchVenuesByName ignores accents, ranks prefix matches first then by distance, caps at 5, returns [] under 2 chars`; `exactVenueMatch matches "san cau long cau giay" to "Sân cầu lông Cầu Giấy" but not "Cầu Giấy"`.
- [ ] **Step 4: Test đỏ** (`use-venue-url-state.test.tsx`, `renderHook` + `NuqsTestingAdapter`): `defaults to r=5, no amenities, exchange and open off, no lat/lng/venue`; `ignores r=7, amenities=foo and view=list`; `reads lat/lng as numbers and lat=abc as null`.
- [ ] **Step 5:** `pnpm test src/lib/venues src/lib/map/island-label "src/app/(exchange)/venues/use-venue-url-state"`: FAIL.
- [ ] **Step 6:** Viết 4 file.
- [ ] **Step 7:** Chạy lại Step 5: PASS.
- [ ] **Step 8: Commit** `feat(venues): add open hours, map center and url state helpers`

### Task 2: Ghim sân có giao lưu, bay tới ghim, chừa chỗ cho ngăn kéo

**Files:**
- Modify: `src/lib/map/map-points.ts`, `src/components/map/map-view.tsx`, `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/lib/map/venue-exchange-points.test.ts`, `src/components/map/map-view-venue-exchange.test.tsx` (mới; mock `maplibre-gl` riêng, có `setPadding`, `getZoom`, `isEasing`, `once`)

**Interfaces:**
- Produces:
  - `MapPoint` nhánh `"venue"` thêm `exchangeCount?: number`. `venuesToPoints` không đổi.
  - `venuesToPointsWithExchanges(venues: Pick<PublicVenue, "id" | "lat" | "lng" | "name">[], counts: Map<number, number> | undefined): MapPoint[]`: gắn `exchangeCount` chỉ khi > 0, giữ thứ tự đầu vào.
  - `MapViewProps` thêm (chỉ gọi API mới khi prop được truyền, không thêm option vào constructor):
    - `focus?: { lat: number; lng: number; seq: number } | null`: đổi `seq` → `easeTo({ center, zoom: Math.max(map.getZoom(), 14), padding: { bottom: bottomInset ?? 0 } })`, đặt cờ đang bay, xoá ở `moveend`; không đụng vòng bán kính, không gọi `onMoveEnd`.
    - `bottomInset?: number` (px): đổi giá trị → `map.setPadding({ bottom })` tức thì; nếu đang bay tới ghim thì hoãn tới `moveend` (không cắt cú bay).
    - `noticeClassName?: string`: vị trí khối "Không tải được nền bản đồ", mặc định `top-16` như cũ.
  - Ghim: ở nhánh CẬP NHẬT (cho cả ghim cũ lẫn mới) đặt `data-exchange` = `exchangeCount > 0`. Màu, badge và tầng z lái bằng class theo data attribute: SVG `group-data-[exchange=true]:fill-warning`, badge hiện số (kể cả 1) `group-data-[exchange=true]:border-warning`, nút `data-[exchange=true]:z-[5]`, ghim chọn vẫn `z-10`. `aria-label = t("pinWithExchanges", { label, count })`. `t` vào deps của effect ghim.
- Chuỗi `pinWithExchanges`: vi `"{label}, {count} buổi giao lưu sắp tới"`; en `"{label}, {count, plural, one {# upcoming exchange} other {# upcoming exchanges}}"`; zh `"{label}，{count} 场即将举行的交流"`.

- [ ] **Step 1: Test đỏ:** `venuesToPointsWithExchanges sets exchangeCount only above 0`; `undefined counts gives plain venue points`; `venue pin with exchangeCount 1 shows 1, data-exchange true and the exchanges aria-label`; `a pin created without exchanges turns into an exchange pin on rerender with count 2, and back to plain at 0`; `focus seq change eases to that point with the current bottom padding, without onMoveEnd`; `same focus seq twice eases once`; `bottomInset change sets padding immediately when idle`; `bottomInset change during a focus flight waits for moveend and the last easeTo keeps the pin center`; `noticeClassName moves the tiles notice`.
- [ ] **Step 2:** `pnpm test src/lib/map src/components/map`: test mới FAIL, test cũ PASS.
- [ ] **Step 3:** Viết.
- [ ] **Step 4:** `pnpm test src/lib/map src/components/map src/components/venues src/i18n`: PASS; `git diff --stat src/lib/map/map-points.test.ts src/lib/map/sovereignty.test.ts src/components/map/map-view.test.tsx` rỗng.
- [ ] **Step 5: Commit** `feat(map): highlight venues with upcoming exchanges and fly to a pin`

### Task 3: Thẻ sân gọn

**Files:**
- Create: `src/components/venues/amenity-icons.ts`
- Modify: `src/components/venues/venue-card.tsx`, `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/components/venues/venue-card.test.tsx`

**Interfaces:**
- Produces:
  - `AMENITY_ICONS: Record<VenueAmenity, LucideIcon>`: `parking` → `SquareParking`, `air_con` → `Snowflake`, `shuttle_shop` → `ShoppingBag`, `racket_rental` → `HandCoins`, `drinks` → `CupSoda`, `shower` → `ShowerHead`.
  - `VenueCard({ venue, locale, upcomingExchangeCount?, now?, onSelect?, selected? })` với `now?: Date` (thiếu thì `new Date()`, để chỗ gọi cũ còn qua `tsc` tới Task 8, 10), `onSelect?: () => void`, `selected?: boolean`.
  - Bố cục: hàng 1 tên (truncate, `text-base font-semibold`) + khoảng cách; hàng 2 nối " · ": `courtCountValue`, `pricePerHourValue`, `openStatusWithHours` (`openNow`/`closedNow` + giờ gốc) hoặc `hoursUnknown` (bỏ hẳn khi `openHours` rỗng); hàng 3 icon tiện ích, mỗi icon kèm `<span className="sr-only">` nhãn dịch và `title` cho chuột; dải giao lưu (`upcomingExchangeCount` > 0, khoá có sẵn `upcomingExchangeCount`, `bg-warning/15 text-foreground`); link icon Chỉ đường `size-11`, `aria-label = directionsTo`, tab mới.
  - Cấu trúc khi có `onSelect`: `div.relative` chứa `<button>` phủ cả thẻ (`absolute inset-0`, `aria-label` = tên sân) và nội dung; link Chỉ đường là phần tử anh em `relative z-10`. Không lồng `<a>` trong `<button>`, không `stopPropagation`. Không có `onSelect`: tên là `Link` `/venues/{id}`. Thẻ không còn số điện thoại.
- Khoá mới: `openNow`, `closedNow`, `hoursUnknown`, `openStatusWithHours` ("{status} ({hours})").

- [ ] **Step 1: Test đỏ.** Giữ nguyên văn: `tên sân là link tới trang chi tiết`, `không có giá → ...`, `hiện tiện ích theo bản dịch` (sr-only là text node nên vẫn xanh), cả `describe("VenueCard upcoming exchanges")`. Sửa `hiện khoảng cách, số sân, giá tham khảo, link chỉ đường mở tab mới` sang tên `/Chỉ đường tới/` (nút chỉ còn icon). Bỏ `số điện thoại là link tel:` (chuyển sang Task 4, thẻ gọn không có số). Thêm: `shows Đang mở with the raw hours at 10:00 VN for "5:00 - 23:00"`; `shows Chưa rõ giờ for "Sáng 5-9"`; `no hours part when openHours is null`; `with onSelect, tapping the card selects and tapping directions does not`; `with onSelect there is no anchor inside a button`; `directions control has class size-11`.
- [ ] **Step 2:** `pnpm test src/components/venues/venue-card`: FAIL.
- [ ] **Step 3:** Viết.
- [ ] **Step 4:** `pnpm test src/components/venues src/i18n`: PASS.
- [ ] **Step 5: Commit** `feat(venues): compact venue card with open status and amenity icons`

### Task 4: Thẻ xem nhanh

**Files:**
- Create: `src/components/venues/venue-quick-view.tsx`, `src/lib/share-link.ts`, `src/lib/exchange/format.ts`
- Modify: `src/components/exchange/exchange-card.tsx` (chỉ chuyển 2 hàm sang `format.ts` và import lại), `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/components/venues/venue-quick-view.test.tsx`, `src/lib/share-link.test.ts`, `src/lib/exchange/format.test.ts`

**Interfaces:**
- Consumes: `openStatus` (Task 1), `AMENITY_ICONS` (Task 3).
- Produces:
  - `src/lib/exchange/format.ts` (không `"use client"`): `exchangeWhenLabel(startAt: string, endAt: string, locale: string): string` (là `whenLabel` hiện có); `exchangeFeeText(fee: ExchangeCard["fee"], t: (key: "feeGender" | "feeCap" | "feeAbout" | "feeLocked", values: Record<string, string>) => string): string` (khối `feeText` hiện có, `shortMoney` chuyển theo). `ExchangeCard` dùng lại; `exchange-card.test.tsx` xanh nguyên văn.
  - `shareOrCopy(i: { title: string; url: string }): Promise<"shared" | "copied" | "cancelled" | "failed">`: `navigator.share` (AbortError → `"cancelled"`), không có thì `navigator.clipboard.writeText`, lỗi thì lùi `document.execCommand("copy")` qua input tạm như `copy-link-button.tsx`, hỏng hết mới `"failed"`.
  - `VenueQuickView({ venue, locale, exchangeCount, loadUpcoming, now, onClose, closeLabel }: { venue: PublicVenue & { distanceM?: number }; locale: "vi" | "en" | "zh"; exchangeCount: number | undefined; loadUpcoming?: (venueId: number) => Promise<ExchangeCard[]>; now: Date; onClose: () => void; closeLabel: "close" | "back" })`. `closeLabel` chọn nút X (`closeQuickView`) hay nút quay lại (`backToList`, desktop).
  - Nội dung: tên + khoảng cách; giá/giờ; giờ mở cửa + trạng thái; tiện ích icon + nhãn chữ hiện thấy; nếu `exchangeCount > 0` và có `loadUpcoming`: `useQuery({ queryKey: ["venue-upcoming", venue.id], queryFn: () => loadUpcoming(venue.id), staleTime: 60_000 })`, tối đa 3 dòng link `/exchanges/{code}`: `exchangeWhenLabel`, `exchangeFeeText`, `slotsLeftCount` theo `counts.freeTotal` hoặc `slotsFull`, kèm `exchange.search.femaleSlots` khi `freeFemaleOnly > 0` (như `ExchangeCard`); đang tải 3 dòng skeleton; lỗi `upcomingLoadError` + `retry`. Hàng nút 44px: Chỉ đường (tab mới), Gọi (`tel:` chỉ giữ `[0-9+]`, khi có `phone`), Chia sẻ (`shareOrCopy({ title: venue.name, url: \`${location.origin}/venues/${venue.id}\` })`: `"copied"` → `toast.success(shareCopied)`, `"failed"` → `toast.error(shareFailed)`, `"cancelled"` im lặng), Xem chi tiết (`Link`).
- Khoá mới: `call`, `share`, `shareCopied` ("Đã chép link"), `shareFailed`, `viewDetails`, `closeQuickView` ("Đóng"), `slotsLeftCount` ("Còn {count} chỗ", en plural), `slotsFull` ("Hết chỗ"), `upcomingLoadError`.

- [ ] **Step 1: Test đỏ:** `format: fee text and when label match what ExchangeCard showed`; `shareOrCopy uses navigator.share, then clipboard, then execCommand, maps AbortError to cancelled and total failure to failed`; `quick view shows hours with status, price, visible amenity labels, directions in a new tab and a tel link with digits only`; `no phone hides the call button`; `count 0 or no loader never calls loadUpcoming`; `count 2 calls loadUpcoming once and lists at most 3 exchanges with time, fee and Còn N chỗ`; `female-only free slots add the female note`; `loader error shows the message and retry calls it again`; `share copied shows the toast; cancelled shows nothing`; `close button calls onClose with the right label for close and back`.
- [ ] **Step 2:** `pnpm test src/components/venues/venue-quick-view src/lib/share-link src/lib/exchange/format`: FAIL.
- [ ] **Step 3:** Viết.
- [ ] **Step 4:** `pnpm test src/components/venues src/components/exchange src/lib src/i18n`: PASS.
- [ ] **Step 5: Commit** `feat(venues): add the venue quick view`

### Task 5: Ngăn kéo 3 nấc

**Files:**
- Create: `src/lib/venues/sheet-snap.ts`, `src/components/venues/venue-sheet.tsx`
- Modify: `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/lib/venues/sheet-snap.test.ts`, `src/components/venues/venue-sheet.test.tsx` (stub `ResizeObserver`; mock `animate` của framer-motion để kiểm đích)

**Interfaces:**
- Produces (`sheet-snap.ts`): `type SheetSnap = "low" | "mid" | "high"`; `SHEET_PEEK_PX = 72`; `SNAP_VELOCITY = 500`; `snapOffsets(containerH: number, topReserve: number): Record<SheetSnap, number>` (toạ độ mép trên tính từ đỉnh khung: `high = topReserve`, `low = containerH - SHEET_PEEK_PX`, `mid = clamp(round(containerH * 0.55), high + 48, low - 48)`); `settleSnap(offsets, y: number, velocityY: number): SheetSnap` (`|v| > SNAP_VELOCITY` → nấc kế theo hướng vuốt tính từ nấc gần `y` nhất, chặn ở hai đầu; còn lại nấc gần nhất); `nextSnapOnTap(s): SheetSnap` (low → mid → high → low).
- Produces (`venue-sheet.tsx`): `VenueSheet({ snap, onSnapChange, title, children, topReserve, frozen, onVisibleHeight, onDragClose }: { snap: SheetSnap; onSnapChange: (s: SheetSnap) => void; title: ReactNode; children: ReactNode; topReserve: number; frozen?: boolean; onVisibleHeight?: (px: number) => void; onDragClose?: () => void })`.
  - Chuyển động: `const y = useMotionValue(offsets[snap])`, panel `style={{ y }}`, `drag="y"`, `dragListener={false}`, `dragControls`, `dragMomentum={false}`, `dragConstraints={{ top: offsets.high, bottom: offsets.low }}`, `dragElastic: 0.05`. `onDragEnd(_, info)`: `next = settleSnap(offsets, y.get(), info.velocity.y)`; LUÔN `animate(y, offsets[next], spring)` kể cả khi `next === snap`, rồi `onSnapChange(next)` (hoặc `onDragClose()` khi có prop này và `next === "low"`). `snap` đổi từ ngoài, và `offsets` đổi do khung đổi cỡ, cũng đi qua `animate(y, ...)`; khi `frozen` (ô tìm đang focus, bàn phím mở) thì không animate theo đổi cỡ.
  - Cử chỉ (theo spec "kéo bằng tay cầm hoặc vuốt"): thanh tay cầm + tiêu đề (≥ 56px, `touch-action: none`) luôn bắt đầu kéo khi `pointerdown`. Vùng danh sách: ở `low`/`mid` vuốt trên danh sách cũng kéo ngăn (`touch-action: none`, danh sách không cuộn); ở `high` danh sách cuộn bình thường (`touch-action: pan-y`), chỉ khi `scrollTop <= 0` và ngón tay đi xuống (> 8px ở `pointermove`) mới `controls.start(event)` để thu ngăn.
  - Tiêu đề là `<button aria-expanded={snap !== "low"}>` → `onSnapChange(nextSnapOnTap(snap))`.
  - Kích thước: panel luôn cao `containerH - offsets.high`. Vùng danh sách có `padding-bottom` = phần bị khuất của nấc hiện tại (`offsets[snap] - offsets.high`) + `env(safe-area-inset-bottom)`, chỉ cập nhật khi đã dừng ở nấc. Ở `low`: vùng danh sách `inert` + `aria-hidden`.
  - Lớp ngoài `pointer-events-none absolute inset-0 overflow-hidden z-10 md:hidden`; panel `pointer-events-auto`. Đo khung bằng `ResizeObserver` nếu có (`typeof ResizeObserver !== "undefined"`), không thì `window.innerHeight`. `onVisibleHeight(containerH - offsets[snap])` chỉ gọi khi đã dừng ở nấc hoặc khung đổi cỡ, không gọi từng khung hình lúc kéo.
- Khoá mới: `sheetHandle` ("Kéo để xem thêm sân").

- [ ] **Step 1: Test đỏ** (`sheet-snap.test.ts`, H = 800, topReserve = 150): `offsets are high 150, mid 440, low 728`; `mid is clamped between high + 48 and low - 48 on a short container`; `slow release snaps to the nearest`; `fast upward flick from mid goes to high, downward goes to low`; `fast flick past an end stays at that end`; `tap cycles low → mid → high → low`.
- [ ] **Step 2: Test đỏ** (`venue-sheet.test.tsx`): `release at the same snap still animates back to that snap's offset`; `release elsewhere animates to the settled snap then calls onSnapChange`; `onDragClose replaces onSnapChange when released at low`; `outer layer is pointer-events-none, only the panel takes pointer events, and it has md:hidden`; `at low the list is inert and aria-hidden; at mid it is interactive`; `panel height is the same at every snap`; `title tap calls onSnapChange with the next snap and sets aria-expanded`; `pointerdown on the handle starts a drag`; `at mid a pointerdown on the list starts a drag`; `at high the list starts a drag only when scrolled to top and moving down`; `frozen ignores a container resize`; `onVisibleHeight reports once per settled snap`.
- [ ] **Step 3:** `pnpm test src/lib/venues/sheet-snap src/components/venues/venue-sheet`: FAIL.
- [ ] **Step 4:** Viết.
- [ ] **Step 5:** Chạy lại Step 3 + `pnpm test src/i18n`: PASS.
- [ ] **Step 6: Commit** `feat(venues): add a three-snap bottom sheet`

### Task 6: Ô tìm nổi, gợi ý tên sân, chip lọc

**Files:**
- Create: `src/components/venues/venue-search-bar.tsx`, `src/components/venues/venue-filter-chips.tsx`
- Modify: `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/components/venues/venue-search-bar.test.tsx`, `src/components/venues/venue-filter-chips.test.tsx`

**Interfaces:**
- Consumes: `matchVenuesByName`, `exactVenueMatch`, `normalizeName`, `VenueRadius`, `VENUE_RADII`, `islandLabelAt` (Task 1); `geocodeAddress` (`@/actions/venues`); `ResponsiveSheet`.
- Produces:
  - `VenueSearchBar({ venues, locale, onPickVenue, onPlace, onLocate, locating, onFocusChange }: { venues: (PublicVenue & { distanceM?: number })[]; locale: "vi" | "en" | "zh"; onPickVenue: (id: number) => void; onPlace: (p: LatLng, label: string) => void; onLocate: () => void; locating: boolean; onFocusChange?: (focused: boolean) => void })`.
    - `<form role="search">`, input `type="search"`, `enterKeyHint="search"`, `text-base`, `min-h-11`, `maxLength={200}`, `role="combobox"`, `aria-expanded`, `aria-activedescendant`, `aria-label` = `searchPlaceholder`. Bên phải nút 44px `aria-label = useMyLocation` (`LocateFixed`, quay khi `locating`).
    - Gõ: listbox tối đa 5 gợi ý `matchVenuesByName` (dòng ≥ 44px), dòng cuối luôn `searchPlace` khi `q.trim()` khác rỗng. Mũi tên lên/xuống đổi dòng được chọn.
    - Chọn sân CHỈ khi: bấm một gợi ý, Enter trên dòng đang được chọn bằng phím mũi tên, hoặc Enter mà `exactVenueMatch(venues, q)` có kết quả. Mọi Enter khác (kể cả khi có gợi ý chứa `q`) và bấm dòng `searchPlace` → tìm địa điểm. Enter với `q.trim()` rỗng không làm gì.
    - Tìm địa điểm: `useMutation(geocodeAddress)`; đang chờ thì khoá Enter và nút. Kết quả thành công nhớ trong `useRef<Map<string, { lat: number; lng: number; label: string }>>` theo `normalizeName(q)`; gặp lại thì dùng luôn, không gọi server. Thành công → `onPlace(p, islandLabelAt(p, locale) ?? r.label)`, đóng listbox, `blur()`. `{ error }` → `<p role="alert">` dưới ô đúng chuỗi server (không cache lỗi). Ném lỗi mạng → `searchFailed`. Gõ tiếp xoá lỗi. Không gọi `geocodeAddress` theo từng phím.
    - `onFocusChange(true/false)` khi input focus/blur (Task 8 ép ngăn về `low`).
  - `VenueFilterChips({ radius, onRadius, amenities, onAmenities, exchange, onExchange, showExchange, openNow, onOpenNow })` (kiểu như tên). Một hàng `overflow-x-auto` không thanh cuộn, chip `min-h-11 rounded-full`, thứ tự: `chipExchange` (khi `showExchange`), `chipRadius` + `ChevronDown`, `chipAmenities`/`chipAmenitiesCount`, `chipOpenNow`. Chip bật `bg-primary text-primary-foreground`, `aria-pressed`. Bán kính: `ResponsiveSheet` tiêu đề `radius`, 4 radio 44px, chọn là đóng. Tiện ích: `ResponsiveSheet` tiêu đề `filterAmenities`, 6 nút bật/tắt có icon, áp ngay, `done` ở `footer`.
- Khoá mới (vi): `searchPlaceholder` "Tìm khu vực, địa chỉ, tên sân", `searchPlace` "Tìm địa điểm \"{q}\"", `searchFailed` "Không tìm được lúc này. Thử lại sau.", `chipExchange` "Có giao lưu", `chipRadius` "Bán kính {km} km", `chipAmenities` "Tiện ích", `chipAmenitiesCount` "Tiện ích ({count})", `chipOpenNow` "Đang mở cửa", `done` "Xong"; kèm en/zh.

- [ ] **Step 1: Test đỏ** (`venue-search-bar.test.tsx`, mock `@/actions/venues`): `typing "cau giay" lists "Sân cầu lông Cầu Giấy" without calling geocode`; `Enter "Cầu Giấy" with that venue loaded calls geocode, not the venue`; `Enter "Sân cầu lông Cầu Giấy" selects the venue`; `arrow down then Enter picks the highlighted suggestion`; `tapping a suggestion picks it`; `the last option searches the typed place even when venues match`; `a geocode result inside Trường Sa is labelled with the Vietnamese name`; `searching the same text twice calls geocode once`; `server error text shows under the box with role alert and no toast, and is not cached`; `Enter while pending does not call geocode again`; `Enter on an empty box does nothing`; `typing clears the error`; `focus and blur call onFocusChange`; `locate button calls onLocate and has an accessible name`.
- [ ] **Step 2: Test đỏ** (`venue-filter-chips.test.tsx`): `hides the exchange chip when showExchange is false`; `radius chip shows "Bán kính 5 km"; picking 10 calls onRadius(10) and closes`; `amenities sheet toggles parking and the chip shows the count`; `open now chip toggles with aria-pressed`; `every chip has min-h-11`.
- [ ] **Step 3:** `pnpm test src/components/venues/venue-search-bar src/components/venues/venue-filter-chips`: FAIL.
- [ ] **Step 4:** Viết.
- [ ] **Step 5:** Chạy lại Step 3 + `pnpm test src/i18n`: PASS.
- [ ] **Step 6: Commit** `feat(venues): add the floating search box and filter chips`

### Task 7: Trạng thái và dữ liệu của màn sân (hook)

**Files:**
- Create: `src/app/(exchange)/venues/use-venue-directory-state.ts`
- Test: `src/app/(exchange)/venues/use-venue-directory-state.test.tsx` (`renderHook` trong `QueryClientProvider` + `NuqsTestingAdapter`; mock `listVenuesNear`, `useUserLocation`, `navigator.permissions.query`, `localStorage`)

**Interfaces:**
- Consumes: Task 1 (mọi helper), `venuesToPointsWithExchanges` (Task 2), `useUserLocation`, `listVenuesNear`.
- Produces: `type DirectoryVenue = PublicVenue & { distanceM: number }`; `useVenueDirectoryState({ exchangeEnabled, loadExchangeCounts }: { exchangeEnabled: boolean; loadExchangeCounts?: (ids: number[]) => Promise<[number, number][]> })` trả:
  - Tâm: `center: LatLng`, `source: CenterSource`, `areaLabel: string | null`, `ready: boolean`, `gpsWaiting: boolean` (quyền `granted` và `status === "asking"`: UI hiện viên `locating`).
  - Bộ lọc (đọc/ghi URL): `radius`, `setRadius`, `amenities`, `setAmenities`, `exchange`, `setExchange`, `openNow`, `setOpenNow`.
  - Dữ liệu: `query` (react-query của `listVenuesNear`), `venues: DirectoryVenue[]` (sau `filterVenues`), `points: MapPoint[]`, `counts: Map<number, number> | undefined`, `countsFailed: boolean`, `exchangeFilterPending: boolean` (chip bật, đếm đang chờ lần đầu: `venues` rỗng và UI hiện skeleton, tiêu đề không có số), `retryCounts(): void`.
  - Chọn sân: `selectedId: number | null`, `selectedVenue: DirectoryVenue | null`, `select(id: number): void` (ghi `venue` bằng `history: "push"`, tăng `focus.seq`), `clearSelection(): void`, `focus: { lat: number; lng: number; seq: number } | null`, `openedFromLink: boolean` (true một lần khi dữ liệu đầu tiên có sân của `?venue=` hợp lệ; lúc đó cũng đặt `focus`).
  - Bản đồ: `onMoveEnd(c: LatLng): void`, `showSearchHere: boolean`, `searchHere(): void`, `placeSearched(p: LatLng, label: string): void`, `locate(): void`, `locating: boolean`, `locateFailed: boolean`, `gps: LatLng | null`.
- Quy tắc:
  - Mount: `request()` GPS một lần; đọc `readStoredArea()` trong effect rồi đặt `initReady`; `navigator.permissions?.query({ name: "geolocation" })` chạy đua với hạn 500ms → `gpsPermission: "unknown" | "granted" | "other"` (không có API, lỗi, hay quá hạn → `"other"`). `ready = initReady && gpsPermission !== "unknown"`.
  - `listVenuesNear` `enabled` khi `ready` và: nguồn `url` hoặc `gps`, hoặc nguồn `stored`/`default` mà không phải `gpsPermission === "granted" && status === "asking"`. queryKey `["venues-near", lat.toFixed(3), lng.toFixed(3), r, amenitiesSorted]`, `keepPreviousData`, `staleTime: 60_000`. Số buổi y như G3 (`["venue-exchange-counts", ids]`).
  - `searchHere`: ghi `lat`/`lng` (`roundCoord`), `venue: null`, `writeStoredArea({ ..., label: t("selectedArea") })`. `placeSearched`: ghi `lat`/`lng`, `venue: null`, `writeStoredArea({ lat, lng, label })`; `areaLabel` khi nguồn `url` là nhãn vừa tìm (giữ trong state phiên, để nhãn tiếng Việt của quần đảo hiện thấy). `locate`: `request()`, khi `ok` thì xoá `lat`/`lng`; `denied`/`unsupported` → `locateFailed`. GPS đến sau không ghi đè khi URL có `lat`/`lng`. `setRadius` xoá `mapCenter` như G3.
  - `venue` ≤ 0, hay dữ liệu đã tải xong (không phải placeholder) mà không có sân đó sau lọc → `venue: null` (replace), không đọc thêm DB.
  - Không `setInterval`, không gọi server trong `onMoveEnd`.

- [ ] **Step 1: Test đỏ** (bảng thay test ở Task 8 ghi nguồn gốc): `waits for the saved area and the permission answer before the first fetch`; `with geolocation granted (answered after the first render), only the GPS area is fetched and gpsWaiting is true meanwhile`; `permission API missing or slower than 500ms counts as not granted and fetches the fallback`; `a stored area is used while GPS is denied`; `garbage params (lat=abc, lng=999, r=7, venue=-1, amenities=foo, view=list) fetch Hà Nội at 5 km`; `?lat=10.77&lng=106.70 fetches that area and GPS arriving later does not move it`; `?lat=10&lng=114 (Trường Sa) is accepted`; `search this area writes lat/lng, queries the map center, and a radius change keeps that center`; `changing the radius hides a stale search-this-area`; `placeSearched writes lat/lng, stores the area and exposes its label`; `locate clears lat/lng once GPS answers; denied sets locateFailed`; `exchange filter narrows venues and points; while counts are pending the list is empty with exchangeFilterPending`; `counts error turns the filter off and sets countsFailed`; `open-now drops closed and unknown-hours venues`; `select pushes ?venue= and bumps focus.seq`; `a selected venue filtered out clears ?venue=`; `?venue= not in the result is cleared without another server call`; `a valid ?venue= in the first result sets focus and openedFromLink once`; `onMoveEnd never calls listVenuesNear`; `no interval is scheduled` (fake timers, tiến 5 phút, không gọi thêm).
- [ ] **Step 2:** `pnpm test "src/app/(exchange)/venues/use-venue-directory-state"`: FAIL.
- [ ] **Step 3:** Viết.
- [ ] **Step 4:** Chạy lại Step 2: PASS. `pnpm exec tsc --noEmit` exit 0.
- [ ] **Step 5: Commit** `feat(venues): venue directory state with gps, url and filters`

### Task 8: Màn `/venues` trên điện thoại (bản đồ trước)

**Files:**
- Create: `src/lib/use-media-query.ts`
- Modify: `src/app/(exchange)/venues/venue-directory.tsx` (viết lại thành màn ghép), `src/app/(exchange)/venues/page.tsx`, `src/i18n/messages/{vi,en,zh}.json`
- Delete: `src/app/(exchange)/venues/venue-map-panel.tsx`, `src/app/(exchange)/venues/venue-map-panel.test.tsx`
- Test: `src/app/(exchange)/venues/venue-directory-map.test.tsx` (viết lại), `src/app/(exchange)/venues/venue-exchange-count.test.tsx` (sửa thao tác, xem bảng)

**Interfaces:**
- Consumes: `useVenueDirectoryState` (Task 7), `VenueSheet` (Task 5), `VenueSearchBar`, `VenueFilterChips` (Task 6), `VenueQuickView` (Task 4), `VenueCard` (Task 3), `LazyMapView` với `focus`, `bottomInset`, `noticeClassName` (Task 2).
- Produces:
  - `useMediaQuery(query: string): boolean | null` bằng `useSyncExternalStore` (server snapshot `null`).
  - `page.tsx` truyền thêm `loadUpcoming={exchangeEnabled ? listUpcomingAtVenue : undefined}`.
  - `VenueDirectory({ canSuggest, exchangeEnabled = false, loadExchangeCounts, loadUpcoming })`.
- Hành vi:
  - Khung `fixed inset-x-0 top-14 bottom-0` (dưới header 56px; app không còn bottom nav), lớp `md:grid md:grid-cols-[400px_minmax(0,1fr)]` có sẵn từ task này (cột trái để trống đến Task 9). `LazyMapView` luôn ở một chỗ trong cây, bọc `div.isolate` (`md:col-start-2`), `className="h-full rounded-none border-0"`, `cooperativeGestures={false}`, `noticeClassName` đặt khối lỗi nền bản đồ dưới lớp nổi. `useMediaQuery("(min-width: 768px)")` chỉ quyết panel: `null` → skeleton panel (thanh tìm, chip, ngăn thấp), `false` → `VenueSheet`.
  - Lớp nổi `z-20`, hàng ngoài `pointer-events-none`, control `pointer-events-auto`: `VenueSearchBar`, `VenueFilterChips`, hàng trạng thái (viên "Tìm ở khu vực này" hoặc viên `loadingVenues` khi `isFetching`; viên `locating` khi `gpsWaiting`; dòng `viewingAround` khi nguồn `stored`/`default`; dòng `viewingPlace` ("Đang xem quanh {label}") khi nguồn `url` có `areaLabel`; `locationUnavailable` khi `locateFailed`; `exchangeFilterUnavailable` + `retry` khi `countsFailed && exchange`). Chiều cao lớp nổi đo bằng `ResizeObserver` → `topReserve = đáy + 8`.
  - Ngăn: tiêu đề `sheetCount` (en plural) đếm sau lọc, không số khi `exchangeFilterPending`; danh sách `VenueCard` có `onSelect={() => select(id)}`, `selected`; `exchangeFilterPending` hoặc lần tải đầu → 3 thẻ skeleton. Lỗi tải (`loadError` + `retry`), rỗng hay lọc ra rỗng (`emptyTitle`, `emptyDescription`, `expandRadius`, `suggestVenue` khi `canSuggest`): ngăn tự lên `mid` một lần cho mỗi lần tải. Cuối danh sách link `suggestVenue` khi `canSuggest` (bỏ thanh dính đáy cũ).
  - Chọn sân (ghim, thẻ, gợi ý) hoặc `openedFromLink`: ngăn `low`/`high` → `mid`; nội dung ngăn đổi sang `VenueQuickView` (`closeLabel="close"`, AnimatePresence). X → `clearSelection()` giữ nấc; `onDragClose` → `clearSelection()` + nấc `low`.
  - Ô tìm focus → nhớ nấc, ép `low`, `frozen`; blur → trả nấc cũ.
  - `bottomInset` của bản đồ = `onVisibleHeight` chặn tối đa ở nấc `mid`; ô attribution (`[&_.maplibregl-ctrl-bottom-right]`) đặt `bottom` theo cùng giá trị.
- Khoá mới: `sheetCount` ("{count} sân quanh đây", en plural), `viewingAround` ("Đang xem quanh {label}. Bật vị trí hoặc gõ khu vực để đổi."), `viewingPlace` ("Đang xem quanh {label}"), `defaultAreaLabel` ("Hà Nội"), `locationUnavailable` ("Không lấy được vị trí. Gõ khu vực để tìm sân."); kèm en/zh. Xoá khoá `venues.*` không còn file nào dùng (`viewSwitch`, `showList`, `showMap`, `pinHint`, `searchingNear`, `changeLocation`; grep từng khoá trước khi xoá). Giữ `locationDenied`, `addressPlaceholder`, `search`, `attribution` (`LocationFallback` ở trang giao lưu và Task 9 còn dùng).
- Bảng thay test (spec quyết định 7):

| Test cũ | Xử lý | Lý do |
|---|---|---|
| `list view does not render the map` | thay: `renders the map on first client paint at Hà Nội while GPS is asking, with the viewing-around line` | không còn chế độ danh sách trên điện thoại |
| `switching to map and back calls listVenuesNear once` | chuyển ý sang Task 7 `with geolocation granted... only the GPS area is fetched` | không còn nút chuyển; giữ ý "không gọi thừa" |
| `moving the map past 30%...` | chuyển sang Task 7 (logic), thêm ở đây `the search-here pill calls searchHere` | logic nằm ở hook |
| `changing the radius clears a stale search-this-area button` | chuyển sang Task 7 | như trên |
| `mobile map uses cooperative gestures, desktop map does not` | thay: `the venues map never uses cooperative gestures` | spec bỏ cooperative gestures ở trang này |
| `tapping a pin on mobile opens a bottom sheet with that venue card` | thay: `tapping a pin shows the quick view in the sheet at mid and passes focus to the map` | thẻ xem nhanh thay Sheet cũ |
| `tapping a pin on desktop shows a side panel without a dialog` | chuyển sang Task 9 | |
| `map reports unsupported → view returns to list` | chuyển sang Task 9 | |
| `keeps the pins and shows a loading pill while a new area loads` | giữ | |
| `while locating in map mode shows a map-sized skeleton...` | gộp vào dòng đầu bảng | bản đồ hiện ngay, không chờ GPS |
| `map mode shows the load error...` | thay: `load error shows in the sheet at mid with retry` | lời nhắn nằm trong ngăn |
| `map mode shows the empty state...` | thay: `empty result opens the sheet at mid with expand radius` | như trên |
| `desktop aside shows a hint until a pin is selected` | bỏ | desktop hiện danh sách (Task 9) |
| `venue-map-panel.test.tsx` (2 test) | xoá file; ý chuyển vào `the loading pill replaces the search-here pill while fetching` | component bị xoá |
| `venue-exchange-count.test.tsx`: 4 test của danh bạ (test trang chi tiết thuộc Task 10) | giữ tên và ý. `renderDir` thành async, chờ dữ liệu rồi bấm tiêu đề ngăn lên `mid`; bấm chip "Có giao lưu" thay nút "Đang có giao lưu"; mở chip bán kính rồi chọn "10 km"; test "flag off" khẳng định không có chip "Có giao lưu"; "Thử lại" của đếm lỗi tìm ở hàng trạng thái lớp nổi | nhãn và vị trí control đổi theo bố cục mới |

- [ ] **Step 1: Test đỏ:** các dòng "thay"/"giữ"/"thêm" của bảng, cộng: `server render (renderToString) shows the panel skeleton, no map and no grid-cols-[400px without the md: prefix`; `the map wrapper has class isolate, the overlay z-20 and the sheet z-10`; `overlay row is pointer-events-none and its controls pointer-events-auto`; `picking a name suggestion selects that venue and moves the sheet to mid`; `opening with a valid ?venue= shows the quick view at mid`; `focusing the search box moves the sheet to low and blur restores it`; `X returns to the list at the same snap; drag close returns to low`; `counts error shows the notice with retry above the map`; `exchange filter pending shows skeleton cards and a title without a number`; `place search shows the viewing-place line with the island label`.
- [ ] **Step 2:** `pnpm test "src/app/(exchange)/venues"`: FAIL.
- [ ] **Step 3:** Viết; xoá `venue-map-panel.*`; i18n.
- [ ] **Step 4:** `pnpm test "src/app/(exchange)/venues" src/components/venues src/components/map src/lib src/i18n`: PASS. `pnpm exec tsc --noEmit` exit 0.
- [ ] **Step 5: Commit** `feat(venues): map-first venues page on mobile`

### Task 9: Desktop 2 cột, máy không có WebGL, skeleton trang

**Files:**
- Modify: `src/app/(exchange)/venues/venue-directory.tsx`, `src/app/(exchange)/venues/loading.tsx`, `src/lib/map/webgl.ts` (thêm hook)
- Test: `src/app/(exchange)/venues/venue-directory-desktop.test.tsx` (cùng bộ mock với Task 8)

**Interfaces:**
- Consumes: Task 7, Task 8.
- Produces: `useWebGL2Support(): boolean` trong `webgl.ts` = `useSyncExternalStore(noopSubscribe, hasWebGL2, () => true)`.
- Hành vi:
  - `useMediaQuery` = `true`: cột trái (`hidden md:flex`, cuộn được) chứa ô tìm, chip, hàng trạng thái, rồi danh sách `VenueCard` hoặc `VenueQuickView` (`closeLabel="back"`). Không render `VenueSheet`; `bottomInset = 0`. Viên "Tìm ở khu vực này"/"Đang tải" nổi trên bản đồ (cột phải). Bản đồ không bị huỷ/tạo lại khi đổi giữa hai bố cục (cùng vị trí trong cây).
  - Không WebGL (`useWebGL2Support()` false, hoặc `onUnsupported`): bỏ khung fixed; trang cuộn thường: `pageTitle`, ô tìm, chip, dòng `mapUnsupported`, danh sách `VenueCard` KHÔNG có `onSelect` (tên mở trang chi tiết), link `suggestVenue`, dòng `attribution` (nguồn OSM cho geocode). Không bao giờ có khung bản đồ trống.
  - `loading.tsx`: skeleton phủ khung dưới header, thanh tìm `h-11 rounded-full`, hàng 4 chip `h-11`, ngăn thấp 72px (`md:hidden`); từ `md:` cột trái 400px (thanh tìm, chip, 3 thẻ gọn) + khối bản đồ. Dùng lại cho skeleton panel lúc `useMediaQuery` còn `null`.
- [ ] **Step 1: Test đỏ:** `desktop shows the list in the left column and no bottom sheet`; `tapping a pin on desktop swaps the column to the quick view without a dialog; back returns to the list and clears ?venue=`; `switching between mobile and desktop widths keeps the same map instance` (đếm lần mount stub `LazyMapView`); `map reports unsupported → full list page with the explanation line, the OSM attribution and no map`; `without WebGL2 the map never mounts and the server snapshot assumes support`; `without WebGL the card name links to the detail page`.
- [ ] **Step 2:** `pnpm test "src/app/(exchange)/venues/venue-directory-desktop"`: FAIL.
- [ ] **Step 3:** Viết.
- [ ] **Step 4:** `pnpm test "src/app/(exchange)/venues" src/components/venues src/lib/map`: PASS.
- [ ] **Step 5: Commit** `feat(venues): two-column desktop layout and list fallback without webgl`

### Task 10: Trang chi tiết `/venues/[id]`

**Files:**
- Modify: `src/app/(exchange)/venues/[id]/page.tsx`, `src/i18n/messages/{vi,en,zh}.json`
- Create: `src/components/venues/venue-share-button.tsx`
- Test: `src/app/(exchange)/venues/[id]/venue-detail.test.tsx`; `venue-exchange-count.test.tsx` test `venue page lists upcoming exchanges only when the flag is on` giữ nguyên tên và khẳng định

**Interfaces:**
- Consumes: `getPublicVenue`, `listUpcomingAtVenue`, `isExchangeEnabled` (không thêm truy vấn); `openStatus` (lúc server render); `AMENITY_ICONS`; `VenueMiniMap`; `ExchangeCard`; `InfoRow` (`valueClassName="text-base"`); `shareOrCopy` (Task 4).
- Produces: `VenueShareButton({ venueId, name }: { venueId: number; name: string })`, nút 44px, toast như Task 4.
- Bố cục: link `backToList`; `VenueMiniMap` ở đầu; `h1` tên + `areaLabel`; `InfoRow` địa chỉ, giờ mở cửa + trạng thái, số sân, giá tham khảo, SĐT link `tel:`; tiện ích icon + nhãn; hàng nút ở `md:` (Chỉ đường, Gọi nếu có số, Chia sẻ); điện thoại: thanh dính đáy Chỉ đường (to) + Gọi + Chia sẻ (icon 44px), chừa `env(safe-area-inset-bottom)`; mục `upcomingExchangesTitle` với `ExchangeCard` hoặc `upcomingExchangesEmpty` khi cờ bật; mục `reviewsTitle` + `reviewsSoon`; `photoLink` giữ. Không có nút "Đề xuất sửa".
- Khoá mới: `reviewsTitle` ("Đánh giá sân"), `reviewsSoon` ("Đánh giá sân: sắp có"); kèm en/zh.
- [ ] **Step 1: Test đỏ:** `shows address, hours with Đang mở at 10:00 VN, court count, price, a tel link and labelled amenities, all values text-base` (`vi.setSystemTime`); `unparseable hours show Chưa rõ giờ`; `no phone hides both call buttons`; `shows the reviews coming soon block`; `exchange cards link to /exchanges/{code}`; `share button copies the /venues/{id} link when navigator.share is missing`.
- [ ] **Step 2:** `pnpm test "src/app/(exchange)/venues/[id]" "src/app/(exchange)/venues/venue-exchange-count"`: FAIL ở test mới.
- [ ] **Step 3:** Viết.
- [ ] **Step 4:** Chạy lại Step 2 + `pnpm test src/i18n`: PASS.
- [ ] **Step 5: Commit** `feat(venues): richer venue detail page`

### Task 11: Rà toàn nhánh (mobile UI, máy thật)

**Files:** chỉ sửa lỗi review tìm ra, mỗi lỗi kèm test hồi quy trong file test của component đó.

- [ ] **Step 1:** `mobile-ui-reviewer` trên mọi `.tsx` mới/sửa (`git -C D:/Lwcifer/LW/FWBB-venuesux diff --name-only 45a2b5a..HEAD -- "*.tsx"`), đọc file dưới `D:/Lwcifer/LW/FWBB-venuesux`, soát thêm: vùng chạm 44px, chữ ≥ 16px, không cuộn ngang ở 390px, safe-area, token màu, tầng z, framer-motion cho ngăn. Sửa vi phạm.
- [ ] **Step 2:** Mỗi lệnh phải rỗng: `grep -rnE "refetchInterval|usePolling|setInterval|console\.log" "src/app/(exchange)/venues" src/components/venues src/lib/venues src/lib/map/island-label.ts`; `grep -rnE "#[0-9a-fA-F]{3,8}\b" "src/app/(exchange)/venues" src/components/venues`; `grep -rn "parseFloat" src/components/venues src/lib/venues`; `git diff 45a2b5a -- src/i18n/messages | grep "^+" | grep -c "—\|–"` = 0; `git diff --stat 45a2b5a -- src/lib/map/sovereignty.test.ts src/lib/map/map-points.test.ts src/components/map/map-view.test.tsx`. `grep -rn "cooperativeGestures" "src/app/(exchange)/venues"` chỉ có `false`.
- [ ] **Step 3:** Playwright chromium 390×844 `hasTouch`, theme sáng/tối/hồng, chụp vào `.superpowers/venues/shots/`: `/venues` ở 3 nấc; ngăn ở `high` với một ghim giao lưu và ghim đang chọn nằm dưới ngăn (không lòi lên); thẻ xem nhanh; `/venues/[id]`. Soát bằng mắt: bản đồ thấy ngay, ghim giao lưu khác màu, chữ không bị cắt mà không có cách xem đủ. Chạy WebKit 390×844 kiểm `document.scrollingElement.scrollTop` không đổi khi vuốt (`min-h-screen` của shell); nếu body cuộn được thì khoá `overflow: hidden` trên `html` khi trang mount, gỡ khi unmount, kèm test.
- [ ] **Step 4 (thủ công, user làm, subagent chuẩn bị):** `source .superpowers/venues/test-env.sh && pnpm build && pnpm start -H 0.0.0.0 -p 3200`, gửi link LAN cho user mở trong Zalo và Messenger trên điện thoại thật: kéo ngăn 3 nấc, kéo bản đồ khi ngăn thấp, bấm ghim, ô tìm với bàn phím, Back đóng thẻ xem nhanh (GPS không chạy qua http LAN, ghi rõ). Ghi kết quả vào ledger; lỗi thì sửa kèm test.
- [ ] **Step 5: Commit** (nếu có sửa) `fix(venues): address mobile ui review findings`

### Task 12: e2e và 4 cổng

**Files:** Modify `e2e/venue-directory.spec.ts`, `e2e/venue-map.spec.ts`

**Interfaces:**
- Mọi test mới của 2 file dùng context chromium `viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true` và `page.route("**/tiles.openfreemap.org/**")` trả style rỗng (cách của `venue-map.spec.ts`). Kéo bằng CDP `Input.dispatchTouchEvent` (touchStart/Move/End). Khẳng định danh sách luôn lọc theo tiền tố `E2E Venue ` (DB e2e có thể có sân khác). Seed giữ mẫu hiện có (`PRAGMA busy_timeout = 5000`, dọn ở `afterAll`, cách lệch ô lưới của `venue-map.spec.ts`); thêm `open_hours = '00:00-24:00'` cho sân `E2E Venue Gần`, `'abc'` cho `E2E Venue Xa`. Không bật cờ giao lưu.
- Bảng thay e2e:

| File, test cũ | Xử lý | Lý do |
|---|---|---|
| `venue-directory`: `có GPS: thấy sân đã duyệt theo thứ tự khoảng cách...` | viết lại: đọc tên trong ngăn sau khi bấm tiêu đề lên `mid`; giữ khẳng định thứ tự Gần trước Xa, không có sân chờ duyệt, link chỉ đường có `destination=` | danh sách nằm trong ngăn |
| `venue-directory`: `từ chối GPS: hiện ô nhập địa chỉ, không quay mãi` | thay: `từ chối GPS: bản đồ hiện ngay quanh Hà Nội và ô tìm luôn có` | `LocationFallback` không còn ở trang này |
| `venue-directory`: redirect `/san` | giữ nguyên văn | |
| `venue-map`: `switching to map shows a marker per seeded venue at 390px` | thay: `opening /venues at 390px shows the seeded pins at once, the map frame is at least 200px tall, no horizontal overflow` | không còn nút "Bản đồ" |
| `venue-map`: `tapping a marker opens the venue card sheet with a details link` | thay: `tapping a pin opens the quick view; Xem chi tiết links to /venues/{id}` | thẻ xem nhanh thay Sheet cũ |
| `venue-map`: `the map worker loads from the same origin without map errors` | giữ, URL đổi sang `/venues` | |
| `venue-map`: `list view still works and does not request the map style` | thay: `a device without WebGL shows the list and never requests openfreemap` (`addInitScript` cho `getContext("webgl2")` trả `null`) | tiền đề "chế độ danh sách" không còn; giữ ý "không tải bản đồ khi không cần" |

- [ ] **Step 1: e2e mới:** `bản đồ hiện trong màn hình đầu tiên, không phải cuộn` (khung bản đồ trong viewport, `scrollHeight <= innerHeight + 1`); `bấm thẻ sân mở thẻ xem nhanh, URL có ?venue=, nút Back đóng nó`; `chip Đang mở cửa chỉ còn sân mở 24 giờ`; `kéo tay cầm từ thấp lên giữa bằng chạm`; `kéo tay cầm 30px rồi thả thì ngăn về đúng nấc cũ` (`boundingBox().y` lệch ≤ 2px); `một ngón kéo trên bản đồ khi ngăn ở thấp làm hiện "Tìm ở khu vực này"`; `link /venues?view=list cũ vẫn mở được`; cộng các dòng "thay" ở bảng.
- [ ] **Step 2:** 4 cổng + full e2e, log `.superpowers/venues/final-<x>.log`, exit từng lệnh: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `source .superpowers/venues/test-env.sh && pnpm build` (đọc cuối log tìm "Failed to compile"/"Type error"), `source .superpowers/venues/test-env.sh && pnpm test:e2e` (cổng 3101 bận thì `--config .superpowers/venues/playwright.3111.config.ts`). Expected: exit 0 hết; số test ở ledger Task 0 vẫn xanh đủ.
- [ ] **Step 3: Commit** `test(e2e): cover the map-first venues page`
- [ ] **Step 4:** Cập nhật memory `project_exchange_events_nearby.md` (trang sân bản đồ trước xong ở `feat/venues-map-first`, commit cuối, ngày tuyệt đối, chưa deploy, đi cùng đợt G2) và dòng trỏ trong `MEMORY.md`.

---

## Quyết định của người viết plan (cần user soát)

1. App đã bỏ thanh điều hướng dưới (giờ dùng menu bên trái), nên spec quyết định 6 ("member có bottom nav") không còn đúng với code. Khung bản đồ chiếm toàn màn hình dưới header 56px cho mọi người xem, ngăn ở nấc thấp nằm sát đáy và chừa vùng an toàn của iPhone.
2. Dải giao lưu trên thẻ sân chỉ hiện số buổi ("2 giao lưu sắp tới"), không hiện giờ như ví dụ "T3 19:30, CN 8:00" của spec mục 3. `countUpcomingByVenue` chỉ trả số buổi, còn spec cấm thêm truy vấn. Giờ, phí và chỗ trống hiện ở thẻ xem nhanh.
3. Tham số tiện ích trên URL là `amenities` như spec ghi (code đang dùng `a`). Link cũ có `a=...` vẫn mở được, chỉ không lọc tiện ích.
4. Ghim sân có giao lưu dùng màu token `--warning` (vàng cam), khác màu chính ở cả 3 theme. `--accent` của theme hồng gần trùng màu chính nên không dùng.
5. Giờ mở cửa chỉ được hiểu khi cả chuỗi là các khoảng giờ ("5:00 - 23:00", "5h-22h", "05:00-11:00, 14:00-22:00", "22:00-02:00", "24/7"). Chuỗi có chữ khác ("T2-T6 5:00-22:00", "Sáng 5-9") là "Chưa rõ giờ", để chip "Đang mở cửa" không bao giờ báo sai.
6. Giờ đóng cửa không tính là còn mở: "5:00-23:00" lúc 23:00 là "Đã đóng". "24/7", "24h", "0:00-24:00" là mở cả ngày. Giờ mở bằng giờ đóng (vd "6:00-6:00") nhiều khả năng là gõ nhầm, nên là "Chưa rõ giờ" (đổi theo bản rà).
7. Trạng thái mở cửa tính lại mỗi khi trang vẽ lại, không có đồng hồ chạy ngầm. Trang chi tiết tính lúc server tạo trang.
8. Ô tìm gợi ý tên sân (chứa chữ gõ, không phân biệt dấu, tối đa 5). Enter chỉ chọn sân khi tên sân trùng khớp hoàn toàn với chữ gõ (bỏ dấu, không phân biệt hoa thường), hoặc khi người dùng đã chọn một dòng gợi ý (chạm, hay phím mũi tên rồi Enter). Mọi trường hợp khác là tìm địa điểm, nên gõ "Cầu Giấy" bay tới quận Cầu Giấy dù có "Sân cầu lông Cầu Giấy" (đổi theo bản rà).
9. Lỗi tìm địa điểm hiện đúng câu server trả về ngay dưới ô, không dùng toast. Kết quả tìm thành công được nhớ trong trang, tìm lại cùng chữ không tốn lượt gọi.
10. Lần tải đầu chỉ bắn truy vấn sau khi đã đọc vùng đã lưu và biết quyền vị trí (chờ tối đa 0,5 giây; Zalo không trả lời thì coi như chưa cho phép). Đã cho phép vị trí thì chờ GPS và hiện viên "Đang lấy vị trí của bạn...", không tải vùng tạm. Chưa cho phép hay bị từ chối thì tải vùng đã lưu hoặc Hà Nội ngay như spec. Vì vậy mỗi lần mở trang chỉ có một lần tải sân, bản đồ không nhảy hai lần (đổi theo bản rà).
11. Khi URL đã có `lat`/`lng`, vị trí GPS đến sau không kéo bản đồ đi. Bấm "Dùng vị trí của tôi" thì xoá `lat`/`lng` và quay về GPS.
12. Trình duyệt chỉ nhớ điểm tìm gần nhất, không bao giờ lưu vị trí GPS. "Tìm ở khu vực này" lưu kèm nhãn "Khu vực đã chọn". Điểm ở Hoàng Sa, Trường Sa được nhận như mọi điểm trong nước.
13. Ngăn kéo làm đúng spec "kéo bằng tay cầm hoặc vuốt": ở nấc thấp và giữa, vuốt ở đâu trên ngăn cũng kéo ngăn; ở nấc cao danh sách cuộn bình thường, cuộn tới đầu rồi vuốt xuống thì thu ngăn (kiểu Google Maps). Thả tay ở đâu ngăn cũng trôi về một nấc. Vuốt nhanh hơn 500px/giây thì nhảy một nấc theo hướng vuốt. Bấm tiêu đề: thấp, giữa, cao, rồi về thấp. Nấc cao dừng ngay dưới ô tìm và hàng chip (đổi theo bản rà; bản trước chỉ cho kéo bằng tay cầm, lệch spec).
14. Chọn một sân thì ngăn lên nấc giữa. Bấm X về danh sách giữ nấc giữa; vuốt thẻ xuống thì về danh sách ở nấc thấp. Nút Back của điện thoại đóng thẻ xem nhanh. Đang gõ ô tìm thì ngăn tạm hạ xuống thấp để không che gợi ý, rời ô thì trả lại.
15. "N sân quanh đây" đếm số sân sau khi áp các chip. Lúc đang đếm buổi giao lưu thì chưa hiện số.
16. Kết quả rỗng hoặc lỗi tải thì ngăn tự lên nấc giữa một lần. Lỗi đếm buổi giao lưu hiện ở hàng trạng thái dưới chip (luôn thấy), kèm nút thử lại.
17. Thẻ xem nhanh chỉ gọi danh sách buổi khi sân có số buổi lớn hơn 0, tối đa một lần mỗi sân trong 60 giây. "Còn N chỗ" theo đúng cách thẻ buổi giao lưu đang hiện, kèm ghi chú chỗ dành riêng cho nữ.
18. Nút "Chia sẻ" chia sẻ link trang chi tiết `/venues/{id}`. Máy có hộp chia sẻ thì mở hộp đó; không có (Zalo, Messenger trên Android) thì chép link, kể cả bằng cách cũ khi trình duyệt chặn cách mới, rồi báo "Đã chép link".
19. Tham số `venue` trỏ tới sân không có trong kết quả vùng đang xem thì bị bỏ, không đọc thêm DB. Mở link có `venue` hợp lệ thì thẻ xem nhanh mở sẵn ở nấc giữa.
20. Bố cục 2 cột bắt đầu từ 768px như spec. Khung trang dựng bằng CSS nên điện thoại không bao giờ nhận bố cục desktop trước khi trang chạy xong, và bản đồ không bị tạo lại khi xoay máy.
21. Ô ghi nguồn bản đồ luôn nằm ngay trên phần ngăn đang lộ (tối đa nấc giữa). Trang không có bản đồ (máy không WebGL) vẫn ghi nguồn OpenStreetMap cho phần tìm địa chỉ.
22. Không có nút "Đề xuất sửa" vì app chưa có tính năng này. Nút "Đề xuất sân" chuyển vào cuối danh sách và vào lời nhắn khi không có sân.
23. Icon tiện ích: gửi xe `SquareParking`, điều hoà `Snowflake`, bán cầu `ShoppingBag`, thuê vợt `HandCoins`, nước uống `CupSoda`, phòng tắm `ShowerHead`. Trên thẻ gọn chỉ có icon (trình đọc màn hình đọc được tên, rê chuột thấy tên); nhãn chữ đầy đủ hiện ở thẻ xem nhanh và trang chi tiết (đổi theo bản rà: chạm giữ không hiện `title` trên điện thoại).
24. Bay tới một ghim giữ mức zoom hiện tại nhưng không nhỏ hơn 14.
25. Máy không có WebGL thấy trang danh sách cuộn bình thường; bấm tên sân mở trang chi tiết.
26. Các chuỗi `venues.*` chỉ trang cũ dùng bị xoá; chuỗi ô nhập địa chỉ ở trang giao lưu còn dùng thì giữ.
27. e2e không seed buổi giao lưu và không bật cờ giao lưu (đã có unit test, bật cờ dễ làm bẩn spec khác). Kiểm trên Zalo và Messenger thật là bước thủ công của user ở Task 11.

## Plan review response

| Mục | Kết luận | Sửa ở đâu |
|---|---|---|
| C1 | Chấp nhận | Task 12: thêm `e2e/venue-map.spec.ts` + bảng thay e2e |
| C2 | Chấp nhận | Task 5: `useMotionValue` + `animate()` luôn chạy khi thả, `dragMomentum={false}`; Task 12 e2e kéo 30px rồi thả |
| C3 | Chấp nhận | Quy ước tầng z; Task 8 lớp `isolate` + test; Task 11 Step 3 ảnh chụp |
| I1 | Chấp nhận | Task 8 bảng thay test, dòng `venue-exchange-count` |
| I2 | Chấp nhận | Task 3 sr-only + `title`; quyết định 23 |
| I3 | Chấp nhận | Task 3 cấu trúc nút phủ + link anh em, test "no anchor inside a button" |
| I4 | Chấp nhận | Quy ước bố cục; Task 8 `useMediaQuery` (server `null`), khung CSS, test `renderToString`; Task 9 `useWebGL2Support`, test giữ một bản đồ |
| I5 | Chấp nhận | Task 7 `initReady`, `gpsPermission` có hạn 500ms, `gpsWaiting`; quyết định 10 |
| I6 | Chấp nhận | Task 1 `isInVietnamOrIslands` cho URL và vùng lưu; Task 7, 8 nhãn `viewingPlace` |
| I7 | Chấp nhận | Task 1 `exactVenueMatch`; Task 6 luật Enter; quyết định 8 |
| I8 | Chấp nhận | Quy ước tầng z và `pointer-events`; Task 5 `topReserve`, `frozen`; Task 8 focus ô tìm → `low` |
| I9 | Chấp nhận | Task 5 panel cao cố định, padding-bottom theo nấc, test cùng chiều cao |
| I10 | Chấp nhận | Task 7 `exchangeFilterPending`, `countsFailed`; Task 8 thông báo ở hàng trạng thái |
| I11 | Chấp nhận | Task 2 `setPadding` tức thì, hoãn khi đang bay; `focus` mang padding hiện tại |
| I12 | Chấp nhận | Task 2 lái bằng `data-exchange` ở nhánh cập nhật, bỏ ý xếp cuối mảng, test rerender |
| I13 | Chấp nhận | Task 2 chỉ gọi API mới khi có prop; test mới dùng mock riêng |
| I14 | Chấp nhận | Tách thành Task 7 (hook trạng thái) và Task 8 (màn ghép) |
| I15 | Chấp nhận | Task 12 context `hasTouch`/`isMobile` + CDP touch; Task 11 Step 4 kiểm Zalo/Messenger thật |
| M1 | Chấp nhận | Task 1; quyết định 6 |
| M2 | Chấp nhận | Task 2, 4, 8 chuỗi en dùng plural |
| M3 | Chấp nhận | Task 4 `src/lib/exchange/format.ts` |
| M4 | Chấp nhận | Task 4 lùi `execCommand("copy")` |
| M5 | Chấp nhận | Task 5 chữ ký có `onVisibleHeight`, gọi khi dừng nấc, stub `ResizeObserver` |
| M6 | Chấp nhận | Task 9 dòng `attribution` ở trang không WebGL |
| M7 | Chấp nhận | Task 10 `valueClassName="text-base"` |
| M8 | Chấp nhận | Task 2 `noticeClassName`; Task 8 dùng |
| M9 | Chấp nhận | Quy ước lịch sử URL; Task 7 `select` dùng `push` |
| M10 | Chấp nhận | Task 7 `openedFromLink`; Task 8 lên nấc giữa |
| M11 | Chấp nhận | Task 0 Step 3 "nếu có" |
| M12 | Chấp nhận | Global Constraints quota (thêm lần đọc settings); Task 6 nhớ kết quả geocode |
| M13 | Chấp nhận | Task 4 theo cách `ExchangeCard` (kèm chỗ dành cho nữ) |
| M14 | Chấp nhận | Task 11 Step 3 kiểm WebKit, khoá cuộn nếu cần |
| M15 | Chấp nhận | Task 12 chặn mạng tile, lọc theo tiền tố |
| Ý kiến QĐ 6 | Chấp nhận | start = end là "Chưa rõ giờ" |
| Ý kiến QĐ 8 | Chấp nhận, chặt hơn đề xuất | Chỉ khớp hoàn toàn hoặc chọn rõ từ danh sách (theo chỉ đạo điều phối), không dùng luật "một gợi ý bắt đầu bằng" |
| Ý kiến QĐ 10 | Chấp nhận | Như I5 |
| Ý kiến QĐ 13 | Chấp nhận, quay về spec | Vuốt trên ngăn kéo được ở nấc thấp/giữa và ở đầu danh sách khi nấc cao; không còn lệch spec |
| Ý kiến QĐ 23 | Chấp nhận | Như I2 |
