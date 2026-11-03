"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, LocateFixed, Search } from "lucide-react";
import { geocodeAddress } from "@/actions/venues";
import type { LatLng } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Đường lùi khi không có GPS (bị từ chối, hoặc trình duyệt nhúng Zalo/
 * Messenger không hỗ trợ): gõ địa chỉ/khu vực rồi tìm sân quanh đó.
 */
export function LocationFallback({
  onLocated,
  onRetryGps,
}: {
  onLocated: (p: LatLng, label: string) => void;
  onRetryGps: () => void;
}) {
  const t = useTranslations("venues");
  const [query, setQuery] = useState("");
  const geocode = useMutation({
    mutationFn: (q: string) => geocodeAddress(q),
    onSuccess: (r) => {
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      onLocated({ lat: r.lat, lng: r.lng }, r.label);
    },
    onError: () => toast.error(t("loadError")),
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/80 space-y-3 rounded-2xl border p-4 backdrop-blur"
    >
      <p className="text-base">{t("locationDenied")}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) geocode.mutate(query);
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addressPlaceholder")}
          aria-label={t("addressPlaceholder")}
          className="min-h-11 text-base"
          maxLength={200}
        />
        <Button
          type="submit"
          className="min-h-11 shrink-0"
          disabled={geocode.isPending || !query.trim()}
        >
          {geocode.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          <span className="ml-1.5">{t("search")}</span>
        </Button>
      </form>
      <button
        type="button"
        onClick={onRetryGps}
        className="text-primary inline-flex min-h-11 items-center gap-1.5 text-sm"
      >
        <LocateFixed className="h-4 w-4" />
        {t("useMyLocation")}
      </button>
      <p className="text-muted-foreground text-sm">{t("attribution")}</p>
    </motion.div>
  );
}
