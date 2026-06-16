import { votePlayHeads, voteDineHeads } from "./partner-core";

/** Số người đã vote tham gia ít nhất một hoạt động (cầu hoặc nhậu) — khớp danh sách hiển thị công khai */
export function attendingVotesCount(
  votes: { willPlay?: boolean | null; willDine?: boolean | null }[],
): number {
  return votes.filter((v) => !!(v.willPlay || v.willDine)).length;
}

/** Vote tối thiểu cần để đếm tham gia chơi/nhậu (member + khách). */
export interface ParticipationVote {
  willPlay?: boolean | null;
  willDine?: boolean | null;
  guestPlayCount?: number | null;
  guestDineCount?: number | null;
  withPartner?: boolean | null;
}

export interface VoteParticipation {
  /** Số ĐẦU member chơi (gồm người đi cùng) — head count, KHỚP divisor. */
  memberPlay: number;
  memberDine: number;
  /** Số người-đi-cùng chơi (Σ withPartner && willPlay). */
  partnerPlay: number;
  partnerDine: number;
  /** Tổng khách chơi. */
  guestPlay: number;
  /** Tổng khách nhậu. */
  guestDine: number;
  /** memberPlay + guestPlay — divisor chia tiền sân (khớp `calculateSessionCosts.totalPlayers`). */
  totalPlayers: number;
  /** memberDine + guestDine — divisor chia tiền nhậu (khớp `totalDiners`). */
  totalDiners: number;
}

/**
 * Đếm tham gia của 1 danh sách vote: member chơi/nhậu + tổng khách chơi/nhậu.
 * SINGLE SOURCE cho mọi chỗ hiển "N người (gồm K khách)" và cho divisor chia
 * tiền — phải khớp `calculateSessionCosts` (totalPlayers/totalDiners), nếu lệch
 * thì per-head money sai. Thay thế các reduce hand-roll rải rác ở session-card,
 * week-sessions-view, admin-vote-manager, session-list, sessions.ts.
 *
 * LƯU Ý: khách của admin lưu RIÊNG ở `session.adminGuestPlayCount`, KHÔNG nằm
 * trong vote rows → tổng ở đây là khách của MEMBER. Caller cần gộp khách admin
 * thì cộng thêm ngoài hàm này.
 */
export function countVoteParticipation(
  votes: ReadonlyArray<ParticipationVote>,
): VoteParticipation {
  let memberPlay = 0;
  let memberDine = 0;
  let partnerPlay = 0;
  let partnerDine = 0;
  let guestPlay = 0;
  let guestDine = 0;
  for (const v of votes) {
    memberPlay += votePlayHeads(v); // 0|1|2 (gồm partner)
    memberDine += voteDineHeads(v);
    if (v.willPlay && v.withPartner) partnerPlay++;
    if (v.willDine && v.withPartner) partnerDine++;
    guestPlay += v.guestPlayCount ?? 0;
    guestDine += v.guestDineCount ?? 0;
  }
  return {
    memberPlay,
    memberDine,
    partnerPlay,
    partnerDine,
    guestPlay,
    guestDine,
    totalPlayers: memberPlay + guestPlay,
    totalDiners: memberDine + guestDine,
  };
}

/** Vote kèm host id — cần để loại admin / member được miễn khỏi floor.
 *  `willPlay` không được dùng (xem hàm) nhưng cho phép truyền nguyên vote row. */
export interface HostGuestVote {
  member: { id: number };
  guestPlayCount?: number | null;
  willPlay?: boolean | null;
}

/**
 * Số khách CHƠI sẽ bị floor 60K khi `finalizeSession` chạy = Σ `guestPlayCount`
 * của host KHÔNG phải admin VÀ KHÔNG được miễn.
 *
 * Vì sao phải loại admin & exempt: ở `finance.ts` finalize, debt của admin
 * `return d` (bỏ qua `applyMinDeductionFloor`) và debt member được miễn cũng
 * skip → khách của họ KHÔNG bao giờ bị floor. Forecast "Tổng thu dự kiến" phải
 * dùng đúng tập này (`computePredictedMinDeductionSurplus.guestPlayCount`),
 * nếu không 2 màn admin sẽ lệch nhau và lệch debt thật.
 *
 * KHÔNG filter `willPlay`: `calculateSessionCosts` đếm khách theo `invitedById`
 * bất kể host có chơi hay không, nên host không-chơi vẫn có khách bị floor.
 */
export function floorableGuestPlayCount(
  votes: ReadonlyArray<HostGuestVote>,
  opts: {
    adminMemberId: number | null;
    exemptMemberIds: ReadonlyArray<number>;
  },
): number {
  const exempt = new Set(opts.exemptMemberIds);
  return votes.reduce((sum, v) => {
    if (v.member.id === opts.adminMemberId) return sum;
    if (exempt.has(v.member.id)) return sum;
    return sum + (v.guestPlayCount ?? 0);
  }, 0);
}
