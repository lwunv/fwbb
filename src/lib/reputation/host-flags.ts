// Cờ host (quyết định 34): host dựng buổi cho cùng một nhóm tài khoản chưa vào
// nhóm để các nick đó tự đẩy uy tín cho nhau. File thuần, không DB.

import {
  HOST_FLAG_MIN_CAPTIVES,
  HOST_FLAG_MIN_EVENTS,
  HOST_FLAG_SHARE_PCT,
} from "./constants";

/** Một lần điểm danh hợp lệ của `memberId` ở buổi `eventId` do `hostId` tổ chức. */
export type CaptiveRow = {
  hostId: number;
  eventId: number;
  memberId: number;
  memberApproved: boolean;
};

export type CaptiveHost = {
  hostId: number;
  /** Số "khách quen khép kín" của host. */
  captives: number;
  /** Số buổi khác nhau của host có ít nhất một khách quen khép kín điểm danh. */
  events: number;
};

/**
 * m là khách quen khép kín của h khi m chưa vào nhóm, được h điểm danh ở ít
 * nhất `HOST_FLAG_MIN_EVENTS` buổi và các buổi đó chiếm từ `HOST_FLAG_SHARE_PCT`%
 * số buổi m được điểm danh. Host có từ `HOST_FLAG_MIN_CAPTIVES` người như vậy
 * bị gắn cờ. Thành viên nhóm đã duyệt không bao giờ là ứng viên; host có mặt ở
 * buổi của chính mình cũng không. So bằng số nguyên để không lệch vì float.
 * Dòng trùng (cùng host, buổi, member) chỉ tính một lần.
 */
export function findCaptiveHosts(rows: CaptiveRow[]): CaptiveHost[] {
  // member → buổi → host; Map theo buổi nên dòng trùng tự gộp.
  const byMember = new Map<number, Map<number, number>>();
  for (const r of rows) {
    if (r.memberApproved || r.memberId === r.hostId) continue;
    let evs = byMember.get(r.memberId);
    if (!evs) byMember.set(r.memberId, (evs = new Map()));
    evs.set(r.eventId, r.hostId);
  }

  const perHost = new Map<number, { captives: number; events: Set<number> }>();
  for (const evs of byMember.values()) {
    const nAll = evs.size;
    const byHost = new Map<number, number[]>();
    for (const [eventId, hostId] of evs) {
      const list = byHost.get(hostId);
      if (list) list.push(eventId);
      else byHost.set(hostId, [eventId]);
    }
    for (const [hostId, eventIds] of byHost) {
      const nHost = eventIds.length;
      if (nHost < HOST_FLAG_MIN_EVENTS) continue;
      if (100 * nHost < HOST_FLAG_SHARE_PCT * nAll) continue;
      let acc = perHost.get(hostId);
      if (!acc) perHost.set(hostId, (acc = { captives: 0, events: new Set() }));
      acc.captives += 1;
      for (const id of eventIds) acc.events.add(id);
    }
  }

  return [...perHost]
    .filter(([, acc]) => acc.captives >= HOST_FLAG_MIN_CAPTIVES)
    .map(([hostId, acc]) => ({
      hostId,
      captives: acc.captives,
      events: acc.events.size,
    }))
    .sort((a, b) => b.captives - a.captives || a.hostId - b.hostId);
}
