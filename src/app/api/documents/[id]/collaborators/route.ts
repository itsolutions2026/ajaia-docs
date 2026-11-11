import { shareDocument } from "@/lib/documents";
import {
  badOrigin,
  handle,
  json,
  jsonError,
  notFound,
  readJson,
  requireUser,
  sameOrigin,
  tooLarge,
  unauthenticated,
} from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (request: Request, { params }: Ctx) => {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();
  const { id } = await params;

  const body = await readJson(request, 10_000);
  if (!body.ok && body.reason === "too_large") return tooLarge();
  const email = body.ok ? (body.value as { email?: unknown } | null)?.email : undefined;

  const result = await shareDocument(user.id, id, email);
  if (result.ok) {
    // Identical for known and unknown emails (no account-existence leak).
    return json({
      message: "If an account exists for that email, it now has access. Check the collaborator list.",
    });
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
});
