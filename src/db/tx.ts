import type { db } from "@/db";

/** Transaction handle inside `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Helpers that work both inside and outside a transaction. */
export type DbOrTx = typeof db | Tx;
