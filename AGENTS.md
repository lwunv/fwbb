<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Optimistic UI (project-wide)

For interactive flows that call a server action or API and update visible UI (lists, counters, badges, form state):

1. **Update the UI immediately** on the client when the user acts (toggle, submit, stepper, etc.).
2. **Persist in the background**; on success, rely on `revalidatePath` / refetch to converge with the server.
3. **On failure**, roll back both local control state and any mirrored global UI (e.g. shared lists), and show a clear error.
4. **Client hooks** that mirror server props (e.g. `VoteButtons`) should **`useEffect`-sync** when props change so post-refresh and rollback stay consistent.
5. Put reusable merge/rollback helpers in **`src/lib/`** (not in `"use client"` files) so Server Components can import counts/utils without crossing the client boundary.

Reference: vote flow uses `SessionVoteOptimisticPanel` + `optimisticListSync` on `VoteButtons` and `applyMemberVotePatch` in `src/lib/optimistic-votes.ts`.
