"use server";

import {
  notifyVenuePending,
  notifyVenueStatus,
} from "@/lib/notifications/account-events";
import { db } from "@/db";
import { members, venues } from "@/db/schema";
import { and, between, eq, ne, sql } from "drizzle-orm";
import { revalidatePath, unstable_cache, updateTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { venueSubmitSchema } from "@/lib/validators";
import { requireApprovedMember } from "@/lib/member-auth";
import { requireAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveMapsLink } from "@/lib/maps-link-resolve";
import {
  boundingBox,
  haversineMeters,
  isInVietnam,
  snapToGrid,
  type LatLng,
} from "@/lib/geo";
import { toPublicVenue, type PublicVenue } from "@/lib/public-venue";
import { VENUE_AMENITIES, type VenueStatus } from "@/lib/venue-amenities";
import { geocodeNominatim } from "@/lib/nominatim";
import { getTrustedClientIp } from "@/lib/client-ip";
import { ipRateLimitKey } from "@/lib/ip-rate-limit-key";

/** Sân cách nhau dưới mức này coi là có thể trùng. */
const DUPLICATE_RADIUS_M = 100;
const SUBMIT_LIMIT_PER_DAY = 3;
const SUBMIT_TRIES_PER_MIN = 10;

/*
 * Xếp hàng các lần ghi sân đề xuất trong một process. Transaction chạy song
 * song trên DB file local (test) bị SQLITE_BUSY ngay lúc COMMIT; ở Turso thật
 * thì không, và ràng buộc "tối đa N sân/ngày" vẫn do câu INSERT ... WHERE đảm
 * bảo. Hàng đợi chỉ giữ cho tx mới (insert + tin) không đua nhau.
 */
let submitQueue: Promise<unknown> = Promise.resolve();
function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  const run = submitQueue.then(fn, fn);
  submitQueue = run.catch(() => undefined);
  return run;
}

/**
 * Member đã duyệt đề xuất một sân vào danh bạ (status `pending`, chờ admin).
 *
 * Trả `{ duplicate }` (không ghi) khi đã có sân chưa ẩn cách < 100 m; client
 * hỏi lại người dùng rồi gửi kèm `confirmDuplicate: true`.
 */
export async function submitVenue(
  input: z.input<typeof venueSubmitSchema>,
): Promise<
  | { success: true; id: number }
  | { error: string }
  | {
      duplicate: {
        id: number;
        name: string;
        distanceM: number;
        isPublic: boolean;
      };
    }
> {
  const auth = await requireApprovedMember();
  if ("error" in auth) return auth;
  const memberId = auth.member.id;
  const t = await getTranslations("serverErrors");

  const parsed = venueSubmitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  // Chặn spam lần thử (kể cả lần lỗi) trên đường ĐẮT: resolve link rút gọn
  // kéo theo vài lượt fetch ra ngoài. Lần gửi có sẵn toạ độ không gọi mạng.
  if (data.lat === undefined || data.lng === undefined) {
    const tries = await checkRateLimit(
      `venue-submit-try:${memberId}`,
      SUBMIT_TRIES_PER_MIN,
      60_000,
    );
    if (!tries.ok) {
      return {
        error: t("tooManyActions", { seconds: tries.retryAfter ?? 60 }),
      };
    }
  }

  const resolved = await resolveVenuePoint(data);
  if ("errorKey" in resolved) return { error: t(resolved.errorKey) };
  const point = resolved.point;

  if (!data.confirmDuplicate) {
    const dup = await findNearbyVenue(point);
    if (dup) return { duplicate: dup };
  }

  // Giới hạn tính trên số sân ĐÃ GỬI THÀNH CÔNG trong 24 giờ (lần lỗi toạ độ,
  // lần bị báo trùng không bị tính). Đếm và ghi trong CÙNG một câu lệnh
  // (INSERT ... SELECT ... WHERE count < N): tách đếm rồi mới insert thì N
  // request song song cùng thấy count=0 và cùng lọt qua.
  const row = await runSerial(() =>
    db.transaction(async (tx) => {
      const rows = await tx.all<{ id: number }>(sql`
    INSERT INTO ${venues} (
      name, address, lat, lng, map_link, court_count, open_hours, amenities,
      phone, ref_price_per_hour, photo_link, submitted_by_member_id
    )
    SELECT
      ${data.name}, ${data.address || null}, ${point.lat}, ${point.lng},
      ${data.mapLink || null}, ${data.courtCount ?? null},
      ${data.openHours || null}, ${JSON.stringify(data.amenities)},
      ${data.phone || null}, ${data.refPricePerHour ?? null},
      ${data.photoLink || null}, ${memberId}
    WHERE (
      SELECT count(*) FROM ${venues}
      WHERE submitted_by_member_id = ${memberId}
        AND created_at >= datetime('now', '-1 day')
    ) < ${SUBMIT_LIMIT_PER_DAY}
    RETURNING id
  `);
      const inserted = rows[0];
      if (inserted) {
        await notifyVenuePending(tx, {
          venueId: inserted.id,
          venueName: data.name,
          proposerId: memberId,
        });
      }
      return inserted;
    }),
  );
  if (!row) return { error: t("venueSubmitLimit") };

  // Layout admin (huy hiệu số sân chờ duyệt) cũng phải tươi, không chỉ trang sân.
  revalidatePath("/admin", "layout");
  return { success: true, id: row.id };
}

/** Toạ độ nhập tay được ưu tiên; không có thì tách từ link Google Maps. */
async function resolveVenuePoint(data: {
  lat?: number;
  lng?: number;
  mapLink?: string;
}): Promise<
  { point: LatLng } | { errorKey: "venueNoCoordinates" | "venueOutsideVietnam" }
> {
  let point: LatLng | null =
    data.lat !== undefined && data.lng !== undefined
      ? { lat: data.lat, lng: data.lng }
      : null;
  if (!point && data.mapLink) point = await resolveMapsLink(data.mapLink);
  if (!point) return { errorKey: "venueNoCoordinates" };
  if (!isInVietnam(point)) return { errorKey: "venueOutsideVietnam" };
  return { point };
}

async function findNearbyVenue(p: LatLng): Promise<{
  id: number;
  name: string;
  distanceM: number;
  isPublic: boolean;
} | null> {
  const bb = boundingBox(p, DUPLICATE_RADIUS_M);
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      lat: venues.lat,
      lng: venues.lng,
      status: venues.status,
    })
    .from(venues)
    .where(
      and(
        ne(venues.status, "hidden"),
        between(venues.lat, bb.minLat, bb.maxLat),
        between(venues.lng, bb.minLng, bb.maxLng),
      ),
    );
  let best: {
    id: number;
    name: string;
    distanceM: number;
    isPublic: boolean;
  } | null = null;
  for (const r of rows) {
    const d = haversineMeters(p, r);
    if (d < DUPLICATE_RADIUS_M && (!best || d < best.distanceM)) {
      best = {
        id: r.id,
        name: r.name,
        distanceM: Math.round(d),
        isPublic: r.status === "approved",
      };
    }
  }
  return best;
}

const RADII_KM = [3, 5, 10, 20] as const;
const MAX_RESULTS = 50;
/**
 * Biên cộng thêm khi đọc ứng viên quanh TÂM Ô LƯỚI thay vì vị trí thật. Phải
 * lớn hơn nửa đường chéo ô 0,01° (~0,78 km) để người đứng ở góc ô không bị
 * mất sân sát mép bán kính.
 */
const GRID_MARGIN_M = 1500;
const CANDIDATE_LIMIT = 200;

const nearQuerySchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  radiusKm: z.union(
    RADII_KM.map((r) => z.literal(r)) as [
      z.ZodLiteral<3>,
      z.ZodLiteral<5>,
      z.ZodLiteral<10>,
      z.ZodLiteral<20>,
    ],
  ),
  amenities: z.array(z.enum(VENUE_AMENITIES)).max(6).optional(),
});

/**
 * Ứng viên quanh một ô lưới, có cache. Khoá cache là (ô lưới, bán kính) chứ
 * không phải toạ độ thật, nên nhiều người đứng gần nhau và request dội liên
 * tục chỉ xuống DB một lần mỗi 60 giây (bài học quota Turso 2/11/2026).
 *
 * Dùng `unstable_cache` vì app chưa bật Cache Components; bật nó là thay đổi
 * cách cache của toàn app, ngoài phạm vi danh bạ sân.
 */
const getCandidatesNearCell = unstable_cache(
  async (
    cellLat: number,
    cellLng: number,
    radiusKm: number,
    amenitiesKey: string,
  ) => {
    const bb = boundingBox(
      { lat: cellLat, lng: cellLng },
      radiusKm * 1000 + GRID_MARGIN_M,
    );
    // Kinh độ co lại theo cos(vĩ độ); nhân vào để sắp xếp gần đúng theo
    // khoảng cách thật mà không cần hàm lượng giác trong SQLite.
    const cosLat = Math.cos((cellLat * Math.PI) / 180);
    const amenityConds = amenitiesKey
      ? amenitiesKey
          .split(",")
          .map((a) => sql`instr(${venues.amenities}, ${`"${a}"`}) > 0`)
      : [];
    const rows = await db
      .select()
      .from(venues)
      .where(
        and(
          eq(venues.status, "approved"),
          between(venues.lat, bb.minLat, bb.maxLat),
          between(venues.lng, bb.minLng, bb.maxLng),
          ...amenityConds,
        ),
      )
      // Sắp theo khoảng cách TRƯỚC khi cắt: không thì danh bạ lớn trả 200
      // dòng bất kỳ trong khung và sân gần nhất có thể bị loại.
      .orderBy(
        sql`(${venues.lat} - ${cellLat}) * (${venues.lat} - ${cellLat}) + ((${venues.lng} - ${cellLng}) * ${cosLat}) * ((${venues.lng} - ${cellLng}) * ${cosLat})`,
      )
      .limit(CANDIDATE_LIMIT);
    return rows.map(toPublicVenue);
  },
  ["venues-near"],
  { revalidate: 60, tags: ["venues"] },
);

/**
 * Sân đã duyệt quanh một điểm, sắp theo khoảng cách. Công khai (không cần
 * đăng nhập). Vị trí người dùng chỉ dùng trong request này, không lưu, không
 * log.
 */
export async function listVenuesNear(q: {
  lat: number;
  lng: number;
  radiusKm: (typeof RADII_KM)[number];
  amenities?: (typeof VENUE_AMENITIES)[number][];
}): Promise<
  { venues: (PublicVenue & { distanceM: number })[] } | { error: string }
> {
  const parsed = nearQuerySchema.safeParse(q);
  if (!parsed.success) {
    const t = await getTranslations("serverErrors");
    return { error: t("missingFields") };
  }
  const { lat, lng, radiusKm, amenities = [] } = parsed.data;
  const cell = snapToGrid({ lat, lng });
  // Mã tiện ích đã qua zod enum nên an toàn để ghép vào khoá; sắp xếp để
  // ["a","b"] và ["b","a"] dùng chung một mục cache.
  const amenitiesKey = [...new Set(amenities)].sort().join(",");
  const candidates = await getCandidatesNearCell(
    cell.lat,
    cell.lng,
    radiusKm,
    amenitiesKey,
  );

  const radiusM = radiusKm * 1000;
  const result = candidates
    .map((v) => ({
      ...v,
      distanceM: Math.round(haversineMeters({ lat, lng }, v)),
    }))
    .filter(
      (v) =>
        v.distanceM <= radiusM &&
        amenities.every((a) => v.amenities.includes(a)),
    )
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_RESULTS);
  return { venues: result };
}

/** Chi tiết một sân đã duyệt; `null` nếu không có hoặc chưa duyệt/đã ẩn. */
export async function getPublicVenue(id: number): Promise<PublicVenue | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.query.venues.findFirst({
    where: and(eq(venues.id, id), eq(venues.status, "approved")),
  });
  return row ? toPublicVenue(row) : null;
}

class GeocodeTransientError extends Error {}

/**
 * Cache 7 ngày cho kết quả THẬT (tìm thấy / không có). Lỗi tạm thời (429, mạng,
 * hàng chờ đầy) thì throw: `unstable_cache` không cache lần throw, nên một lần
 * Nominatim trục trặc không biến thành câu trả lời sai suốt cả tuần.
 */
const geocodeCached = unstable_cache(
  async (normalized: string) => {
    const r = await geocodeNominatim(normalized);
    if (r.status === "error" || r.status === "busy") {
      throw new GeocodeTransientError();
    }
    return r;
  },
  ["venues-geocode"],
  { revalidate: 604_800 },
);

const GEOCODE_LIMIT_PER_MIN = 10;
const GEOCODE_GLOBAL_PER_MIN = 60;

/**
 * Đường lùi khi người dùng từ chối GPS: gõ địa chỉ/khu vực để lấy toạ độ.
 * Công khai nên giới hạn theo IP: Nominatim cấm dùng nặng, và spam chuỗi khác
 * nhau sẽ lách được cache.
 */
export async function geocodeAddress(
  query: string,
): Promise<{ lat: number; lng: number; label: string } | { error: string }> {
  const t = await getTranslations("serverErrors");
  const normalized = (query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 200)
    return { error: t("missingFields") };

  const ip = await getTrustedClientIp();
  const rl = await checkRateLimit(
    `geocode:${ipRateLimitKey(ip)}`,
    GEOCODE_LIMIT_PER_MIN,
    60_000,
  );
  if (!rl.ok) {
    return { error: t("tooManyActions", { seconds: rl.retryAfter ?? 60 }) };
  }
  // Trần chung cho mọi IP: hàng đợi 1 req/s trong nominatim.ts chỉ giữ nhịp
  // trong MỘT instance; xoay IP + nhiều instance Vercel vẫn có thể vượt chính
  // sách của Nominatim và làm IP của app bị chặn cho tất cả mọi người.
  const global = await checkRateLimit(
    "geocode:global",
    GEOCODE_GLOBAL_PER_MIN,
    60_000,
  );
  if (!global.ok) return { error: t("venueGeocodeUnavailable") };

  try {
    const r = await geocodeCached(normalized);
    if (r.status !== "ok") return { error: t("venueAddressNotFound") };
    return { lat: r.lat, lng: r.lng, label: r.label };
  } catch (e) {
    if (e instanceof GeocodeTransientError) {
      return { error: t("venueGeocodeUnavailable") };
    }
    throw e;
  }
}

/**
 * Sau mọi thao tác admin: `updateTag` (không phải `revalidateTag`) để cache
 * danh bạ hết hạn NGAY — sân vừa bị ẩn (spam, sai) không được phục vụ thêm
 * một lượt từ bản cũ.
 */
function afterAdminVenueChange() {
  updateTag("venues");
  revalidatePath("/admin", "layout");
  revalidatePath("/san");
}

/** Danh sách sân theo trạng thái cho trang admin, kèm tên người đề xuất. */
export async function listVenuesForReview(status: VenueStatus) {
  const auth = await requireAdmin();
  if ("error" in auth) return [];
  return db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      areaLabel: venues.areaLabel,
      lat: venues.lat,
      lng: venues.lng,
      mapLink: venues.mapLink,
      courtCount: venues.courtCount,
      openHours: venues.openHours,
      amenities: venues.amenities,
      phone: venues.phone,
      refPricePerHour: venues.refPricePerHour,
      photoLink: venues.photoLink,
      status: venues.status,
      createdAt: venues.createdAt,
      submittedByName: members.name,
    })
    .from(venues)
    .leftJoin(members, eq(members.id, venues.submittedByMemberId))
    .where(eq(venues.status, status))
    .orderBy(venues.createdAt);
}

export type ReviewVenue = Awaited<
  ReturnType<typeof listVenuesForReview>
>[number];

export async function setVenueStatus(
  id: number,
  status: "approved" | "hidden",
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");
  const found = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: venues.status })
      .from(venues)
      .where(eq(venues.id, id))
      .limit(1);
    const updated = await tx
      .update(venues)
      .set({
        status,
        ...(status === "approved"
          ? { approvedAt: new Date().toISOString() }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(venues.id, id))
      .returning({
        id: venues.id,
        name: venues.name,
        submittedByMemberId: venues.submittedByMemberId,
      });
    const row = updated[0];
    if (!row) return false;
    // Bấm lại cùng trạng thái không phải sự kiện mới.
    if (before?.status !== status) {
      await notifyVenueStatus(tx, {
        venueId: row.id,
        venueName: row.name,
        status,
        proposerId: row.submittedByMemberId,
      });
    }
    return true;
  });
  if (!found) return { error: t("venueNotFound") };
  afterAdminVenueChange();
  return { success: true };
}

/** Admin sửa sân. Validate như lúc đề xuất (cùng `venueSubmitSchema`). */
export async function updateVenue(
  id: number,
  input: z.input<typeof venueSubmitSchema>,
): Promise<{ success: true } | { error: string }> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth;
  const t = await getTranslations("serverErrors");
  const parsed = venueSubmitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  const resolved = await resolveVenuePoint(data);
  if ("errorKey" in resolved) return { error: t(resolved.errorKey) };
  const point = resolved.point;

  const updated = await db
    .update(venues)
    .set({
      name: data.name,
      address: data.address || null,
      lat: point.lat,
      lng: point.lng,
      mapLink: data.mapLink || null,
      courtCount: data.courtCount ?? null,
      openHours: data.openHours || null,
      amenities: JSON.stringify(data.amenities),
      phone: data.phone || null,
      refPricePerHour: data.refPricePerHour ?? null,
      photoLink: data.photoLink || null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(venues.id, id))
    .returning({ id: venues.id });
  if (updated.length === 0) return { error: t("venueNotFound") };
  afterAdminVenueChange();
  return { success: true };
}
