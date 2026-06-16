/**
 * Helpers cho tính năng "đi 2 người" (partner). Người thứ 2 = 1 đầu người do
 * CHÍNH member trả (member-floor), KHÔNG phải khách. Pure — import được từ
 * Server Component lẫn client.
 */

/** Số người tối đa 1 acc đại diện (1 mình hoặc 2 mình). */
export const MAX_HEADCOUNT = 2;

interface PartnerVote {
  willPlay?: boolean | null;
  willDine?: boolean | null;
  withPartner?: boolean | null;
}

/** Số đầu CHƠI của 1 phiếu vote: 0 nếu không chơi, 2 nếu chơi + partner, 1 nếu chơi 1 mình. */
export function votePlayHeads(vote: PartnerVote): number {
  if (!vote.willPlay) return 0;
  return vote.withPartner ? 2 : 1;
}

/** Số đầu NHẬU của 1 phiếu vote. */
export function voteDineHeads(vote: PartnerVote): number {
  if (!vote.willDine) return 0;
  return vote.withPartner ? 2 : 1;
}

/**
 * Giá trị "đi 2 người" để hiển trên UI vote: nếu member đã có phiếu → theo
 * snapshot của phiếu; chưa vote → theo default của acc.
 */
export function resolveVoteWithPartner(
  vote: { withPartner?: boolean | null } | undefined,
  memberDefault: boolean,
): boolean {
  if (vote) return !!vote.withPartner;
  return memberDefault;
}
