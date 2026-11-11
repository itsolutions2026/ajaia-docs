import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Server-only database access (Supabase Postgres via the transaction pooler).
 * Connection string comes exclusively from process.env.DATABASE_URL.
 * `prepare: false` is required by the transaction pooler.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",
  });

  return drizzle(client, { schema });
}

const globalForDb = globalThis as unknown as {
  __ajaiaDb?: ReturnType<typeof createDb>;
};

export function getDb() {
  if (!globalForDb.__ajaiaDb) {
    globalForDb.__ajaiaDb = createDb();
  }
  return globalForDb.__ajaiaDb;
}
