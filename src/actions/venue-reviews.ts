"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { exchangeGate } from "@/lib/exchange/guards";
import {
  REVIEW_MAX_OFFSET,
  REVIEW_PAGE_SIZE,
} from "@/lib/reputation/constants";
import {
  getVenueReviewPage,
  type VenueReviewPage,
} from "@/lib/reputation/venue-review-read";

const listSchema = z.object({
  venueId: z.number().int().positive(),
  offset: z
    .number()
    .int()
    .min(0)
    .max(REVIEW_MAX_OFFSET)
    .multipleOf(REVIEW_PAGE_SIZE),
});

/**
 * Trang đánh giá công khai của một sân (khách gọi được). Cờ trước mọi thứ,
 * rồi zod, rồi cache. Sân ẩn hay chờ duyệt cho trang rỗng (I10).
 */
export async function listVenueReviews(
  input: unknown,
): Promise<{ success: true; data: VenueReviewPage } | { error: string }> {
  const gate = await exchangeGate();
  if ("error" in gate) return gate;
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    const t = await getTranslations("exchange.errors");
    return { error: t("invalidInput") };
  }
  const { venueId, offset } = parsed.data;
  return { success: true, data: await getVenueReviewPage(venueId, offset) };
}
