import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Bat buoc"),
  password: z.string().min(1, "Bat buoc"),
});

export const memberSchema = z.object({
  name: z.string().min(1, "Ten khong duoc de trong"),
  phone: z.string().min(10, "So dien thoai khong hop le").max(11),
});

export const courtSchema = z.object({
  name: z.string().min(1, "Ten san khong duoc de trong"),
  address: z.string().optional(),
  mapLink: z.string().url().optional().or(z.literal("")),
  pricePerSession: z.number().min(0, "Gia khong hop le"),
});

export const brandSchema = z.object({
  name: z.string().min(1, "Ten hang khong duoc de trong"),
  pricePerTube: z.number().min(0, "Gia khong hop le"),
});

export const voteSchema = z.object({
  sessionId: z.number(),
  willPlay: z.boolean(),
  willDine: z.boolean(),
  guestPlayCount: z.number().min(0).default(0),
  guestDineCount: z.number().min(0).default(0),
});

export const purchaseSchema = z.object({
  brandId: z.number(),
  tubes: z.number().min(1),
  pricePerTube: z.number().min(0),
  purchasedAt: z.string(),
  notes: z.string().optional(),
});

export const identifySchema = z.object({
  memberId: z.number(),
  phone: z.string().optional(),
});
