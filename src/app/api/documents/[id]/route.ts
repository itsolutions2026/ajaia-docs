import { getDocument, updateDocument } from "@/lib/documents";
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

export async function GET(_request: Request, { params }: Ctx) {
  const user = await requireUser();
  if (!user) return unauthenticated();
  const { id } = await params;
  const doc = await getDocument(user.id, id);
  if (!doc) return notFound();
  return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();
  const { id } = await params;

  // Size limit is independent of the document, so it can't leak existence.
  const body = await readJson(request);
  if (body === undefined) return jsonError(413, "too_large", "Request is too large.");

  // The service checks access first, then validates the body.
  const result = await updateDocument(user.id, id, body);
  if (result.ok) {
    return Response.json(
      { version: result.version, updatedAt: result.updatedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  switch (result.code) {
    case "not_found":
      return notFound();
    case "forbidden":
      return jsonError(403, "forbidden", "Only the owner can do that.");
    case "conflict":
      return jsonError(409, "version_conflict", "The document was updated by someone else.", {
        currentVersion: result.currentVersion,
      });
    default:
      return jsonError(422, "invalid", result.message);
  }
}
