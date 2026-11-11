import { logout } from "@/lib/auth";
import { badOrigin, handle, sameOrigin } from "@/lib/http";

export const POST = handle(async (request: Request) => {
  if (!sameOrigin(request)) return badOrigin();
  await logout();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
