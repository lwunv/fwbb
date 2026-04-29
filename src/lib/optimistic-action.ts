import { toast } from "sonner";

type ActionResult = { error?: string; success?: boolean } | void;

/**
 * Fire-and-forget pattern for optimistic UI.
 *
 * Usage:
 *   1. Update local state immediately (optimistic)
 *   2. Call fireAction(() => serverAction(...), () => rollbackState())
 *   3. On error → rollback + toast
 *   4. Optionally retry once before giving up
 */
export function fireAction(
  action: () => Promise<ActionResult>,
  rollback?: () => void,
  options?: { retry?: boolean; successMsg?: string; onSuccess?: () => void },
) {
  const { retry = true, successMsg, onSuccess } = options ?? {};

  const finishOk = () => {
    onSuccess?.();
    if (successMsg) toast.success(successMsg);
  };

  action().then((result) => {
    const error = result && "error" in result ? result.error : undefined;
    if (error) {
      if (retry) {
        // Retry once
        action().then((r2) => {
          const err2 = r2 && "error" in r2 ? r2.error : undefined;
          if (err2) {
            rollback?.();
            toast.error(err2);
          } else {
            finishOk();
          }
        });
      } else {
        rollback?.();
        toast.error(error);
      }
    } else {
      finishOk();
    }
  });
}
