import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// libSQL/SQLite defaults foreign_keys=OFF per connection — without this every
// `.references(...)` in schema.ts is a decoration the DB never enforces. Run
// before any drizzle wrapper touches the connection.
await client.execute("PRAGMA foreign_keys=ON");

export const db = drizzle(client, { schema });
