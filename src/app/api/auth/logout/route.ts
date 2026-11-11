import { logout } from "@/lib/auth";
import { badOrigin, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return badOrigin();
  await logout();
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
