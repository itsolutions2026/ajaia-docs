import { createHash, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db";

// TEMPORARY: deployment connectivity check. Remove once DB access from
// Vercel has been verified.

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function json(body: Record<string, string>, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

// Compare SHA-256 digests so the comparison is constant-time and length-safe.
function tokenMatches(provided: string, expected: string) {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const expected = process.env.DB_HEALTH_CHECK_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);

  // Fail closed: no configured token means nobody is authorized.
  if (!expected || !match || !tokenMatches(match[1], expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    await getDb().execute(sql`select 1`);
    return json({ status: "ok" }, 200);
  } catch {
    // Deliberately log nothing from the error: it could contain connection
    // details. The response is generic as well.
    console.error("db health check failed");
    return json({ status: "unavailable" }, 503);
  }
}
