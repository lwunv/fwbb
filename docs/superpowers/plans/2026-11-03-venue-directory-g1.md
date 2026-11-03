# Danh bạ sân (G1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có danh bạ sân công khai: member đề xuất sân bằng link Google Maps, admin duyệt, mọi người xem danh sách sân theo khoảng cách và bấm "Chỉ đường".

**Architecture:** Bảng mới `venues` (không đụng nghĩa của `courts`, chỉ thêm `courts.venue_id`). Toán địa lý (haversine, khung toạ độ) và tách toạ độ từ link Google Maps là hàm thuần trong `src/lib/`. Server action đọc danh sách qua `unstable_cache` theo ô lưới để request dội không xuống DB. Trang `/san` là client component dùng react-query + nuqs. Chưa có bản đồ (G3).

**Tech Stack:** Next.js 16 App Router, Drizzle + Turso (SQLite), zod, react-query, nuqs, react-hook-form, next-intl, framer-motion, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-exchange-events-nearby-design.md` (mục 4.1, 4.2, 4.6, 4.7, 4.9 G1)

## Global Constraints

- Đọc `node_modules/next/dist/docs/` trước khi viết code Next (AGENTS.md).
- Migration chỉ DDL, chỉ thêm. KHÔNG seed dữ liệu trong migration. KHÔNG chạy `db:push`/`db:seed` (`.env.local` trỏ DB PROD).
- Tiền (`ref_price_per_hour`) là số nguyên VND, validate bằng `moneyVnd` trong `src/lib/validators.ts`. Toạ độ là `real` (không phải tiền).
- Không polling (`refetchInterval`) trên `/san`. react-query `staleTime: 60_000`.
- Payload công khai chỉ gồm cột trong whitelist; KHÔNG trả `submittedByMemberId`, `status`, hay bất kỳ cột nào của `courts` (nhất là `pricePerSession`).
- Vị trí người dùng chỉ đi theo request, không lưu DB, không ghi log.
- Link do người dùng nhập chỉ nhận `http(s)://` (cùng lý do XSS như `courtSchema.mapLink`).
- Server fetch link rút gọn chỉ tới host trong allowlist (chống SSRF).
- Nominatim: tối đa 1 request/giây toàn tiến trình, có header `User-Agent` riêng của app, `countrycodes=vn`, cache kết quả.
- Chuỗi giao diện đủ `vi`/`en`/`zh` (`src/i18n/locale-parity.test.ts` phải xanh).
- Mobile-first: vùng chạm ≥ 44px, chữ thân ≥ 16px, skeleton thay spinner, empty state có nút hành động, màu từ CSS variables trong `globals.css`.
- Ghi dữ liệu có optimistic UI qua `fireAction` khi kết quả không phụ thuộc phản hồi server (duyệt/ẩn sân). Form đề xuất sân thì chờ server vì cần cảnh báo trùng (ghi lý do trong comment).
- Mỗi member đề xuất tối đa 3 sân/ngày (`checkRateLimit`).
- Commit: Conventional Commits 1 dòng, không body, không trailer. Đề xuất message và chờ user xác nhận trước khi commit.

## Review Focus

1. Link Google Maps rút gọn (`maps.app.goo.gl/...`) trỏ tới trang chỉ có tên địa điểm, không có toạ độ: phải báo "không tách được toạ độ, hãy kéo ghim hoặc nhập tay", không lưu `0,0`. Test ở Task 2 (`resolveMapsLink` trả `null` → action trả `{ error }`) và Task 4.
2. Toạ độ ngoài Việt Nam hoặc bị đảo lat/lng (người dùng dán `106.7, 10.8`): phải từ chối. Test ở Task 2 (`parseLatLngFromMapsUrl` với lat ngoài [-90, 90]) và Task 4 (`venueSubmitSchema` giới hạn trong khung VN: lat 8..24, lng 102..110).
3. Người dùng từ chối GPS trong trình duyệt Zalo/Messenger: trang không được trắng hay quay mãi, phải hiện ô nhập địa chỉ. Test e2e ở Task 7 (geolocation bị từ chối → thấy ô nhập địa chỉ).
4. Sân ở rìa bán kính và ô lưới cache: người đứng sát ranh giới ô lưới vẫn phải thấy sân cách 4,9 km khi chọn 5 km. Test ở Task 5 (`listVenuesNear` với tâm lệch 0,004° khỏi tâm ô vẫn trả sân ở 4,9 km).
5. Hai member đề xuất cùng một sân: lần hai phải nhận cảnh báo trùng (< 100 m) và chỉ lưu khi xác nhận. Test ở Task 4.

---

### Task 1: Toán địa lý thuần

**Files:**
- Create: `src/lib/geo.ts`
- Test: `src/lib/geo.test.ts`

**Interfaces:**
- Produces:
  - `type LatLng = { lat: number; lng: number }`
  - `haversineMeters(a: LatLng, b: LatLng): number`
  - `boundingBox(center: LatLng, radiusMeters: number): { minLat: number; maxLat: number; minLng: number; maxLng: number }`
  - `formatDistance(meters: number, locale: "vi" | "en" | "zh"): string`: dưới 1000 m ra `"850 m"`; từ 1000 m ra 1 chữ số thập phân theo locale (`"2,3 km"` với vi, `"2.3 km"` với en/zh)
  - `snapToGrid(p: LatLng, step?: number): LatLng`: làm tròn về ô lưới, mặc định `step = 0.01`
  - `VN_BOUNDS = { minLat: 8, maxLat: 24, minLng: 102, maxLng: 110 }`, `isInVietnam(p: LatLng): boolean`

- [ ] **Step 1: Viết test thất bại**

```ts
describe("haversineMeters", () => {
  it("hai điểm cùng vĩ độ 21.0287 lệch 0,0034° kinh ~ 350 m", () => {
    const d = haversineMeters({ lat: 21.0287, lng: 105.8523 }, { lat: 21.0287, lng: 105.8489 });
    expect(d).toBeGreaterThan(300); expect(d).toBeLessThan(450);
  });
  it("cùng điểm = 0", () => expect(haversineMeters({ lat: 10, lng: 106 }, { lat: 10, lng: 106 })).toBe(0));
});
describe("boundingBox", () => {
  it("mọi điểm cách tâm ≤ r đều nằm trong khung", () => {
    const c = { lat: 21.03, lng: 105.85 }; const bb = boundingBox(c, 5000);
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const p = { lat: c.lat + (4999 / 111_320) * Math.cos((deg * Math.PI) / 180),
                  lng: c.lng + (4999 / (111_320 * Math.cos((c.lat * Math.PI) / 180))) * Math.sin((deg * Math.PI) / 180) };
      expect(p.lat).toBeGreaterThanOrEqual(bb.minLat); expect(p.lat).toBeLessThanOrEqual(bb.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(bb.minLng); expect(p.lng).toBeLessThanOrEqual(bb.maxLng);
    }
  });
});
describe("formatDistance", () => {
  it("850 → '850 m'", () => expect(formatDistance(850, "vi")).toBe("850 m"));
  it("2345 vi → '2,3 km'", () => expect(formatDistance(2345, "vi")).toBe("2,3 km"));
  it("2345 en → '2.3 km'", () => expect(formatDistance(2345, "en")).toBe("2.3 km"));
});
describe("isInVietnam", () => {
  it("Hà Nội: true", () => expect(isInVietnam({ lat: 21.03, lng: 105.85 })).toBe(true));
  it("đảo lat/lng: false", () => expect(isInVietnam({ lat: 105.85, lng: 21.03 })).toBe(false));
});
describe("snapToGrid", () => {
  it("21.0349, 105.8461 → 21.03, 105.85", () =>
    expect(snapToGrid({ lat: 21.0349, lng: 105.8461 })).toEqual({ lat: 21.03, lng: 105.85 }));
});
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `pnpm vitest run src/lib/geo.test.ts`
Expected: FAIL, "Cannot find module './geo'"

- [ ] **Step 3: Viết `src/lib/geo.ts`**

Bán kính Trái Đất 6_371_000 m. `boundingBox` dùng 111_320 m/độ vĩ, chia thêm `cos(lat)` cho kinh độ. `snapToGrid` trả số đã làm tròn bằng `Math.round(x / step) * step` rồi `Number(toFixed(6))` để tránh `21.030000000000001`.

- [ ] **Step 4: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/lib/geo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (đề xuất message, chờ user OK)

```bash
git add src/lib/geo.ts src/lib/geo.test.ts
git commit -m "feat(venues): add distance and bounding box helpers"
```

---

### Task 2: Tách toạ độ từ link Google Maps

**Files:**
- Create: `src/lib/maps-link.ts` (hàm thuần), `src/lib/maps-link-resolve.ts` (gọi mạng, chỉ dùng ở server)
- Test: `src/lib/maps-link.test.ts`, `src/lib/maps-link-resolve.test.ts`

**Interfaces:**
- Consumes: `LatLng`, `isInVietnam` (Task 1)
- Produces:
  - `parseLatLngFromMapsUrl(url: string): LatLng | null`
  - `directionsUrl(p: LatLng): string` → `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`
  - `SHORT_LINK_HOSTS = ["maps.app.goo.gl", "goo.gl"]`, `MAPS_HOSTS` gồm `google.com`, `www.google.com`, `maps.google.com`, `google.com.vn`, `www.google.com.vn`
  - `resolveMapsLink(url: string, fetchImpl?: typeof fetch): Promise<LatLng | null>`

- [ ] **Step 1: Viết test thất bại cho parser**

```ts
it("ưu tiên !3d!4d (toạ độ địa điểm) hơn @ (tâm khung nhìn)", () =>
  expect(parseLatLngFromMapsUrl(
    "https://www.google.com/maps/place/San+ABC/@21.0300,105.8400,17z/data=!3m1!4b1!4m6!3m5!8m2!3d21.0312!4d105.8423")
  ).toEqual({ lat: 21.0312, lng: 105.8423 }));
it("dạng @lat,lng,zoom", () =>
  expect(parseLatLngFromMapsUrl("https://www.google.com/maps/@10.7769,106.7009,15z")).toEqual({ lat: 10.7769, lng: 106.7009 }));
it("dạng ?q=lat,lng", () =>
  expect(parseLatLngFromMapsUrl("https://maps.google.com/?q=21.03,105.85")).toEqual({ lat: 21.03, lng: 105.85 }));
it("dạng ?query=lat%2Clng (api=1)", () =>
  expect(parseLatLngFromMapsUrl("https://www.google.com/maps/search/?api=1&query=21.03%2C105.85")).toEqual({ lat: 21.03, lng: 105.85 }));
it("lat ngoài [-90,90] → null", () =>
  expect(parseLatLngFromMapsUrl("https://maps.google.com/?q=105.85,21.03")).toBeNull());
it("host lạ → null", () =>
  expect(parseLatLngFromMapsUrl("https://evil.example/?q=21.03,105.85")).toBeNull());
it("chỉ có tên, không toạ độ → null", () =>
  expect(parseLatLngFromMapsUrl("https://www.google.com/maps/place/San+ABC")).toBeNull());
it("directionsUrl", () =>
  expect(directionsUrl({ lat: 21.03, lng: 105.85 })).toBe("https://www.google.com/maps/dir/?api=1&destination=21.03,105.85"));
```

- [ ] **Step 2: Viết test thất bại cho resolver (fetch giả)**

```ts
it("đi theo redirect của maps.app.goo.gl rồi tách toạ độ", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/place/X/data=!3d21.0312!4d105.8423" } }));
  expect(await resolveMapsLink("https://maps.app.goo.gl/abc", f)).toEqual({ lat: 21.0312, lng: 105.8423 });
  expect(f).toHaveBeenCalledWith("https://maps.app.goo.gl/abc", expect.objectContaining({ redirect: "manual" }));
});
it("redirect sang host ngoài allowlist → null, không fetch tiếp", async () => {
  const f = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
  expect(await resolveMapsLink("https://maps.app.goo.gl/abc", f)).toBeNull();
  expect(f).toHaveBeenCalledTimes(1);
});
it("quá 5 lần redirect → null", async () => {
  const f = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://maps.app.goo.gl/loop" } }));
  expect(await resolveMapsLink("https://maps.app.goo.gl/loop", f)).toBeNull();
  expect(f).toHaveBeenCalledTimes(5);
});
it("link đầy đủ có toạ độ → không gọi mạng", async () => {
  const f = vi.fn();
  expect(await resolveMapsLink("https://maps.google.com/?q=21.03,105.85", f)).toEqual({ lat: 21.03, lng: 105.85 });
  expect(f).not.toHaveBeenCalled();
});
it("fetch throw (timeout) → null", async () => {
  const f = vi.fn().mockRejectedValue(new Error("timeout"));
  expect(await resolveMapsLink("https://maps.app.goo.gl/abc", f)).toBeNull();
});
```

- [ ] **Step 3: Chạy cả hai file test, kỳ vọng FAIL**

Run: `pnpm vitest run src/lib/maps-link.test.ts src/lib/maps-link-resolve.test.ts`
Expected: FAIL, module không tồn tại

- [ ] **Step 4: Viết hai file**

`parseLatLngFromMapsUrl`: `new URL()` trong try/catch, kiểm host thuộc `MAPS_HOSTS`, thử lần lượt `!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)`, rồi `@(-?\d+\.\d+),(-?\d+\.\d+)`, rồi param `q`/`query`/`ll`/`destination` dạng `lat,lng`. Kiểm lat ∈ [-90,90], lng ∈ [-180,180]. Giới hạn VN không kiểm ở đây (để ở zod, Task 4).
`resolveMapsLink`: nếu parse được ngay thì trả. Nếu host không thuộc `SHORT_LINK_HOSTS` thì trả `null`. Lặp tối đa 5 lần: `fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(5000) })`, đọc `location`, host của `location` phải thuộc `SHORT_LINK_HOSTS ∪ MAPS_HOSTS` và scheme `https:`, không thì trả `null`. Không ghi log URL.

- [ ] **Step 5: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/lib/maps-link.test.ts src/lib/maps-link-resolve.test.ts`
Expected: PASS

- [ ] **Step 6: Commit** (chờ user OK)

```bash
git add src/lib/maps-link*.ts
git commit -m "feat(venues): parse coordinates from google maps links"
```

---

### Task 3: Schema `venues` + `courts.venue_id` + migration

**Files:**
- Modify: `src/db/schema.ts` (thêm `venues` gần `courts` dòng 185; thêm `venueId` vào `courts`; relations)
- Create: `src/lib/venue-amenities.ts`
- Create (generate): `src/db/migrations/0026_*.sql` + `meta/`
- Test: `src/db/venues-schema.integration.test.ts`

**Interfaces:**
- Produces:
  - `VENUE_AMENITIES = ["parking", "air_con", "shuttle_shop", "racket_rental", "drinks", "shower"] as const`, `type VenueAmenity`
  - `VENUE_STATUSES = ["pending", "approved", "hidden"] as const`, `type VenueStatus = (typeof VENUE_STATUSES)[number]`
  - Bảng `venues`: `id` (int PK autoincrement), `name` (text not null), `address` (text), `areaLabel` (`area_label`), `lat` (real not null), `lng` (real not null), `mapLink` (`map_link`), `courtCount` (`court_count` int), `openHours` (`open_hours` text), `amenities` (text, JSON mảng `VenueAmenity`, default `'[]'`), `phone` (text), `refPricePerHour` (`ref_price_per_hour` int), `photoLink` (`photo_link`), `status` (text enum `VENUE_STATUSES`, not null, default `'pending'`), `submittedByMemberId` (`submitted_by_member_id` int FK members, nullable), `approvedAt`, `createdAt`, `updatedAt` (text, theo cách các bảng khác lưu thời gian). Index `venues_status_lat_lng_idx` trên `(status, lat, lng)`. CHECK `ref_price_per_hour IS NULL OR ref_price_per_hour >= 0`, CHECK `court_count IS NULL OR court_count >= 1`.
  - `courts.venueId` (`venue_id` int, nullable, FK `venues.id`)

- [ ] **Step 1: Viết test thất bại**

```ts
const { db, client } = await createTestDb();
it("migration tạo bảng venues + index", async () => {
  const r = await client.execute("SELECT name FROM sqlite_master WHERE name IN ('venues','venues_status_lat_lng_idx')");
  expect(r.rows.map((x) => x.name).sort()).toEqual(["venues", "venues_status_lat_lng_idx"]);
});
it("courts có cột venue_id, dữ liệu court cũ giữ nguyên", async () => {
  const cols = await client.execute("PRAGMA table_info(courts)");
  expect(cols.rows.map((c) => c.name)).toContain("venue_id");
});
it("CHECK chặn giá âm", async () => {
  await expect(db.insert(venues).values({ name: "X", lat: 21, lng: 105, refPricePerHour: -1 })).rejects.toThrow();
});
it("status mặc định pending, amenities mặc định []", async () => {
  const [v] = await db.insert(venues).values({ name: "Y", lat: 21, lng: 105 }).returning();
  expect(v.status).toBe("pending"); expect(v.amenities).toBe("[]");
});
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `pnpm vitest run src/db/venues-schema.integration.test.ts`
Expected: FAIL, `venues` không được export

- [ ] **Step 3: Sửa schema, tạo `venue-amenities.ts`, generate migration**

Run: `pnpm db:generate` (chỉ diff snapshot, KHÔNG kết nối DB)
Mở file SQL mới: chỉ được có `CREATE TABLE venues`, `CREATE INDEX`, `ALTER TABLE courts ADD venue_id`. Nếu drizzle sinh `__new_courts` (dựng lại bảng) thì DỪNG: viết tay `ALTER TABLE ... ADD COLUMN` thay vào (bẫy Turso rụng index, xem memory `reference_turso_migration_gotcha`).

- [ ] **Step 4: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/db/venues-schema.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (chờ user OK)

```bash
git add src/db/schema.ts src/db/migrations src/lib/venue-amenities.ts src/db/venues-schema.integration.test.ts
git commit -m "feat(db): add venues table and link courts to venues"
```

---

### Task 4: Đề xuất sân (validator + action)

**Files:**
- Modify: `src/lib/validators.ts` (thêm `venueSubmitSchema`)
- Create: `src/actions/venues.ts`
- Test: `src/actions/venues-submit.integration.test.ts`

**Interfaces:**
- Consumes: `resolveMapsLink` (Task 2), `haversineMeters`, `boundingBox`, `VN_BOUNDS` (Task 1), `venues` (Task 3), `requireApprovedMember` (`src/lib/member-auth.ts`), `checkRateLimit` (`src/lib/rate-limit.ts`)
- Produces:
  - `venueSubmitSchema`: `name` 1..100, `address` ≤ 500 optional, `mapLink` http(s) ≤ 2000 optional, `lat`/`lng` optional số trong `VN_BOUNDS`, `courtCount` int 1..50 optional, `openHours` ≤ 100 optional, `amenities` mảng `VenueAmenity` không trùng, `phone` ≤ 20 optional (chỉ chữ số, dấu cách, `+`), `refPricePerHour` `moneyVnd` optional, `photoLink` http(s) optional, `confirmDuplicate` boolean default false. Bắt buộc có `mapLink` hoặc cặp `lat`+`lng`.
  - `submitVenue(input: z.input<typeof venueSubmitSchema>): Promise<{ success: true; id: number } | { error: string } | { duplicate: { id: number; name: string; distanceM: number } }>`

- [ ] **Step 1: Viết test thất bại** (mock `@/lib/member-auth`, `@/db`, `next/cache`, `@/lib/maps-link-resolve` theo pattern `members.integration.test.ts`)

```ts
it("member chưa duyệt → error, không ghi", async () => { /* requireApprovedMember trả {error} */
  expect(await submitVenue({ name: "A", lat: 21.03, lng: 105.85 })).toHaveProperty("error");
  expect(await db.select().from(venues)).toHaveLength(0);
});
it("link không tách được toạ độ, không có lat/lng → error rõ ràng", async () => {
  resolveMock.mockResolvedValueOnce(null);
  const r = await submitVenue({ name: "A", mapLink: "https://maps.app.goo.gl/x" });
  expect(r).toEqual({ error: expect.stringContaining("toạ độ") });
});
it("toạ độ ngoài VN → error", async () =>
  expect(await submitVenue({ name: "A", lat: 35, lng: 139 })).toHaveProperty("error"));
it("lưu pending, ghi submittedByMemberId", async () => {
  const r = await submitVenue({ name: "Sân A", lat: 21.03, lng: 105.85, amenities: ["parking"] });
  const [v] = await db.select().from(venues);
  expect(r).toEqual({ success: true, id: v.id }); expect(v.status).toBe("pending");
  expect(v.submittedByMemberId).toBe(MEMBER_ID); expect(JSON.parse(v.amenities)).toEqual(["parking"]);
});
it("sân cách < 100 m → trả duplicate, chưa ghi; confirmDuplicate=true thì ghi", async () => {
  await submitVenue({ name: "Sân A", lat: 21.03, lng: 105.85 });
  const r = await submitVenue({ name: "Sân A2", lat: 21.0303, lng: 105.8502 });
  expect(r).toEqual({ duplicate: { id: expect.any(Number), name: "Sân A", distanceM: expect.any(Number) } });
  expect(await db.select().from(venues)).toHaveLength(1);
  expect(await submitVenue({ name: "Sân A2", lat: 21.0303, lng: 105.8502, confirmDuplicate: true })).toHaveProperty("success");
});
it("sân đã bị ẩn không tính là trùng", async () => { /* insert hidden rồi submit cạnh → success */ });
it("quá 3 lần/ngày → error", async () => {
  for (let i = 0; i < 3; i++) await submitVenue({ name: `S${i}`, lat: 21 + i * 0.1, lng: 105.85 });
  expect(await submitVenue({ name: "S4", lat: 21.5, lng: 105.85 })).toHaveProperty("error");
});
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `pnpm vitest run src/actions/venues-submit.integration.test.ts`
Expected: FAIL, `submitVenue` không tồn tại

- [ ] **Step 3: Viết schema + `submitVenue`**

Thứ tự trong action: `requireApprovedMember` → `checkRateLimit(\`venue-submit:${memberId}\`, 3, 86_400_000)` → zod → nếu thiếu lat/lng thì `resolveMapsLink` → kiểm lại `isInVietnam` → tìm sân trùng trong `boundingBox(p, 100)` với `status != 'hidden'`, lọc lại bằng `haversineMeters < 100` → insert → `revalidatePath("/admin/venues")`. Thông báo lỗi bằng `getTranslations` như `courts.ts`.

- [ ] **Step 4: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/actions/venues-submit.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (chờ user OK)

```bash
git add src/lib/validators.ts src/actions/venues.ts src/actions/venues-submit.integration.test.ts
git commit -m "feat(venues): let approved members submit a venue"
```

---

### Task 5: Đọc danh bạ công khai + geocode địa chỉ

**Files:**
- Modify: `src/actions/venues.ts`
- Create: `src/lib/public-venue.ts`, `src/lib/nominatim.ts`
- Test: `src/actions/venues-read.integration.test.ts`, `src/lib/nominatim.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 3
- Produces:
  - `type PublicVenue = { id: number; name: string; address: string | null; areaLabel: string | null; lat: number; lng: number; courtCount: number | null; openHours: string | null; amenities: VenueAmenity[]; phone: string | null; refPricePerHour: number | null; photoLink: string | null }`
  - `toPublicVenue(row: typeof venues.$inferSelect): PublicVenue` (whitelist từng cột, không spread), `PUBLIC_VENUE_KEYS: readonly (keyof PublicVenue)[]`
  - `listVenuesNear(q: { lat: number; lng: number; radiusKm: 3 | 5 | 10 | 20; amenities?: VenueAmenity[] }): Promise<{ venues: (PublicVenue & { distanceM: number })[] } | { error: string }>`: tối đa 50, sắp theo `distanceM` tăng
  - `getPublicVenue(id: number): Promise<PublicVenue | null>` (chỉ `approved`)
  - `geocodeAddress(query: string): Promise<{ lat: number; lng: number; label: string } | { error: string }>`
  - Cache tag: `"venues"`

- [ ] **Step 1: Viết test thất bại**

```ts
// mock next/cache: unstable_cache = (fn) => fn, revalidateTag = vi.fn()
it("chỉ trả sân approved, sắp theo khoảng cách", async () => { /* 3 sân approved ở 1,2,4 km + 1 pending ở 0,5 km */
  const r = await listVenuesNear({ lat: 21.03, lng: 105.85, radiusKm: 5 });
  expect(r.venues.map((v) => v.name)).toEqual(["S1km", "S2km", "S4km"]);
});
it("loại sân ngoài bán kính dù nằm trong khung vuông (góc khung)", async () => { /* sân ở 4,5 km theo trục + 4,5 km theo trục kia ≈ 6,4 km */ });
it("người đứng lệch 0,004° khỏi tâm ô lưới vẫn thấy sân ở 4,9 km", async () => { /* review focus 4 */ });
it("payload không có submittedByMemberId, status", async () => {
  const [v] = (await listVenuesNear({ lat: 21.03, lng: 105.85, radiusKm: 5 })).venues;
  expect(Object.keys(v).sort()).toEqual([...PUBLIC_VENUE_KEYS, "distanceM"].sort());
});
it("lọc tiện ích: phải có đủ mọi tiện ích đã chọn", async () => { /* ... */ });
it("lat/lng không hợp lệ hoặc radius lạ → error", async () =>
  expect(await listVenuesNear({ lat: NaN, lng: 105, radiusKm: 5 })).toHaveProperty("error"));
```

```ts
// nominatim.test.ts, fetch giả
it("gọi đúng URL có countrycodes=vn, format=jsonv2, limit=1 và User-Agent riêng", async () => { /* ... */ });
it("hai lời gọi liền nhau cách ≥ 1000 ms", async () => { /* vi.useFakeTimers */ });
it("không có kết quả → error", async () => { /* [] */ });
it("query rỗng hoặc > 200 ký tự → error, không gọi fetch", async () => { /* ... */ });
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `pnpm vitest run src/actions/venues-read.integration.test.ts src/lib/nominatim.test.ts`
Expected: FAIL

- [ ] **Step 3: Viết code**

`listVenuesNear`: zod kiểm đầu vào. Lấy `cell = snapToGrid(p)`, gọi hàm cache `unstable_cache(fetchCandidates, ["venues-near"], { revalidate: 60, tags: ["venues"] })` với khoá `(cell, radiusKm)`. Hàm này truy vấn `status='approved'` trong `boundingBox(cell, radiusKm*1000 + 1500)`, `limit 200`. Ngoài cache: tính `haversineMeters` từ toạ độ THẬT của người dùng, lọc `≤ radius`, lọc tiện ích, sắp xếp, cắt 50. Comment lý do: cache theo ô lưới để request dội không xuống DB (quota Turso 2/11); biên +1,5 km lớn hơn nửa đường chéo ô 0,01°. Dùng `unstable_cache` vì app chưa bật Cache Components, bật nó là thay đổi toàn app, ngoài scope.
`geocodeAddress`: `nominatim.ts` giữ hàng đợi trong tiến trình (1 req/s), header `User-Agent: FWBB/1.0 (+<origin của app>)`, `AbortSignal.timeout(5000)`. Bọc `unstable_cache` theo query đã chuẩn hoá (trim, lowercase), `revalidate: 604800`. Không ghi log query.

- [ ] **Step 4: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/actions/venues-read.integration.test.ts src/lib/nominatim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (chờ user OK)

```bash
git add src/actions/venues.ts src/lib/public-venue.ts src/lib/nominatim.ts src/actions/venues-read.integration.test.ts src/lib/nominatim.test.ts
git commit -m "feat(venues): list approved venues by distance"
```

---

### Task 6: Admin duyệt sân và nối sân của nhóm

**Files:**
- Modify: `src/actions/venues.ts`, `src/actions/courts.ts` (thêm `linkCourtToVenue`)
- Create: `src/app/(admin)/admin/venues/page.tsx`, `src/app/(admin)/admin/venues/venue-review-list.tsx`, `src/app/(admin)/admin/venues/loading.tsx`
- Modify: `src/app/(admin)/admin/courts/court-list.tsx` (ô chọn venue), `src/components/layout/admin-sidebar.tsx`, `src/components/layout/admin-mobile-nav.tsx`, `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/actions/venues-admin.integration.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` (`src/lib/auth.ts`), Task 3, Task 5 (tag `"venues"`)
- Produces:
  - `listVenuesForReview(status: VenueStatus): Promise<(typeof venues.$inferSelect & { submittedByName: string | null })[]>`
  - `setVenueStatus(id: number, status: "approved" | "hidden"): Promise<{ success: true } | { error: string }>` (ghi `approvedAt` khi approved)
  - `updateVenue(id: number, input: z.input<typeof venueSubmitSchema>): Promise<{ success: true } | { error: string }>`
  - `linkCourtToVenue(courtId: number, venueId: number | null): Promise<{ success: true } | { error: string }>` (venue phải tồn tại)
  - Mọi action ghi đều gọi `revalidateTag("venues")` và `revalidatePath("/admin/venues")`, `revalidatePath("/san")`

- [ ] **Step 1: Viết test thất bại**

```ts
it("không phải admin → error, không đổi", async () => { /* requireAdmin trả {error} */ });
it("approve: status=approved, approvedAt có giá trị, revalidateTag('venues')", async () => { /* ... */ });
it("hidden: sân biến mất khỏi listVenuesNear", async () => { /* ... */ });
it("linkCourtToVenue với venue không tồn tại → error", async () => { /* ... */ });
it("linkCourtToVenue không đổi pricePerSession của court", async () => { /* ... */ });
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `pnpm vitest run src/actions/venues-admin.integration.test.ts`
Expected: FAIL

- [ ] **Step 3: Viết action + trang admin**

Trang `/admin/venues`: 3 tab Chờ duyệt / Đã duyệt / Đã ẩn (nuqs `?tab=`). Mỗi thẻ có tên, địa chỉ, người đề xuất, link "Xem trên Maps" (`directionsUrl`), nút Duyệt / Ẩn / Sửa. Duyệt/Ẩn dùng `fireAction`: thẻ rời tab ngay, rollback nếu lỗi. Sửa mở bottom sheet trên mobile. Trong `court-list.tsx`, form sửa sân có ô chọn venue đã duyệt (hoặc "Không nối"). Thêm mục "Danh bạ sân" vào sidebar/nav admin. Có skeleton và empty state cho từng tab.

- [ ] **Step 4: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/actions/venues-admin.integration.test.ts src/i18n/locale-parity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (chờ user OK)

```bash
git add src/actions src/app/(admin)/admin/venues src/app/(admin)/admin/courts/court-list.tsx src/components/layout src/i18n/messages
git commit -m "feat(venues): add admin review for submitted venues"
```

---

### Task 7: Trang `/san`, `/san/[id]`, `/san/de-xuat`

**Files:**
- Create: `src/app/(public)/san/page.tsx`, `src/app/(public)/san/venue-directory.tsx` (client), `src/app/(public)/san/loading.tsx`
- Create: `src/app/(public)/san/[id]/page.tsx`
- Create: `src/app/(public)/san/de-xuat/page.tsx`, `src/app/(public)/san/de-xuat/venue-submit-form.tsx`
- Create: `src/components/venues/venue-card.tsx`, `src/components/venues/use-user-location.ts`, `src/components/venues/location-fallback.tsx`
- Modify: `src/components/layout/nav-drawer.tsx` (mục "Sân"), `src/i18n/messages/{vi,en,zh}.json`
- Test: `src/components/venues/venue-card.test.tsx`, `e2e/venue-directory.spec.ts`

**Interfaces:**
- Consumes: `listVenuesNear`, `getPublicVenue`, `geocodeAddress`, `submitVenue` (Task 4, 5), `directionsUrl`, `formatDistance`, `VENUE_AMENITIES`
- Produces:
  - `useUserLocation(): { status: "idle" | "asking" | "ok" | "denied" | "unsupported"; position: LatLng | null; request: () => void; setManual: (p: LatLng) => void }`
  - `<VenueCard venue={PublicVenue & { distanceM?: number }} locale />`

- [ ] **Step 1: Viết test component thất bại**

```tsx
it("hiện khoảng cách, số sân, giá tham khảo dạng 'xxx.000đ/giờ', link chỉ đường mở tab mới", () => {
  render(<VenueCard venue={{ ...base, distanceM: 2345, courtCount: 6, refPricePerHour: 120000 }} locale="vi" />);
  expect(screen.getByText("2,3 km")).toBeInTheDocument();
  const a = screen.getByRole("link", { name: /chỉ đường/i });
  expect(a).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=21.03,105.85");
  expect(a).toHaveAttribute("target", "_blank"); expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
});
it("số điện thoại là link tel:", () => { /* ... */ });
it("không có giá → không hiện dòng giá", () => { /* ... */ });
```

- [ ] **Step 2: Chạy test, kỳ vọng FAIL**

Run: `pnpm vitest run src/components/venues/venue-card.test.tsx`
Expected: FAIL

- [ ] **Step 3: Viết UI**

- `/san`: bộ lọc nuqs `?r=5&a=parking,air_con` (bán kính mặc định 5, chỉ nhận 3/5/10/20). Khi mở: gọi `request()` một lần. `ok` thì react-query `["venues-near", lat.toFixed(3), lng.toFixed(3), r, a]` gọi `listVenuesNear`, `staleTime: 60_000`, không `refetchInterval`. `denied`/`unsupported` thì hiện `LocationFallback`: ô nhập địa chỉ gọi `geocodeAddress`, thành công thì `setManual`. Danh sách là các `VenueCard` với `motion` + `layout`. Skeleton 3 thẻ đúng kích thước thật. Không có sân: empty state có nút "Mở rộng bán kính" (tăng lên mức kế) và "Đề xuất sân".
- `/san/[id]`: server component, `getPublicVenue`, không có thì `notFound()`. Hiện đủ trường, nút "Chỉ đường" dính đáy màn hình.
- `/san/de-xuat`: cần member approved (không thì redirect `/login`). react-hook-form + `venueSubmitSchema`. Ô link Google Maps kèm hướng dẫn ngắn "Mở Google Maps → Chia sẻ → Sao chép liên kết". Nếu action trả `duplicate` thì hiện bottom sheet "Có thể trùng với <tên> (cách <x> m)" với nút "Vẫn gửi" (gửi lại kèm `confirmDuplicate: true`) và "Xem sân đó". Thành công thì toast và về `/san`. Comment ở form: không dùng `fireAction` vì kết quả (trùng/lỗi toạ độ) quyết định bước tiếp theo.
- Drawer: thêm "Sân" (icon `MapPin`). Kiểm product tour (`src/components/tour/`) nếu tour đếm số mục drawer thì cập nhật bước tương ứng và chạy lại e2e tour.

- [ ] **Step 4: Viết e2e**

`e2e/venue-directory.spec.ts` (dùng `e2e/local.db`, seed sân approved/pending bằng helper e2e có sẵn, KHÔNG ghi trong migration):
1. `context.grantPermissions(["geolocation"])` + `setGeolocation({ latitude: 21.03, longitude: 105.85 })` → thấy sân approved theo đúng thứ tự khoảng cách, không thấy sân pending.
2. Context không cấp quyền geolocation → thấy ô nhập địa chỉ trong 5 giây, không thấy skeleton mãi (review focus 3). Mock route `**/nominatim**` nếu gọi ra ngoài.
3. Bấm "Chỉ đường" → link có `destination=21.03` (không mở thật).
Dùng `.first()` và không chờ `networkidle` (memory `project_e2e_polling_flake`).

- [ ] **Step 5: Chạy test, kỳ vọng PASS**

Run: `pnpm vitest run src/components/venues src/i18n/locale-parity.test.ts`
Expected: PASS
Run: `pnpm build; echo "build_exit=$?"` rồi `pnpm test:e2e e2e/venue-directory.spec.ts; echo "e2e_exit=$?"` (playwright chạy bản build gần nhất, phải build lại sau khi sửa `src/`)
Expected: `build_exit=0`, `e2e_exit=0`

- [ ] **Step 6: Commit** (chờ user OK)

```bash
git add src/app/(public)/san src/components/venues src/components/layout/nav-drawer.tsx src/i18n/messages e2e/venue-directory.spec.ts
git commit -m "feat(venues): add public venue directory sorted by distance"
```

---

### Task 8: Cổng kiểm tra + review + deploy

- [ ] **Step 1:** `git fetch` và cập nhật base `main` mới nhất vào nhánh, cài lại deps nếu lockfile đổi.
- [ ] **Step 2:** Chạy riêng từng cổng, đọc exit code trực tiếp:
  `npx tsc --noEmit; echo "tsc_exit=$?"`, `pnpm lint; echo "lint_exit=$?"`, `pnpm test; echo "test_exit=$?"` (FULL suite), `pnpm build; echo "build_exit=$?"`, `pnpm test:e2e; echo "e2e_exit=$?"`. Tất cả phải bằng 0.
- [ ] **Step 3:** Gọi `mobile-ui-reviewer` cho các file `.tsx` mới. Chạy `/code-review` trên toàn nhánh. Sửa hết phát hiện đã xác nhận rồi chạy lại Step 2.
- [ ] **Step 4 (cần user xác nhận trước, thao tác ra ngoài):** áp migration lên prod bằng `node scripts/apply-migration.mjs --env=.env.prod`, rồi kiểm `sqlite_master` có `venues` + `venues_status_lat_lng_idx` + cột `courts.venue_id`. Push `main` (chờ user OK) rồi `vercel --prod --yes` (push không tự deploy). Mở `/san` trên điện thoại thật trong Zalo để kiểm luồng từ chối GPS.
- [ ] **Step 5:** Cập nhật memory `project_exchange_events_nearby.md`: G1 đã lên prod (commit, ngày), bước kế là G2 (cần app Zalo của user).
