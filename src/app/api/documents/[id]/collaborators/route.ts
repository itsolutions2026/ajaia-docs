import { shareDocument } from "@/lib/documents";
import {
  badOrigin,
  jsonError,
  notFound,
  readJson,
  requireUser,
  sameOrigin,
  unauthenticated,
} from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();
  const { id } = await params;

  const body = (await readJson(request, 10_000)) as { email?: unknown } | null | undefined;
  const result = await shareDocument(user.id, id, body?.email);

  if (result.ok) {
    // Identical for known and unknown emails (no account-existence leak).
    return Response.json(
      { message: "If an account exists for that email, it now has access. Check the collaborator list." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  switch (result.code) {
    case "not_found":
      return notFound();
    case "forbidden":
      return jsonError(403, "forbidden", "Only the owner can share this document.");
    case "self_share":
      return jsonError(422, "self_share", "You already own this document.");
    default:
      return jsonError(422, "invalid", "Enter a valid email address.");
  }
}
