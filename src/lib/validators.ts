import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Bat buoc"),
  password: z.string().min(1, "Bat buoc"),
});

export const memberSchema = z.object({
  name: z.string().min(1, "Ten khong duoc de trong").max(100),
});

const moneyVnd = z
  .number()
  .int("Số tiền phải là số nguyên (VND)")
  .min(0, "Số tiền không hợp lệ")
  .max(1_000_000_000, "Số tiền vượt giới hạn");

export const courtSchema = z.object({
  name: z.string().min(1, "Ten san khong duoc de trong").max(100),
  address: z.string().max(500).optional(),
  mapLink: z.string().url().optional().or(z.literal("")),
  pricePerSession: moneyVnd,
  pricePerSessionRetail: moneyVnd.optional(),
});

export const brandSchema = z.object({
  name: z.string().min(1, "Ten hang khong duoc de trong").max(100),
  pricePerTube: moneyVnd,
});

export const voteSchema = z.object({
  sessionId: z.number().int().positive(),
  willPlay: z.boolean(),
  willDine: z.boolean(),
  guestPlayCount: z.number().int().min(0).max(20).default(0),
  guestDineCount: z.number().int().min(0).max(20).default(0),
});

export const purchaseSchema = z.object({
  brandId: z.number().int().positive(),
  tubes: z.number().int().min(1).max(10000),
  pricePerTube: moneyVnd,
  purchasedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ (YYYY-MM-DD)"),
  notes: z.string().max(500).optional(),
});

export const fundContributionSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z
    .number()
    .int()
    .min(1000, "Số tiền tối thiểu 1.000đ")
    .max(100_000_000),
  description: z.string().max(500).optional(),
});

export const fundRefundSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z
    .number()
    .int()
    .min(1000, "Số tiền tối thiểu 1.000đ")
    .max(100_000_000),
  description: z.string().max(500).optional(),
});

export const bankAccountSchema = z.object({
  bankAccountNo: z
    .string()
    .regex(/^\d{6,20}$/, "Chỉ chứa số, 6-20 ký tự")
    .or(z.literal("")),
});

export const finalizeAttendeeSchema = z.object({
  memberId: z.number().int().positive().nullable(),
  guestName: z.string().max(100).nullable().optional(),
  invitedById: z.number().int().positive().nullable(),
  isGuest: z.boolean(),
  attendsPlay: z.boolean(),
  attendsDine: z.boolean(),
});

export const finalizeSessionSchema = z.object({
  sessionId: z.number().int().positive(),
  diningBill: z
    .number()
    .int("Tiền nhậu phải là số nguyên")
    .nonnegative("Tiền nhậu không được âm")
    .max(100_000_000, "Tiền nhậu vượt giới hạn"),
  attendeeList: z.array(finalizeAttendeeSchema).max(200),
});

export const adminGuestCountSchema = z.object({
  sessionId: z.number().int().positive(),
  guestPlayCount: z.number().int().min(0).max(20),
  guestDineCount: z.number().int().min(0).max(20),
});

export const selectCourtSchema = z.object({
  sessionId: z.number().int().positive(),
  courtId: z.number().int().positive(),
  courtQuantity: z.number().int().min(1).max(20),
});

export const addShuttlecockSchema = z.object({
  sessionId: z.number().int().positive(),
  brandId: z.number().int().positive(),
  quantityUsed: z.number().int().min(1).max(1000),
});
