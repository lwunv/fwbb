const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const GROUP_THREAD_ID = process.env.FB_MESSENGER_GROUP_THREAD_ID;
const GRAPH_API_VERSION = "v19.0";

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a text message to the configured Messenger group chat.
 * Non-blocking: logs errors but never throws.
 */
export async function sendGroupMessage(message: string): Promise<SendResult> {
  if (!PAGE_ACCESS_TOKEN || !GROUP_THREAD_ID) {
    console.warn(
      "[Messenger] Missing FB_PAGE_ACCESS_TOKEN or FB_MESSENGER_GROUP_THREAD_ID — skipping notification",
    );
    return { success: false, error: "Missing configuration" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${GROUP_THREAD_ID}/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: { text: message } }),
      },
    );

    const data = await res.json();

    if (!res.ok || data.error) {
      console.error(
        "[Messenger] Send failed:",
        data.error?.message ?? res.statusText,
      );
      return { success: false, error: data.error?.message ?? "Unknown error" };
    }

    return { success: true, messageId: data.message_id };
  } catch (err) {
    console.error("[Messenger] Network error:", err);
    return { success: false, error: "Network error" };
  }
}

/**
 * Build notification message for a new voting session.
 */
export function buildNewSessionMessage(
  date: string,
  courtName: string | null,
  link: string,
): string {
  const court = courtName ? ` tại ${courtName}` : "";
  return `📋 Session mới ngày ${date}${court}! Vào vote: ${link}`;
}

/**
 * Build notification message for a confirmed session.
 */
export function buildConfirmedMessage(
  date: string,
  playCount: number,
  dineCount: number,
): string {
  return `✅ Session ${date} confirmed! ${playCount} người chơi, ${dineCount} người ăn`;
}

/**
 * Build notification message for debt reminder.
 */
export function buildDebtReminderMessage(
  date: string,
  totalAmount: number,
  link: string,
): string {
  // Round UP (ceil) to align with project policy: admin should never appear
  // to be owed less than reality.
  const amountK = Math.ceil(totalAmount / 1000);
  return `💰 Session ${date} đã kết thúc. Tổng chi ${amountK}k. Xem nợ: ${link}`;
}
