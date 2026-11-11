// Connectivity check: runs `SELECT 1` against DATABASE_URL.
// Run with: npm run db:check   (loads .env.local via Node's --env-file)
// Never prints the connection string or password.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("FAIL: DATABASE_URL is not set (is .env.local present?).");
  process.exit(1);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  ssl: "require",
});

try {
  const [row] = await sql`SELECT 1 AS ok`;
  console.log(`OK: SELECT 1 returned ${row.ok}`);
} catch (err) {
  // Print only non-sensitive diagnostics, never the URL or password.
  console.error("FAIL: could not run SELECT 1.");
  console.error(`  code:    ${err?.code ?? "n/a"}`);
  console.error(`  message: ${String(err?.message ?? err).replaceAll(url, "[redacted]")}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
