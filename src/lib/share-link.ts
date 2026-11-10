export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

function legacyCopy(text: string): boolean {
  try {
    const input = document.createElement("input");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Chia sẻ link bằng Web Share nếu có, không thì chép vào clipboard. Trình duyệt
 * nhúng Zalo/Messenger thường thiếu cả hai nên còn đường lùi execCommand.
 */
export async function shareOrCopy(i: {
  title: string;
  url: string;
}): Promise<ShareResult> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ title: i.title, url: i.url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return "cancelled";
      }
      // Lỗi khác (không được phép, không hỗ trợ dữ liệu): thử chép link.
    }
  }
  try {
    await navigator.clipboard.writeText(i.url);
    return "copied";
  } catch {
    // Clipboard API bị chặn hoặc không có: lùi sang execCommand.
  }
  return legacyCopy(i.url) ? "copied" : "failed";
}
