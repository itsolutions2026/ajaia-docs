import { defineConfig } from "drizzle-kit";

// Schema file does not exist yet; it is created in a later step.
// Migration commands will need a session-pooler/direct URL (not the
// transaction pooler); that is configured when migrations are introduced.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
