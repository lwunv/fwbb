"use server";

import { db } from "@/db";
import { venues } from "@/db/schema";
import { and, between, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import { venueSubmitSchema } from "@/lib/validators";
import { requireApprovedMember } from "@/lib/member-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveMapsLink } from "@/lib/maps-link-resolve";
import {
  boundingBox,
  haversineMeters,
  isInVietnam,
  type LatLng,
} from "@/lib/geo";

/** Sân cách nhau dưới mức này coi là có thể trùng. */
const DUPLICATE_RADIUS_M = 100;
const SUBMIT_LIMIT_PER_DAY = 3;
const DAY_MS = 86_400_000;

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
  | { duplicate: { id: number; name: string; distanceM: number } }
> {
  const auth = await requireApprovedMember();
  if ("error" in auth) return auth;
  const memberId = auth.member.id;
  const t = await getTranslations("serverErrors");

  const rl = await checkRateLimit(
    `venue-submit:${memberId}`,
    SUBMIT_LIMIT_PER_DAY,
    DAY_MS,
  );
  if (!rl.ok) {
    return {
      error: t("tooManyActions", { seconds: rl.retryAfter ?? 3600 }),
    };
  }

  const parsed = venueSubmitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;

  let point: LatLng | null =
    data.lat !== undefined && data.lng !== undefined
      ? { lat: data.lat, lng: data.lng }
      : null;
  if (!point && data.mapLink) point = await resolveMapsLink(data.mapLink);
  if (!point) return { error: t("venueNoCoordinates") };
  if (!isInVietnam(point)) return { error: t("venueOutsideVietnam") };

  if (!data.confirmDuplicate) {
    const dup = await findNearbyVenue(point);
    if (dup) return { duplicate: dup };
  }

  const [row] = await db
    .insert(venues)
    .values({
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
      submittedByMemberId: memberId,
    })
    .returning({ id: venues.id });

  revalidatePath("/admin/venues");
  return { success: true, id: row.id };
}

async function findNearbyVenue(
  p: LatLng,
): Promise<{ id: number; name: string; distanceM: number } | null> {
  const bb = boundingBox(p, DUPLICATE_RADIUS_M);
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      lat: venues.lat,
      lng: venues.lng,
    })
    .from(venues)
    .where(
      and(
        ne(venues.status, "hidden"),
        between(venues.lat, bb.minLat, bb.maxLat),
        between(venues.lng, bb.minLng, bb.maxLng),
      ),
    );
  let best: { id: number; name: string; distanceM: number } | null = null;
  for (const r of rows) {
    const d = haversineMeters(p, r);
    if (d < DUPLICATE_RADIUS_M && (!best || d < best.distanceM)) {
      best = { id: r.id, name: r.name, distanceM: Math.round(d) };
    }
  }
  return best;
}
