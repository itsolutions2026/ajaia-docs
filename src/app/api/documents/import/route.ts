import { importFile, MAX_IMPORT_BYTES } from "@/lib/content/import";
import { createDocument } from "@/lib/documents";
import { badOrigin, jsonError, requireUser, sameOrigin, unauthenticated } from "@/lib/http";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return badOrigin();
  const user = await requireUser();
  if (!user) return unauthenticated();

  // Reject oversized uploads before buffering them.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES + 64 * 1024) {
    return jsonError(413, "too_large", "File is too large (maximum 1 MB).");
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError(422, "invalid", "Upload a file.");
  }
  if (!(file instanceof File)) return jsonError(422, "invalid", "Upload a file.");

  const result = importFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) {
    const code = result.status === 413 ? "too_large" : result.status === 415 ? "unsupported" : "invalid";
    return jsonError(result.status, code, result.message);
  }

  const id = await createDocument(user.id, { title: result.title, content: result.content });
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
