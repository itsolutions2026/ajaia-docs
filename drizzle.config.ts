import { defineConfig } from "drizzle-kit";

// Migrations use MIGRATION_DATABASE_URL (session pooler, port 5432) when set;
// the app itself only ever uses DATABASE_URL (transaction pooler).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
