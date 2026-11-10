"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import { geocodeAddress } from "@/actions/venues";
import type { LatLng } from "@/lib/geo";
import { islandLabelAt } from "@/lib/map/island-label";
import type { PublicVenue } from "@/lib/public-venue";
import {
  exactVenueMatch,
  matchVenuesByName,
  normalizeName,
} from "@/lib/venues/directory-state";
import { cn } from "@/lib/utils";

type Place = { lat: number; lng: number; label: string };

/**
 * Ô tìm nổi trên bản đồ. Gõ chỉ gợi ý tên sân ở client (không gọi server).
 * Server chỉ bị gọi khi Enter / bấm dòng "Tìm địa điểm", và kết quả thành công
 * được nhớ theo chuỗi chuẩn hoá vì Nominatim có giới hạn nhịp.
 */
export function VenueSearchBar({
  venues,
  locale,
  onPickVenue,
  onPlace,
  onLocate,
  locating,
  onFocusChange,
}: {
  venues: (PublicVenue & { distanceM?: number })[];
  locale: "vi" | "en" | "zh";
  onPickVenue: (id: number) => void;
  onPlace: (p: LatLng, label: string) => void;
  onLocate: () => void;
  locating: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  const t = useTranslations("venues");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, Place>());
  // Khoá đồng bộ: isPending của react-query chỉ cập nhật sau lần render kế.
  const inFlight = useRef(false);
  // Chuỗi chuẩn hoá đang nằm trong ô; null khi người dùng đã chọn sân. Kết quả
  // geocode về muộn chỉ được bay tới nếu vẫn khớp.
  const currentKey = useRef<string | null>("");

  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({ mutationFn: geocodeAddress });

  const trimmed = q.trim();
  const suggestions = matchVenuesByName(venues, q, 5);
  // Dòng cuối luôn là "Tìm địa điểm" để tên sân trùng tên khu vẫn bay tới khu.
  const optionCount = trimmed ? suggestions.length + 1 : 0;
  const placeIndex = suggestions.length;
  const open = focused && optionCount > 0;

  const finish = (p: Place) => {
    onPlace(
      { lat: p.lat, lng: p.lng },
      islandLabelAt({ lat: p.lat, lng: p.lng }, locale) ?? p.label,
    );
    setActive(-1);
    inputRef.current?.blur();
  };

  const pickVenue = (v: PublicVenue) => {
    currentKey.current = null;
    setQ(v.name);
    setActive(-1);
    onPickVenue(v.id);
    inputRef.current?.blur();
  };

  const searchPlace = () => {
    if (!trimmed || inFlight.current) return;
    setError(null);
    const key = normalizeName(trimmed);
    const hit = cache.current.get(key);
    if (hit) {
      finish(hit);
      return;
    }
    inFlight.current = true;
    void mutation
      .mutateAsync(trimmed)
      .then((r) => {
        if ("error" in r) {
          if (currentKey.current === key) setError(r.error);
          return;
        }
        // Luôn nhớ kết quả; chỉ bay tới khi người dùng chưa gõ/chọn thứ khác.
        cache.current.set(key, r);
        if (currentKey.current === key) finish(r);
      })
      .catch(() => {
        if (currentKey.current === key) setError(t("searchFailed"));
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  const submit = () => {
    if (!trimmed) return;
    if (active >= 0 && active < suggestions.length) {
      pickVenue(suggestions[active]);
      return;
    }
    if (active === placeIndex) {
      searchPlace();
      return;
    }
    const exact = exactVenueMatch(venues, q);
    if (exact) {
      pickVenue(exact);
      return;
    }
    searchPlace();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Đang gõ dấu bằng IME/Telex: Enter là chốt chữ, không phải gửi tìm kiếm.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((a) => (a + 1) % optionCount);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? optionCount - 1 : a - 1));
    } else if (e.key === "Escape") {
      setActive(-1);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="relative">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="bg-card/90 flex items-center gap-1 rounded-full border pl-4 shadow-lg backdrop-blur"
      >
        {mutation.isPending ? (
          <Loader2
            className="text-muted-foreground size-5 shrink-0 animate-spin"
            aria-hidden
          />
        ) : (
          <Search
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden
          />
        )}
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0 ? `${listId}-opt-${active}` : undefined
          }
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          aria-busy={mutation.isPending}
          maxLength={200}
          autoComplete="off"
          value={q}
          onChange={(e) => {
            currentKey.current = normalizeName(e.target.value);
            setQ(e.target.value);
            setActive(-1);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
          }}
          className="placeholder:text-muted-foreground min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
        />
        <button
          type="button"
          onClick={onLocate}
          aria-label={t("useMyLocation")}
          className="text-primary flex size-11 shrink-0 items-center justify-center rounded-full"
        >
          <LocateFixed
            className={cn("size-5", locating && "animate-spin")}
            aria-hidden
          />
        </button>
      </form>

      {open && (
        <ul
          id={listId}
          role="listbox"
          // Giữ focus ở ô nhập để bấm gợi ý không làm đóng danh sách trước click.
          onMouseDown={(e) => e.preventDefault()}
          className="bg-card/95 absolute inset-x-0 top-full mt-2 overflow-hidden rounded-2xl border shadow-lg backdrop-blur"
        >
          {suggestions.map((v, i) => (
            <li
              key={v.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={active === i}
              onClick={() => pickVenue(v)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2 text-base",
                active === i && "bg-accent",
              )}
            >
              <MapPin className="text-primary size-4 shrink-0" aria-hidden />
              <span className="truncate">{v.name}</span>
            </li>
          ))}
          <li
            id={`${listId}-opt-${placeIndex}`}
            role="option"
            aria-selected={active === placeIndex}
            onClick={searchPlace}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 border-t px-4 py-2 text-base font-medium",
              active === placeIndex && "bg-accent",
            )}
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t("searchPlace", { q: trimmed })}</span>
          </li>
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="bg-card/95 text-destructive mt-2 rounded-xl border px-4 py-2 text-sm shadow-lg backdrop-blur"
        >
          {error}
        </p>
      )}
    </div>
  );
}
