import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scheduledJobs } from "@/db/schema";
import { isNotificationsEnabled } from "@/lib/notifications/gate";
import { runJob } from "@/lib/notifications/jobs";
import { verifyQstashRequest } from "@/lib/notifications/qstash";

function parseBody(raw: string): { jobKey: string; runAt: string } | null {
  try {
    const body: unknown = JSON.parse(raw);
    if (
      typeof body === "object" &&
      body !== null &&
      "jobKey" in body &&
      "runAt" in body &&
      typeof body.jobKey === "string" &&
      typeof body.runAt === "string"
    ) {
      return { jobKey: body.jobKey, runAt: body.runAt };
    }
  } catch {
    // Body hỏng: xử lý như không hợp lệ ở dưới.
  }
  return null;
}

/**
 * QStash gọi lại đúng giờ của một job đã hẹn. Kiểm chữ ký trên body thô TRƯỚC
 * mọi truy cập DB. Message của lần hẹn trước (job đã chạy, đã huỷ, hoặc lệch
 * `runAt`) là noop 200. Lỗi khi chạy → 500 để QStash thử lại; an toàn vì tin
 * có khoá chống lặp.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text();
  const ok = await verifyQstashRequest(
    raw,
    request.headers.get("upstash-signature"),
  );
  if (!ok) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let kind: string | undefined;
  try {
    if (!(await isNotificationsEnabled(db))) {
      return NextResponse.json({ skipped: "disabled" });
    }
    const [job] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.jobKey, body.jobKey))
      .limit(1);
    if (!job || job.status !== "scheduled" || job.runAt !== body.runAt) {
      return NextResponse.json({ skipped: "stale" });
    }
    kind = job.kind;

    const now = new Date();
    const outcome = await runJob(db, job, now);
    await db
      .update(scheduledJobs)
      .set({ status: outcome, updatedAt: now.toISOString() })
      .where(
        and(
          eq(scheduledJobs.id, job.id),
          eq(scheduledJobs.status, "scheduled"),
        ),
      );
    return NextResponse.json({ status: outcome });
  } catch {
    console.error("[Notify] job_failed", { kind });
    return NextResponse.json({ error: "job_failed" }, { status: 500 });
  }
}
