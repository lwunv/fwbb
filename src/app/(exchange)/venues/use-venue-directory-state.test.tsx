// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import viMessages from "@/i18n/messages/vi.json";
import { LAST_AREA_KEY } from "@/lib/venues/directory-state";

type GeoState = {
  status: "idle" | "asking" | "ok" | "denied" | "unsupported";
  position: { lat: number; lng: number } | null;
  label: string | null;
};

const { listVenuesNear, geo } = vi.hoisted(() => {
  const initial: GeoState = { status: "idle", position: null, label: null };
  let state: GeoState = initial;
  const listeners = new Set<() => void>();
  return {
    listVenuesNear: vi.fn(),
    geo: {
      get: () => state,
      set(next: Partial<GeoState>) {
        state = { ...state, ...next };
        listeners.forEach((l) => l());
      },
      subscribe(l: () => void) {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
      reset() {
        state = initial;
        listeners.clear();
      },
      request: vi.fn(),
    },
  };
});

vi.mock("@/actions/venues", () => ({ listVenuesNear }));
vi.mock("@/components/venues/use-user-location", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useUserLocation: () => {
      const s = useSyncExternalStore(geo.subscribe, geo.get, geo.get);
      return { ...s, request: geo.request, setManual: () => {} };
    },
  };
});

import {
  useVenueDirectoryState,
  type DirectoryVenue,
} from "./use-venue-directory-state";

function venue(id: number, over: Partial<DirectoryVenue> = {}): DirectoryVenue {
  return {
    id,
    name: `Sân ${id}`,
    address: null,
    areaLabel: null,
    lat: 21.03 + id / 1000,
    lng: 105.85,
    mapLink: null,
    courtCount: null,
    openHours: null,
    amenities: [],
    phone: null,
    refPricePerHour: null,
    photoLink: null,
    distanceM: id * 100,
    ...over,
  };
}

type PermissionQuery = () => Promise<{ state: string }>;

function setPermissions(query: PermissionQuery | undefined) {
  Object.defineProperty(navigator, "permissions", {
    value: query ? { query } : undefined,
    configurable: true,
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function storeArea(lat: number, lng: number, label: string) {
  localStorage.setItem(LAST_AREA_KEY, JSON.stringify({ lat, lng, label }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastQuery = () =>
  listVenuesNear.mock.calls.at(-1)?.[0] as
    | { lat: number; lng: number; radiusKm: number; amenities: string[] }
    | undefined;

function setup(
  opts: {
    search?: string;
    exchangeEnabled?: boolean;
    loadExchangeCounts?: (ids: number[]) => Promise<[number, number][]>;
  } = {},
) {
  const onUrlUpdate = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="vi"
        messages={viMessages}
        timeZone="Asia/Ho_Chi_Minh"
      >
        <NuqsTestingAdapter
          searchParams={opts.search ?? ""}
          hasMemory
          // Adapter test xoá hàng đợi URL ở MỖI lần nó render lại (hasMemory làm
          // nó render lại sau mỗi lần ghi), nên lần ghi URL kế tiếp có thể bị
          // nuốt tuỳ thời điểm. Adapter Next thật không làm vậy.
          resetUrlUpdateQueueOnMount={false}
          onUrlUpdate={onUrlUpdate}
        >
          {children}
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const r = renderHook(
    () =>
      useVenueDirectoryState({
        exchangeEnabled: opts.exchangeEnabled ?? false,
        loadExchangeCounts: opts.loadExchangeCounts,
      }),
    { wrapper },
  );
  const lastUrl = () => onUrlUpdate.mock.calls.at(-1)?.[0];
  return { ...r, onUrlUpdate, lastUrl };
}

const HN = { lat: 21.0285, lng: 105.8542 };

beforeEach(() => {
  listVenuesNear.mockReset();
  listVenuesNear.mockResolvedValue({ venues: [venue(1), venue(2)] });
  geo.reset();
  geo.request.mockReset();
  geo.request.mockImplementation(() => geo.set({ status: "asking" }));
  localStorage.clear();
  setPermissions(async () => ({ state: "prompt" }));
});

afterEach(async () => {
  // Gỡ spy TRƯỚC khi trả đồng hồ thật: spy trên setInterval giả mà gỡ sau thì
  // nó cài lại hàm giả, waitFor của các test sau không còn chạy định kỳ.
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Hàng đợi URL của nuqs dùng chung toàn cục và không bị xoá giữa các test
  // (resetUrlUpdateQueueOnMount tắt): chờ nó xả xong để lần ghi cuối của test
  // này không lọt sang test sau.
  await act(async () => {
    await sleep(20);
  });
  cleanup();
});

describe("useVenueDirectoryState: first fetch", () => {
  it("waits for the saved area and the permission answer before the first fetch", async () => {
    storeArea(16.06, 108.22, "Đà Nẵng");
    const perm = deferred<{ state: string }>();
    setPermissions(() => perm.promise);
    const { result } = setup();

    await act(async () => {
      await sleep(50);
    });
    expect(result.current.ready).toBe(false);
    expect(listVenuesNear).not.toHaveBeenCalled();
    expect(geo.request).toHaveBeenCalledTimes(1);

    await act(async () => {
      perm.resolve({ state: "prompt" });
    });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toMatchObject({ lat: 16.06, lng: 108.22, radiusKm: 5 });
    expect(result.current.ready).toBe(true);
    expect(result.current.source).toBe("stored");
    expect(result.current.areaLabel).toBe("Đà Nẵng");
    await act(async () => {
      await sleep(30);
    });
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("with geolocation granted (answered after the first render), only the GPS area is fetched and gpsWaiting is true meanwhile", async () => {
    storeArea(16.06, 108.22, "Đà Nẵng");
    const perm = deferred<{ state: string }>();
    setPermissions(() => perm.promise);
    const { result } = setup();
    expect(result.current.gpsWaiting).toBe(false);

    await act(async () => {
      perm.resolve({ state: "granted" });
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.gpsWaiting).toBe(true);
    await act(async () => {
      await sleep(700);
    });
    expect(listVenuesNear).not.toHaveBeenCalled();

    act(() => geo.set({ status: "ok", position: { lat: 10.77, lng: 106.7 } }));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toMatchObject({ lat: 10.77, lng: 106.7 });
    expect(result.current.gpsWaiting).toBe(false);
    expect(result.current.source).toBe("gps");
    expect(result.current.gps).toEqual({ lat: 10.77, lng: 106.7 });
  });

  it("permission API missing or slower than 500ms counts as not granted and fetches the fallback", async () => {
    setPermissions(undefined);
    const a = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toMatchObject(HN);
    expect(a.result.current.source).toBe("default");
    a.unmount();

    listVenuesNear.mockClear();
    setPermissions(() => Promise.reject(new Error("TypeError")));
    const b = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    b.unmount();

    // Zalo/Messenger: hỏi quyền mà không bao giờ trả lời.
    listVenuesNear.mockClear();
    setPermissions(() => new Promise(() => {}));
    const c = setup();
    await act(async () => {
      await sleep(300);
    });
    expect(listVenuesNear).not.toHaveBeenCalled();
    expect(c.result.current.ready).toBe(false);
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(lastQuery()).toMatchObject(HN);
    expect(c.result.current.gpsWaiting).toBe(false);
  });

  it("a stored area is used while GPS is denied", async () => {
    storeArea(16.06, 108.22, "Đà Nẵng");
    setPermissions(async () => ({ state: "denied" }));
    geo.request.mockImplementation(() => geo.set({ status: "denied" }));
    const { result } = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toMatchObject({ lat: 16.06, lng: 108.22 });
    expect(result.current.source).toBe("stored");
    expect(result.current.center).toEqual({ lat: 16.06, lng: 108.22 });
    expect(result.current.areaLabel).toBe("Đà Nẵng");
  });

  it("garbage params (lat=abc, lng=999, r=7, venue=-1, amenities=foo, view=list) fetch Hà Nội at 5 km", async () => {
    const { result, lastUrl } = setup({
      search: "?lat=abc&lng=999&r=7&venue=-1&amenities=foo&view=list",
    });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toEqual({ ...HN, radiusKm: 5, amenities: [] });
    expect(result.current.radius).toBe(5);
    expect(result.current.amenities).toEqual([]);
    expect(result.current.selectedId).toBeNull();
    await waitFor(() =>
      expect(lastUrl()?.searchParams.has("venue")).toBe(false),
    );
    expect(lastUrl()?.options.history).toBe("replace");
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("?lat=10.77&lng=106.70 fetches that area and GPS arriving later does not move it", async () => {
    setPermissions(async () => ({ state: "granted" }));
    const { result } = setup({ search: "?lat=10.77&lng=106.70" });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toMatchObject({ lat: 10.77, lng: 106.7 });

    act(() => geo.set({ status: "ok", position: HN }));
    await act(async () => {
      await sleep(30);
    });
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
    expect(result.current.source).toBe("url");
    expect(result.current.center).toEqual({ lat: 10.77, lng: 106.7 });
    expect(result.current.gps).toEqual(HN);
  });

  it("?lat=10&lng=114 (Trường Sa) is accepted", async () => {
    const { result } = setup({ search: "?lat=10&lng=114" });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    expect(lastQuery()).toMatchObject({ lat: 10, lng: 114 });
    expect(result.current.source).toBe("url");
  });
});

describe("useVenueDirectoryState: map and area", () => {
  it("search this area writes lat/lng, queries the map center, and a radius change keeps that center", async () => {
    const { result, lastUrl } = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));

    act(() => result.current.onMoveEnd({ lat: 21.1234567, lng: 105.9 }));
    expect(result.current.showSearchHere).toBe(true);
    expect(listVenuesNear).toHaveBeenCalledTimes(1);

    act(() => result.current.searchHere());
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    expect(lastQuery()).toMatchObject({ lat: 21.12346, lng: 105.9 });
    expect(lastUrl()?.searchParams.get("lat")).toBe("21.12346");
    expect(lastUrl()?.searchParams.get("lng")).toBe("105.9");
    expect(JSON.parse(localStorage.getItem(LAST_AREA_KEY)!)).toEqual({
      lat: 21.12346,
      lng: 105.9,
      label: "Khu vực đã chọn",
    });
    expect(result.current.showSearchHere).toBe(false);
    expect(result.current.source).toBe("url");

    act(() => result.current.setRadius(10));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(3));
    expect(lastQuery()).toMatchObject({
      lat: 21.12346,
      lng: 105.9,
      radiusKm: 10,
    });
  });

  it("changing the radius hides a stale search-this-area", async () => {
    const { result } = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    act(() => result.current.onMoveEnd({ lat: 21.2, lng: 105.9 }));
    expect(result.current.showSearchHere).toBe(true);
    act(() => result.current.setRadius(10));
    expect(result.current.showSearchHere).toBe(false);
  });

  it("placeSearched writes lat/lng, stores the area and exposes its label", async () => {
    const { result, lastUrl } = setup({ search: "?venue=1" });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));

    const label = "Quần đảo Trường Sa (Việt Nam)";
    act(() => result.current.placeSearched({ lat: 10, lng: 114 }, label));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    expect(lastQuery()).toMatchObject({ lat: 10, lng: 114 });
    expect(lastUrl()?.searchParams.get("lat")).toBe("10");
    expect(lastUrl()?.searchParams.get("lng")).toBe("114");
    expect(lastUrl()?.searchParams.has("venue")).toBe(false);
    expect(JSON.parse(localStorage.getItem(LAST_AREA_KEY)!)).toEqual({
      lat: 10,
      lng: 114,
      label,
    });
    expect(result.current.source).toBe("url");
    expect(result.current.areaLabel).toBe(label);
  });

  it("locate clears lat/lng once GPS answers; denied sets locateFailed", async () => {
    const a = setup({ search: "?lat=10.77&lng=106.70" });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    // Câu trả lời của lần hỏi lúc mở trang không tính là "định vị thất bại".
    act(() => geo.set({ status: "denied" }));
    expect(a.result.current.locateFailed).toBe(false);

    act(() => a.result.current.locate());
    expect(geo.request).toHaveBeenCalledTimes(2);
    expect(a.result.current.locating).toBe(true);
    expect(a.lastUrl()?.searchParams.has("lat") ?? true).toBe(true);
    expect(a.result.current.source).toBe("url");

    act(() => geo.set({ status: "ok", position: HN }));
    await waitFor(() => expect(a.result.current.source).toBe("gps"));
    expect(a.lastUrl()?.searchParams.has("lat")).toBe(false);
    expect(a.lastUrl()?.searchParams.has("lng")).toBe(false);
    expect(a.result.current.locating).toBe(false);
    expect(a.result.current.locateFailed).toBe(false);
    a.unmount();

    geo.reset();
    const b = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalled());
    act(() => geo.set({ status: "denied" }));
    act(() => b.result.current.locate());
    expect(b.result.current.locateFailed).toBe(false);
    act(() => geo.set({ status: "denied" }));
    expect(b.result.current.locateFailed).toBe(true);
    expect(b.result.current.locating).toBe(false);
  });

  it("onMoveEnd never calls listVenuesNear", async () => {
    const { result } = setup();
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.onMoveEnd({ lat: 21.3, lng: 105.9 });
      result.current.onMoveEnd({ lat: 20.9, lng: 106.1 });
      result.current.onMoveEnd({ lat: 10.77, lng: 106.7 });
    });
    await act(async () => {
      await sleep(50);
    });
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("no interval is scheduled", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

describe("useVenueDirectoryState: filters", () => {
  it("exchange filter narrows venues and points; while counts are pending the list is empty with exchangeFilterPending", async () => {
    const counts = deferred<[number, number][]>();
    const loadExchangeCounts = vi.fn(() => counts.promise);
    const { result } = setup({
      search: "?exchange=true",
      exchangeEnabled: true,
      loadExchangeCounts,
    });
    await waitFor(() => expect(loadExchangeCounts).toHaveBeenCalledTimes(1));
    expect(loadExchangeCounts).toHaveBeenCalledWith([1, 2]);
    expect(result.current.query.isSuccess).toBe(true);
    expect(result.current.exchangeFilterPending).toBe(true);
    expect(result.current.venues).toEqual([]);
    expect(result.current.points).toEqual([]);

    await act(async () => {
      counts.resolve([[1, 2]]);
    });
    await waitFor(() =>
      expect(result.current.exchangeFilterPending).toBe(false),
    );
    expect(result.current.venues.map((v) => v.id)).toEqual([1]);
    expect(result.current.points).toEqual([
      expect.objectContaining({ kind: "venue", id: 1, exchangeCount: 2 }),
    ]);
    expect(result.current.counts?.get(1)).toBe(2);

    act(() => result.current.setExchange(false));
    await waitFor(() => expect(result.current.venues).toHaveLength(2));
    expect(result.current.points[0]).toMatchObject({ exchangeCount: 2 });
    expect(result.current.points[1]).not.toHaveProperty("exchangeCount");
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("counts error turns the filter off and sets countsFailed", async () => {
    const loadExchangeCounts = vi
      .fn<(ids: number[]) => Promise<[number, number][]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue([[2, 1]]);
    const { result } = setup({
      search: "?exchange=true",
      exchangeEnabled: true,
      loadExchangeCounts,
    });
    await waitFor(() => expect(result.current.countsFailed).toBe(true));
    expect(result.current.exchangeFilterPending).toBe(false);
    expect(result.current.venues.map((v) => v.id)).toEqual([1, 2]);
    expect(result.current.exchange).toBe(true);

    act(() => result.current.retryCounts());
    await waitFor(() => expect(result.current.countsFailed).toBe(false));
    await waitFor(() =>
      expect(result.current.venues.map((v) => v.id)).toEqual([2]),
    );
    expect(loadExchangeCounts).toHaveBeenCalledTimes(2);
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("open-now drops closed and unknown-hours venues", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 10:00 giờ Việt Nam.
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z"));
    listVenuesNear.mockResolvedValue({
      venues: [
        venue(1, { openHours: "5:00 - 23:00" }),
        venue(2, { openHours: "17:00 - 22:00" }),
        venue(3, { openHours: null }),
        venue(4, { openHours: "Sáng 5-9" }),
      ],
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.venues).toHaveLength(4));
    act(() => result.current.setOpenNow(true));
    await waitFor(() =>
      expect(result.current.venues.map((v) => v.id)).toEqual([1]),
    );
    expect(result.current.openNow).toBe(true);
    expect(result.current.points.map((p) => p.id)).toEqual([1]);
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });
});

describe("useVenueDirectoryState: selection", () => {
  it("select pushes ?venue= and bumps focus.seq", async () => {
    const { result, lastUrl } = setup();
    await waitFor(() => expect(result.current.venues).toHaveLength(2));
    expect(result.current.focus).toBeNull();

    act(() => result.current.select(2));
    await waitFor(() => expect(result.current.selectedId).toBe(2));
    expect(lastUrl()?.searchParams.get("venue")).toBe("2");
    expect(lastUrl()?.options.history).toBe("push");
    expect(result.current.selectedVenue?.id).toBe(2);
    expect(result.current.focus).toEqual({
      lat: venue(2).lat,
      lng: venue(2).lng,
      seq: 1,
    });

    act(() => result.current.select(1));
    await waitFor(() => expect(result.current.selectedId).toBe(1));
    expect(result.current.focus).toMatchObject({ lat: venue(1).lat, seq: 2 });
    expect(result.current.openedFromLink).toBe(false);
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  // Closing used to clear ?venue= with replace, leaving the pushed entry in
  // history, so the phone Back button needed two presses to leave /venues.
  it("closing a venue selected in this session steps back over the pushed entry (one Back leaves the page)", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result, onUrlUpdate } = setup();
    await waitFor(() => expect(result.current.venues).toHaveLength(2));
    const before = onUrlUpdate.mock.calls.length;

    act(() => result.current.select(2));
    await waitFor(() => expect(result.current.selectedId).toBe(2));
    // Switching pins replaces the entry: only one pushed entry per quick view.
    act(() => result.current.select(1));
    await waitFor(() => expect(result.current.selectedId).toBe(1));
    const histories = onUrlUpdate.mock.calls
      .slice(before)
      .map((c) => c[0].options.history);
    expect(histories).toEqual(["push", "replace"]);

    const writes = onUrlUpdate.mock.calls.length;
    act(() => result.current.clearSelection());
    expect(back).toHaveBeenCalledTimes(1);
    // No second URL write: the popstate from back() is what clears ?venue=.
    expect(onUrlUpdate.mock.calls.length).toBe(writes);
    back.mockRestore();
  });

  it("closing a venue opened from a shared link clears ?venue= with replace (no entry of ours to step back over)", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { result, lastUrl } = setup({
      search: "?venue=2&lat=21.03&lng=105.85",
    });
    await waitFor(() => expect(result.current.selectedVenue?.id).toBe(2));

    act(() => result.current.clearSelection());
    await waitFor(() => expect(result.current.selectedId).toBeNull());
    expect(back).not.toHaveBeenCalled();
    expect(lastUrl()?.searchParams.has("venue")).toBe(false);
    expect(lastUrl()?.options.history).toBe("replace");
    back.mockRestore();
  });

  it("a selected venue filtered out clears ?venue=", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T03:00:00Z"));
    listVenuesNear.mockResolvedValue({
      venues: [
        venue(1, { openHours: "5:00 - 23:00" }),
        venue(2, { openHours: "17:00 - 22:00" }),
      ],
    });
    const { result, lastUrl } = setup();
    await waitFor(() => expect(result.current.venues).toHaveLength(2));
    act(() => result.current.select(2));
    await waitFor(() => expect(result.current.selectedId).toBe(2));

    act(() => result.current.setOpenNow(true));
    await waitFor(() => expect(result.current.selectedId).toBeNull());
    expect(lastUrl()?.searchParams.has("venue")).toBe(false);
    expect(lastUrl()?.options.history).toBe("replace");
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("?venue= not in the result is cleared without another server call", async () => {
    // GPS đã trả lời (từ chối): vùng dự phòng là kết quả cuối, không còn chờ
    // vùng GPS có thể chứa sân của link.
    geo.request.mockImplementation(() => geo.set({ status: "denied" }));
    const { result, lastUrl } = setup({ search: "?venue=99" });
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(lastUrl()?.searchParams.has("venue")).toBe(false),
    );
    expect(result.current.selectedId).toBeNull();
    expect(result.current.openedFromLink).toBe(false);
    expect(result.current.focus).toBeNull();
    await act(async () => {
      await sleep(30);
    });
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("a valid ?venue= in the first result sets focus and openedFromLink once", async () => {
    const { result } = setup({ search: "?venue=2" });
    await waitFor(() => expect(result.current.openedFromLink).toBe(true));
    expect(result.current.selectedId).toBe(2);
    expect(result.current.selectedVenue?.id).toBe(2);
    expect(result.current.focus).toEqual({
      lat: venue(2).lat,
      lng: venue(2).lng,
      seq: 1,
    });

    act(() => result.current.setRadius(10));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.query.isPlaceholderData).toBe(false),
    );
    expect(result.current.focus?.seq).toBe(1);
    expect(result.current.selectedId).toBe(2);
  });
  it("a linked ?venue= survives the fallback area while GPS is pending and opens once the GPS area has it", async () => {
    listVenuesNear.mockImplementation(async (q: { lat: number }) => ({
      venues:
        q.lat < 15
          ? [venue(12, { lat: 10.771, lng: 106.7 }), venue(1)]
          : [venue(1)],
    }));
    const { result, onUrlUpdate } = setup({ search: "?venue=12" });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(lastQuery()).toMatchObject(HN);
    await act(async () => {
      await sleep(30);
    });
    expect(result.current.selectedId).toBe(12);
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(result.current.openedFromLink).toBe(false);

    act(() => geo.set({ status: "ok", position: { lat: 10.77, lng: 106.7 } }));
    await waitFor(() => expect(result.current.openedFromLink).toBe(true));
    expect(result.current.selectedVenue?.id).toBe(12);
    expect(result.current.focus).toEqual({ lat: 10.771, lng: 106.7, seq: 1 });
    expect(onUrlUpdate).not.toHaveBeenCalled();
    expect(listVenuesNear).toHaveBeenCalledTimes(2);
  });

  it("a linked ?venue= missing from the fallback area is cleared once GPS is denied", async () => {
    listVenuesNear.mockResolvedValue({ venues: [venue(1)] });
    const { result, lastUrl } = setup({ search: "?venue=12" });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    await act(async () => {
      await sleep(30);
    });
    expect(result.current.selectedId).toBe(12);

    act(() => geo.set({ status: "denied" }));
    await waitFor(() => expect(result.current.selectedId).toBeNull());
    expect(lastUrl()?.searchParams.has("venue")).toBe(false);
    expect(result.current.openedFromLink).toBe(false);
    expect(listVenuesNear).toHaveBeenCalledTimes(1);
  });

  it("placeholder data from the previous area never clears ?venue=", async () => {
    const second = deferred<{ venues: DirectoryVenue[] }>();
    listVenuesNear
      .mockResolvedValueOnce({ venues: [venue(1), venue(2)] })
      .mockReturnValueOnce(second.promise);
    const { result, lastUrl } = setup();
    await waitFor(() => expect(result.current.venues).toHaveLength(2));

    act(() => result.current.setRadius(10));
    await waitFor(() => expect(listVenuesNear).toHaveBeenCalledTimes(2));
    expect(result.current.query.isPlaceholderData).toBe(true);
    act(() => result.current.select(7));
    await waitFor(() => expect(lastUrl()?.searchParams.get("venue")).toBe("7"));
    await act(async () => {
      await sleep(30);
    });
    expect(result.current.selectedId).toBe(7);
    expect(lastUrl()?.searchParams.get("venue")).toBe("7");

    await act(async () => {
      second.resolve({ venues: [venue(1), venue(7)] });
    });
    await waitFor(() => expect(result.current.selectedVenue?.id).toBe(7));
  });

  it("with the exchange chip on, a new area waits for its own counts instead of filtering by the old ones", async () => {
    listVenuesNear.mockImplementation(async (q: { radiusKm: number }) => ({
      venues: q.radiusKm === 5 ? [venue(1), venue(2)] : [venue(4), venue(5)],
    }));
    const second = deferred<[number, number][]>();
    const loadExchangeCounts = vi
      .fn<(ids: number[]) => Promise<[number, number][]>>()
      .mockResolvedValueOnce([[1, 1]])
      .mockReturnValueOnce(second.promise);
    const { result, lastUrl } = setup({
      search: "?exchange=true",
      exchangeEnabled: true,
      loadExchangeCounts,
    });
    await waitFor(() =>
      expect(result.current.venues.map((v) => v.id)).toEqual([1]),
    );

    act(() => result.current.setRadius(10));
    await waitFor(() => expect(loadExchangeCounts).toHaveBeenCalledTimes(2));
    expect(loadExchangeCounts).toHaveBeenLastCalledWith([4, 5]);
    expect(result.current.query.isPlaceholderData).toBe(false);
    expect(result.current.exchangeFilterPending).toBe(true);
    expect(result.current.venues).toEqual([]);

    act(() => result.current.select(5));
    await waitFor(() => expect(lastUrl()?.searchParams.get("venue")).toBe("5"));
    await act(async () => {
      await sleep(30);
    });
    expect(result.current.selectedId).toBe(5);

    await act(async () => {
      second.resolve([[5, 2]]);
    });
    await waitFor(() =>
      expect(result.current.exchangeFilterPending).toBe(false),
    );
    expect(result.current.venues.map((v) => v.id)).toEqual([5]);
    expect(result.current.selectedVenue?.id).toBe(5);
  });
});
