import { createDocument, listDocuments } from "@/lib/documents";
import { badOrigin, handle, json, requireUser, sameOrigin, unauthenticated } from "@/lib/http";

export const GET = handle(async () => {
  const user = await requireUser();
  if (!user) return unauthenticated();
  return json(await listDocuments(user.id));
});

export const POST = handle(async (request: Request) => {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();
  const id = await createDocument(user.id);
  return json({ id }, 201);
});
