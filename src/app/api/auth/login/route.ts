import { login } from "@/lib/auth";
import { badOrigin, handle, json, jsonError, readJson, sameOrigin, tooLarge } from "@/lib/http";

export const POST = handle(async (request: Request) => {
  if (!sameOrigin(request)) return badOrigin();
  const body = await readJson(request, 10_000);
  if (!body.ok && body.reason === "too_large") return tooLarge();

  const value = (body.ok ? body.value : null) as { email?: unknown; password?: unknown } | null;
  if (
    !value ||
    typeof value.email !== "string" ||
    typeof value.password !== "string" ||
    value.email.length > 320 ||
    value.password.length > 200
  ) {
    return jsonError(401, "invalid_credentials", "Invalid email or password.");
  }
  const ok = await login(value.email, value.password);
  if (!ok) return jsonError(401, "invalid_credentials", "Invalid email or password.");
  return json({ ok: true });
});
