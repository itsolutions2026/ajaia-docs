import { createDocument, listDocuments } from "@/lib/documents";
import { badOrigin, requireUser, sameOrigin, unauthenticated } from "@/lib/http";

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthenticated();
  return Response.json(await listDocuments(user.id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();
  const id = await createDocument(user.id);
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
