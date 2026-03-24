import { clearUserCookie } from "@/lib/user-identity";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  await clearUserCookie();
  const headersList = await headers();
  const origin = headersList.get("origin") || headersList.get("referer") || "http://localhost:3000";
  const baseUrl = new URL(origin).origin;
  return NextResponse.redirect(new URL("/", baseUrl), {
    status: 303,
  });
}
