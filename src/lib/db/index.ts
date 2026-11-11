import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Server-only database access (Supabase Postgres via the transaction pooler).
 *
 * - Connection string comes exclusively from process.env.DATABASE_URL.
 * - `prepare: false` is required by the Supabase transaction pooler.
 * - `max: 1` keeps each serverless instance to a single connection.
 * - Created lazily, so importing this module never fails a build that does
 *   not touch the database.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",
  });

  return drizzle(client);
}

// Reuse one instance across hot reloads in development.
const globalForDb = globalThis as unknown as {
  __ajaiaDb?: ReturnType<typeof createDb>;
};

export function getDb() {
  if (!globalForDb.__ajaiaDb) {
    globalForDb.__ajaiaDb = createDb();
  }
  return globalForDb.__ajaiaDb;
}
