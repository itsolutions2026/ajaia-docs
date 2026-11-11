import { login } from "@/lib/auth";
import { badOrigin, jsonError, readJson, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return badOrigin();
  const body = (await readJson(request, 10_000)) as { email?: unknown; password?: unknown } | null;
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    body.email.length > 320 ||
    body.password.length > 200
  ) {
    return jsonError(401, "invalid_credentials", "Invalid email or password.");
  }
  const ok = await login(body.email, body.password);
  if (!ok) return jsonError(401, "invalid_credentials", "Invalid email or password.");
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
