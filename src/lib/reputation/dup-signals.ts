// Gom tín hiệu nick trùng của tài khoản giao lưu (quyết định 53). Hàm thuần:
// action đọc dòng tín hiệu 30 ngày rồi gọi vào đây; client import được kiểu.
import { normalizeVietnamese } from "@/lib/utils";
import {
  DUP_BURST_MIN,
  DUP_BURST_WINDOW_MS,
  type IpSignalKind,
} from "./constants";

export type DupSignalReason = "same_name_network" | "network_burst";

export type DupSignalRow = {
  memberId: number;
  ipHash: string;
  kind: IpSignalKind;
  firstSeenAt: string;
  lastSeenAt: string;
  name: string;
  isExchange: boolean;
};

export type DupSignalGroup = {
  key: string;
  reason: DupSignalReason;
  memberIds: number[];
};

/** Một nhóm cho banner admin: chỉ trường hiển thị, không hash, IP hay email. */
export type DupSignalGroupView = {
  key: string;
  reason: DupSignalReason;
  members: {
    id: number;
    name: string;
    avatarUrl: string | null;
    avatarKey: string | null;
    isExchange: boolean;
    createdAt: string | null;
    code: string | null;
  }[];
};

/** Tên so khớp: bỏ dấu, `đ` thành `d`, chữ thường, ký tự lạ thành dấu cách. */
function foldName(s: string): string {
  return normalizeVietnamese(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/**
 * Như `findDuplicateMembers`: một người còn trong nhóm khi còn ít nhất một bạn
 * cùng nhóm chưa bị admin "Bỏ qua"; nhóm dưới 2 người thì biến mất.
 */
function dropIgnored(ids: number[], ignored: Set<string>): number[] {
  return ids.filter((a) =>
    ids.some((b) => b !== a && !ignored.has(pairKey(a, b))),
  );
}

/**
 * Hai tín hiệu ít nhiễu: cùng tên và từng chung một mạng (ít nhất một bên là
 * tài khoản giao lưu), và từ 3 tài khoản giao lưu tạo trong cùng một khung 24
 * giờ trên một mạng. Chỉ "chung mạng" thì không tính: nhà mạng di động và wifi
 * ở sân cho nhiều người thật chung IP. Nhóm mới hoạt động gần nhất đứng trước.
 */
export function findDupSignalGroups(
  rows: DupSignalRow[],
  ignored: Set<string>,
): DupSignalGroup[] {
  const lastSeen = new Map<number, string>();
  const isExchange = new Map<number, boolean>();
  for (const r of rows) {
    isExchange.set(r.memberId, r.isExchange);
    const prev = lastSeen.get(r.memberId);
    if (!prev || r.lastSeenAt > prev) lastSeen.set(r.memberId, r.lastSeenAt);
  }

  const found = new Map<string, DupSignalGroup>();
  const add = (reason: DupSignalReason, ids: number[]) => {
    const kept = dropIgnored(ids, ignored).sort((a, b) => a - b);
    if (kept.length < 2) return;
    const key = `${reason}:${kept.join("-")}`;
    if (!found.has(key)) found.set(key, { key, reason, memberIds: kept });
  };

  // Cùng tên + chung mạng: cạnh giữa hai người cùng tên từng thấy trên cùng
  // một hash, rồi gom thành phần liên thông (union-find).
  const byNetName = new Map<string, Set<number>>();
  for (const r of rows) {
    const k = `${r.ipHash}\u0000${foldName(r.name)}`;
    const set = byNetName.get(k) ?? new Set<number>();
    set.add(r.memberId);
    byNetName.set(k, set);
  }
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  for (const set of byNetName.values()) {
    const ids = [...set];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i], ids[j]];
        if (!isExchange.get(a) && !isExchange.get(b)) continue;
        if (ignored.has(pairKey(a, b))) continue;
        parent.set(find(a), find(b));
      }
    }
  }
  const components = new Map<number, number[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    components.set(root, [...(components.get(root) ?? []), id]);
  }
  for (const ids of components.values()) add("same_name_network", ids);

  // Dồn tạo tài khoản: theo từng mạng, hai con trỏ trên mốc tạo đã sắp; các
  // khung 24 giờ có từ 3 tài khoản mà chồng lên nhau thì gộp làm một nhóm.
  const signups = new Map<string, { id: number; t: number }[]>();
  for (const r of rows) {
    if (r.kind !== "signup" || !r.isExchange) continue;
    const list = signups.get(r.ipHash) ?? [];
    list.push({ id: r.memberId, t: Date.parse(r.firstSeenAt) });
    signups.set(r.ipHash, list);
  }
  for (const list of signups.values()) {
    list.sort((a, b) => a.t - b.t || a.id - b.id);
    let left = 0;
    let cluster: { from: number; to: number } | null = null;
    const flush = () => {
      if (cluster)
        add(
          "network_burst",
          list.slice(cluster.from, cluster.to + 1).map((s) => s.id),
        );
    };
    for (let right = 0; right < list.length; right++) {
      while (list[right].t - list[left].t > DUP_BURST_WINDOW_MS) left++;
      if (right - left + 1 < DUP_BURST_MIN) continue;
      if (cluster && left <= cluster.to) cluster.to = right;
      else {
        flush();
        cluster = { from: left, to: right };
      }
    }
    flush();
  }

  const recency = (g: DupSignalGroup) =>
    g.memberIds.reduce((max, id) => {
      const s = lastSeen.get(id) ?? "";
      return s > max ? s : max;
    }, "");
  return [...found.values()].sort((a, b) => {
    const ra = recency(a);
    const rb = recency(b);
    if (ra !== rb) return ra < rb ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
