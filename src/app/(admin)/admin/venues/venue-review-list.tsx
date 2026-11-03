"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  Check,
  EyeOff,
  Edit,
  MapPin,
  Navigation,
  RotateCcw,
} from "lucide-react";
import {
  setVenueStatus,
  updateVenue,
  type ReviewVenue,
} from "@/actions/venues";
import { fireAction } from "@/lib/optimistic-action";
import { directionsUrl } from "@/lib/maps-link";
import { parseAmenities } from "@/lib/public-venue";
import { VENUE_STATUSES, type VenueStatus } from "@/lib/venue-amenities";
import { formatK, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { VenueForm } from "@/components/venues/venue-form";

export function VenueReviewList(props: Record<VenueStatus, ReviewVenue[]>) {
  const t = useTranslations("venues");
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(VENUE_STATUSES).withDefault("pending"),
  );
  // Overlay optimistic: id → trạng thái mới. Thẻ rời tab ngay khi bấm, rollback
  // nếu action lỗi. Prop mới từ revalidatePath đã phản ánh thì overlay vô hại
  // (cùng giá trị), nên không cần dọn.
  const [moved, setMoved] = useState<Record<number, VenueStatus>>({});
  const [editing, setEditing] = useState<ReviewVenue | null>(null);

  const all = [...props.pending, ...props.approved, ...props.hidden];
  const statusOf = (v: ReviewVenue) => moved[v.id] ?? v.status;
  const visible = all.filter((v) => statusOf(v) === tab);
  const countOf = (s: VenueStatus) =>
    all.filter((v) => statusOf(v) === s).length;

  function changeStatus(v: ReviewVenue, next: "approved" | "hidden") {
    const prev = moved[v.id];
    setMoved((m) => ({ ...m, [v.id]: next }));
    fireAction(
      () => setVenueStatus(v.id, next),
      () =>
        setMoved((m) => {
          const n = { ...m };
          if (prev === undefined) delete n[v.id];
          else n[v.id] = prev;
          return n;
        }),
      {
        successMsg: next === "approved" ? t("approvedToast") : t("hiddenToast"),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {VENUE_STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
              tab === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card/80 hover:bg-accent",
            )}
          >
            {t(`tab.${s}`)} ({countOf(s)})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={MapPin} title={t(`empty.${tab}`)} />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {visible.map((v) => (
              <motion.div
                key={v.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24 }}
              >
                <Card className="bg-card/80 backdrop-blur">
                  <CardContent className="space-y-3 p-4">
                    <div className="min-w-0 space-y-1">
                      <p className="text-base font-semibold">{v.name}</p>
                      {v.address && (
                        <p className="text-muted-foreground text-sm">
                          {v.address}
                        </p>
                      )}
                      <p className="text-muted-foreground text-sm">
                        {t("submittedBy", {
                          name: v.submittedByName ?? t("unknownSubmitter"),
                        })}
                      </p>
                      <div className="flex flex-wrap gap-x-3 text-sm">
                        {v.courtCount && (
                          <span>
                            {t("courtCountValue", { count: v.courtCount })}
                          </span>
                        )}
                        {v.refPricePerHour != null && (
                          <span className="tabular-nums">
                            {t("pricePerHourValue", {
                              price: formatK(v.refPricePerHour),
                            })}
                          </span>
                        )}
                        {parseAmenities(v.amenities).map((a) => (
                          <span key={a} className="text-muted-foreground">
                            {t(`amenity.${a}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={directionsUrl(v)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex min-h-11 items-center gap-1 text-sm"
                      >
                        <Navigation className="h-4 w-4" />
                        {t("checkOnMaps")}
                      </a>
                      <div className="flex-1" />
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setEditing(v)}
                      >
                        <Edit className="mr-1.5 h-4 w-4" />
                        {t("edit")}
                      </Button>
                      {statusOf(v) !== "hidden" && (
                        <Button
                          variant="outline"
                          className="text-destructive min-h-11"
                          onClick={() => changeStatus(v, "hidden")}
                        >
                          <EyeOff className="mr-1.5 h-4 w-4" />
                          {t("hide")}
                        </Button>
                      )}
                      {statusOf(v) !== "approved" && (
                        <Button
                          className="min-h-11"
                          onClick={() => changeStatus(v, "approved")}
                        >
                          {statusOf(v) === "hidden" ? (
                            <RotateCcw className="mr-1.5 h-4 w-4" />
                          ) : (
                            <Check className="mr-1.5 h-4 w-4" />
                          )}
                          {statusOf(v) === "hidden"
                            ? t("restore")
                            : t("approve")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      >
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-0 sm:mx-auto sm:max-w-lg"
        >
          <SheetHeader className="px-0">
            <SheetTitle>{t("editVenue")}</SheetTitle>
          </SheetHeader>
          {editing && (
            <VenueForm
              key={editing.id}
              submitLabel={t("save")}
              defaultValues={{
                name: editing.name,
                address: editing.address ?? undefined,
                mapLink: editing.mapLink ?? "",
                lat: editing.lat,
                lng: editing.lng,
                courtCount: editing.courtCount ?? undefined,
                openHours: editing.openHours ?? undefined,
                amenities: parseAmenities(editing.amenities),
                phone: editing.phone ?? undefined,
                refPricePerHour: editing.refPricePerHour ?? undefined,
                photoLink: editing.photoLink ?? "",
              }}
              onSubmit={async (values) => {
                // Chờ server (không optimistic): admin cần biết toạ độ/link có
                // hợp lệ không trước khi đóng form.
                const r = await updateVenue(editing.id, values);
                if ("error" in r) {
                  toast.error(r.error);
                  return;
                }
                toast.success(t("savedToast"));
                setEditing(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
