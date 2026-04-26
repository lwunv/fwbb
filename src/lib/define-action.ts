import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import { getUserFromCookie } from "./user-identity";

export type ActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: string };

interface DefineAdminActionOptions<S extends z.ZodTypeAny> {
  schema?: S;
  /** Paths to revalidate on success */
  paths?: readonly string[] | ((data: z.infer<S>) => readonly string[]);
}

/**
 * Wraps an admin server action with the shared boilerplate:
 * - requireAdmin auth check
 * - Zod parse (if schema provided)
 * - revalidatePath on success
 *
 * The wrapped function receives `{ data, admin }` instead of raw inputs, where
 * `data` is the parsed schema output. Callers still pass raw input (object).
 *
 * Errors short-circuit and surface as `{ error: string }` to the client.
 */
export function defineAdminAction<S extends z.ZodTypeAny, TResult = void>(
  options: DefineAdminActionOptions<S>,
  fn: (ctx: {
    data: z.infer<S>;
    admin: { sub?: string; role?: string } & Record<string, unknown>;
  }) => Promise<ActionResult<TResult>>,
) {
  return async (input: unknown): Promise<ActionResult<TResult>> => {
    const auth = await requireAdmin();
    if ("error" in auth) return { error: auth.error ?? "Không có quyền" };

    let data: z.infer<S>;
    if (options.schema) {
      const parsed = options.schema.safeParse(input);
      if (!parsed.success) {
        return {
          error:
            "Dữ liệu không hợp lệ: " +
            (parsed.error.issues[0]?.message ?? "không rõ"),
        };
      }
      data = parsed.data;
    } else {
      data = input as z.infer<S>;
    }

    const result = await fn({ data, admin: auth.admin as never });

    if ("success" in result && options.paths) {
      const paths =
        typeof options.paths === "function"
          ? options.paths(data)
          : options.paths;
      for (const p of paths) revalidatePath(p);
    }

    return result;
  };
}

interface DefineMemberActionOptions<S extends z.ZodTypeAny> {
  schema?: S;
  paths?: readonly string[] | ((data: z.infer<S>) => readonly string[]);
}

/** Wraps a member-self server action: requires logged-in member cookie. */
export function defineMemberAction<S extends z.ZodTypeAny, TResult = void>(
  options: DefineMemberActionOptions<S>,
  fn: (ctx: {
    data: z.infer<S>;
    user: { memberId: number; facebookId: string };
  }) => Promise<ActionResult<TResult>>,
) {
  return async (input: unknown): Promise<ActionResult<TResult>> => {
    const user = await getUserFromCookie();
    if (!user) return { error: "Vui lòng xác nhận danh tính trước" };

    let data: z.infer<S>;
    if (options.schema) {
      const parsed = options.schema.safeParse(input);
      if (!parsed.success) {
        return {
          error:
            "Dữ liệu không hợp lệ: " +
            (parsed.error.issues[0]?.message ?? "không rõ"),
        };
      }
      data = parsed.data;
    } else {
      data = input as z.infer<S>;
    }

    const result = await fn({ data, user });

    if ("success" in result && options.paths) {
      const paths =
        typeof options.paths === "function"
          ? options.paths(data)
          : options.paths;
      for (const p of paths) revalidatePath(p);
    }

    return result;
  };
}
