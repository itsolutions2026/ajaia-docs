import "server-only";

import { getSessionUser, type SessionUser } from "@/lib/auth";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export function jsonError(status: number, code: string, message: string, extra?: object) {
  return json({ error: { code, message }, ...extra }, status);
}

// Unknown, malformed and unauthorized documents all produce exactly this.
export function notFound() {
  return jsonError(404, "not_found", "Document not found.");
}

export function unauthenticated() {
  return jsonError(401, "unauthenticated", "Please sign in.");
}

export function tooLarge(message = "Request is too large.") {
  return jsonError(413, "too_large", message);
}

/** CSRF defense for state-changing requests: require a same-origin Origin. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function badOrigin() {
  return jsonError(403, "bad_origin", "Cross-origin request rejected.");
}

/** Session identity comes from the server-side cookie only. */
export function requireUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid" };

/** Reads a JSON body with a size cap. Never throws. */
export async function readJson(request: Request, maxBytes = 1_200_000): Promise<JsonBody> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) return { ok: false, reason: "too_large" };
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { ok: false, reason: "too_large" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Wraps a route handler so unexpected failures (database unavailable, etc.)
 * return the standard JSON error envelope instead of a framework 500. Only the
 * error code is logged; messages may contain connection details.
 */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      console.error(`api error: ${typeof code === "string" ? code : "unknown"}`);
      return jsonError(503, "unavailable", "Service temporarily unavailable. Try again shortly.");
    }
  };
}
