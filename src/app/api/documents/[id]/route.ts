import { getDocument, updateDocument } from "@/lib/documents";
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

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser();
  if (!user) return unauthenticated();
  const { id } = await params;
  const doc = await getDocument(user.id, id);
  if (!doc) return notFound();
  return json(doc);
});

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();
  const { id } = await params;

  // Size limit is independent of the document, so it can't leak existence.
  const body = await readJson(request);
  if (!body.ok && body.reason === "too_large") return tooLarge();

  // Invalid JSON is passed on as null: the service checks access first, so a
  // malformed body on an inaccessible document still returns not-found.
  const result = await updateDocument(user.id, id, body.ok ? body.value : null);
  if (result.ok) return json({ version: result.version, updatedAt: result.updatedAt });

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
});
