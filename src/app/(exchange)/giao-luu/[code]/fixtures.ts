import type { PublicExchangeEvent } from "@/lib/exchange/public-event";
import type { ViewerExtras } from "@/actions/exchange-read";

/** Dữ liệu mẫu cho test của trang buổi. Không có sđt hay email nào ở đây. */
export function makeEvent(
  over: Partial<PublicExchangeEvent> = {},
): PublicExchangeEvent {
  return {
    code: "ABCD1234",
    title: "Giao lưu tối thứ ba",
    description: "Dòng một\nDòng hai",
    startAt: "2030-01-15T12:00:00.000Z",
    endAt: "2030-01-15T14:00:00.000Z",
    status: "open",
    hidden: false,
    venue: {
      id: 5,
      name: "Sân Cầu Lông Tân Bình",
      address: "12 Cộng Hòa",
      areaLabel: "Tân Bình",
      lat: 10.8,
      lng: 106.65,
      mapLink: null,
    },
    host: { name: "Minh Host", avatarUrl: null, avatarKey: null },
    skillMin: "yeu",
    skillMax: "tb",
    slotsTotal: 10,
    femaleReservedSlots: 0,
    reserveReleaseAt: null,
    shuttleType: "Yonex AS50",
    feeMode: "fixed",
    fee: { kind: "fixed", male: 80000, female: 80000 },
    depositAmount: 0,
    registerDeadline: "2030-01-15T10:00:00.000Z",
    cancelDeadline: "2030-01-15T08:00:00.000Z",
    autoApprove: true,
    allowPlusOnes: true,
    counts: {
      approvedHeads: 4,
      pendingHeads: 0,
      waitlistHeads: 0,
      freeTotal: 6,
      freeFemaleOnly: 2,
    },
    attendeeAvatars: [{ avatarUrl: null, avatarKey: null }],
    createdAt: "2030-01-01T00:00:00.000Z",
    ...over,
  };
}

export function makeViewer(over: Partial<ViewerExtras> = {}): ViewerExtras {
  return {
    role: "guest",
    myRegistration: null,
    skillWarning: null,
    hostContact: null,
    zaloGroupLink: null,
    payout: null,
    attendees: null,
    blocked: false,
    isNewAccount: false,
    hostEventId: null,
    ...over,
  };
}

export function makeReg(
  over: Partial<NonNullable<ViewerExtras["myRegistration"]>> = {},
): NonNullable<ViewerExtras["myRegistration"]> {
  return {
    id: 12,
    status: "approved",
    maleCount: 1,
    femaleCount: 0,
    feeAmount: null,
    feeWaived: false,
    depositPaid: false,
    paid: false,
    waitlistPos: null,
    remaining: 0,
    refundDue: 0,
    ...over,
  };
}
