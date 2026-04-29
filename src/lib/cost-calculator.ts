import { roundToThousand } from "./utils";

export interface AttendeeInput {
  memberId: number | null;
  guestName?: string | null;
  invitedById: number | null;
  isGuest: boolean;
  attendsPlay: boolean;
  attendsDine: boolean;
}

export interface ShuttlecockInput {
  quantityUsed: number; // in qua (individual shuttlecocks)
  pricePerTube: number; // snapshot price per tube (12 qua)
}

export interface SessionInput {
  courtPrice: number;
  diningBill: number;
}

export interface MemberDebt {
  memberId: number;
  playAmount: number;
  dineAmount: number;
  guestPlayAmount: number;
  guestDineAmount: number;
  totalAmount: number;
}

export interface CostBreakdown {
  courtPrice: number;
  totalShuttlecockCost: number;
  totalPlayCost: number;
  diningBill: number;
  totalPlayers: number;
  totalDiners: number;
  playCostPerHead: number;
  dineCostPerHead: number;
  memberDebts: MemberDebt[];
}

/**
 * Calculate cost of shuttlecocks based on quantity and price per tube (12 pieces).
 * Rounded UP to nearest 1000 VND to avoid admin loss if needed,
 * but since we sum first, we'll return the exact float,
 * and round at the very end or where needed.
 * Actually, to be perfectly safe, we should round up the total shuttlecock cost per session.
 */
export function calculateShuttlecockCost(
  quantityUsed: number,
  pricePerTube: number,
): number {
  return roundToThousand((quantityUsed * pricePerTube) / 12);
}

export function calculateExactShuttlecockCost(
  quantityUsed: number,
  pricePerTube: number,
): number {
  return (quantityUsed * pricePerTube) / 12;
}

/**
 * Pure per-head cost helper. Same rounding rules as `calculateSessionCosts`
 * (round UP to next 1k via `roundToThousand`), but exposes only the two
 * per-head numbers — useful for UI summaries where we already know totals
 * and just need to display "ai trả bao nhiêu một suất".
 *
 * Returns `0` when the divisor is 0 to avoid `Infinity` / `NaN` propagating
 * into UI.
 */
export function computePerHeadCharges(input: {
  courtPrice: number;
  shuttlecockCost: number;
  diningBill: number;
  playerCount: number;
  dinerCount: number;
}): { playCostPerHead: number; dineCostPerHead: number } {
  const playCostPerHead =
    input.playerCount > 0
      ? roundToThousand(
          (input.courtPrice + input.shuttlecockCost) / input.playerCount,
        )
      : 0;
  const dineCostPerHead =
    input.dinerCount > 0
      ? roundToThousand(input.diningBill / input.dinerCount)
      : 0;
  return { playCostPerHead, dineCostPerHead };
}

/**
 * Pure cost calculation function.
 *
 * Algorithm (from spec 5.5):
 * 1. Count all players (members + guests) and diners (members + guests)
 * 2. play_cost_per_head = (court_price + total_shuttlecock_cost) / total_players
 * 3. dine_cost_per_head = dining_bill / total_diners
 * 4. Round per-head costs up to the next 1000 VND
 * 5. For each member: own play + own dine + (guests_play * play_cost) + (guests_dine * dine_cost)
 *
 * Shuttlecock cost = SUM(quantity_used * price_per_tube / 12) per brand
 */
export function calculateSessionCosts(
  session: SessionInput,
  attendees: AttendeeInput[],
  shuttlecocks: ShuttlecockInput[],
): CostBreakdown {
  // 1. Separate players and diners (all, including guests)
  const allPlayers = attendees.filter((a) => a.attendsPlay);
  const allDiners = attendees.filter((a) => a.attendsDine);

  const totalPlayers = allPlayers.length;
  const totalDiners = allDiners.length;

  // 2. Calculate shuttlecock cost: each qua costs price_per_tube / 12
  const totalShuttlecockCostExact = shuttlecocks.reduce((sum, s) => {
    return sum + calculateExactShuttlecockCost(s.quantityUsed, s.pricePerTube);
  }, 0);
  const totalShuttlecockCost = roundToThousand(totalShuttlecockCostExact);

  // 3. Calculate per-head costs
  const totalPlayCost = session.courtPrice + totalShuttlecockCost;
  const rawPlayCostPerHead =
    totalPlayers > 0 ? totalPlayCost / totalPlayers : 0;
  const rawDineCostPerHead =
    totalDiners > 0 ? session.diningBill / totalDiners : 0;

  // 4. Round up to the next 1000 VND so the admin is not underpaid.
  const playCostPerHead = roundToThousand(rawPlayCostPerHead);
  const dineCostPerHead = roundToThousand(rawDineCostPerHead);

  // 5. Calculate per-member debts
  // Get unique members (non-guests only)
  const memberIds = new Set<number>();
  for (const a of attendees) {
    if (!a.isGuest && a.memberId !== null) {
      memberIds.add(a.memberId);
    }
  }

  const memberDebts: MemberDebt[] = [];

  for (const memberId of memberIds) {
    // Does this member play? (not as a guest)
    const memberPlays = attendees.some(
      (a) => a.memberId === memberId && !a.isGuest && a.attendsPlay,
    );
    // Does this member dine? (not as a guest)
    const memberDines = attendees.some(
      (a) => a.memberId === memberId && !a.isGuest && a.attendsDine,
    );

    // Count guests invited by this member
    const guestsPlay = attendees.filter(
      (a) => a.isGuest && a.invitedById === memberId && a.attendsPlay,
    ).length;
    const guestsDine = attendees.filter(
      (a) => a.isGuest && a.invitedById === memberId && a.attendsDine,
    ).length;

    const playAmount = memberPlays ? playCostPerHead : 0;
    const dineAmount = memberDines ? dineCostPerHead : 0;
    const guestPlayAmount = guestsPlay * playCostPerHead;
    const guestDineAmount = guestsDine * dineCostPerHead;
    const totalAmount =
      playAmount + dineAmount + guestPlayAmount + guestDineAmount;

    if (totalAmount > 0) {
      memberDebts.push({
        memberId,
        playAmount,
        dineAmount,
        guestPlayAmount,
        guestDineAmount,
        totalAmount,
      });
    }
  }

  return {
    courtPrice: session.courtPrice,
    totalShuttlecockCost,
    totalPlayCost,
    diningBill: session.diningBill,
    totalPlayers,
    totalDiners,
    playCostPerHead,
    dineCostPerHead,
    memberDebts,
  };
}
