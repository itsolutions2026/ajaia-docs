import "server-only";

import { getSessionUser, type SessionUser } from "@/lib/auth";

export function jsonError(status: number, code: string, message: string, extra?: object) {
  return Response.json(
    { error: { code, message }, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

// Unknown, malformed and unauthorized documents all produce exactly this.
export function notFound() {
  return jsonError(404, "not_found", "Document not found.");
}

export function unauthenticated() {
  return jsonError(401, "unauthenticated", "Please sign in.");
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
export async function requireUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export async function readJson(request: Request, maxBytes = 1_200_000): Promise<unknown | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) return undefined;
  try {
    const raw = await request.text();
    if (raw.length > maxBytes) return undefined;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
