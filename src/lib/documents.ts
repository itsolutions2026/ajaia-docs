import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { validateContent } from "@/lib/content/validate";
import { EMPTY_DOC } from "@/lib/content/extensions";
import { getDb } from "@/lib/db";
import { documentCollaborators, documents, users } from "@/lib/db/schema";

// Application-level authorization lives here. resolveAccess() is the security
// boundary for every document operation. RLS is enabled on the tables but is
// NOT relied upon for owner/editor permissions.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Role = "owner" | "editor";

export async function resolveAccess(userId: string, docId: string): Promise<Role | null> {
  if (!UUID_RE.test(docId)) return null;
  const [row] = await getDb()
    .select({ ownerId: documents.ownerId, collaboratorId: documentCollaborators.userId })
    .from(documents)
    .leftJoin(
      documentCollaborators,
      and(eq(documentCollaborators.documentId, documents.id), eq(documentCollaborators.userId, userId)),
    )
    .where(eq(documents.id, docId))
    .limit(1);
  if (!row) return null;
  if (row.ownerId === userId) return "owner";
  if (row.collaboratorId) return "editor";
  return null;
}

export type DocumentSummary = { id: string; title: string; updatedAt: Date; ownerName: string };

export async function listDocuments(userId: string) {
  const db = getDb();
  const owned = await db
    .select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt, ownerName: users.name })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(eq(documents.ownerId, userId))
    .orderBy(desc(documents.updatedAt));
  const shared = await db
    .select({ id: documents.id, title: documents.title, updatedAt: documents.updatedAt, ownerName: users.name })
    .from(documentCollaborators)
    .innerJoin(documents, eq(documents.id, documentCollaborators.documentId))
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(eq(documentCollaborators.userId, userId))
    .orderBy(desc(documents.updatedAt));
  return { owned: owned as DocumentSummary[], shared: shared as DocumentSummary[] };
}

export async function createDocument(
  userId: string,
  init?: { title?: string; content?: Record<string, unknown> },
) {
  const [row] = await getDb()
    .insert(documents)
    .values({
      ownerId: userId,
      title: init?.title ?? "Untitled document",
      content: init?.content ?? EMPTY_DOC,
    })
    .returning({ id: documents.id });
  return row.id;
}

export type DocumentView = {
  id: string;
  title: string;
  content: unknown;
  version: number;
  role: Role;
  ownerName: string;
  collaborators?: { id: string; name: string; email: string }[];
};

/** Returns null for unknown AND unauthorized documents (indistinguishable). */
export async function getDocument(userId: string, docId: string): Promise<DocumentView | null> {
  const role = await resolveAccess(userId, docId);
  if (!role) return null;
  const db = getDb();
  const [doc] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      version: documents.version,
      ownerName: users.name,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(eq(documents.id, docId))
    .limit(1);
  if (!doc) return null;

  const view: DocumentView = { ...doc, role };
  if (role === "owner") {
    view.collaborators = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(documentCollaborators)
      .innerJoin(users, eq(users.id, documentCollaborators.userId))
      .where(eq(documentCollaborators.documentId, docId));
  }
  return view;
}

export type UpdateResult =
  | { ok: true; version: number; updatedAt: Date }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "forbidden" }
  | { ok: false; code: "invalid"; message: string }
  | { ok: false; code: "conflict"; currentVersion: number };

/**
 * Check order: access (not_found) -> role (forbidden) -> validation (invalid)
 * -> version check (conflict). Validation never runs before access, so an
 * invalid body can't reveal whether a document exists.
 */
export async function updateDocument(
  userId: string,
  docId: string,
  body: unknown,
): Promise<UpdateResult> {
  const role = await resolveAccess(userId, docId);
  if (!role) return { ok: false, code: "not_found" };

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (b.title !== undefined && role !== "owner") return { ok: false, code: "forbidden" };

  if (!Number.isInteger(b.baseVersion) || (b.baseVersion as number) < 1) {
    return { ok: false, code: "invalid", message: "baseVersion is required." };
  }
  if (b.content === undefined && b.title === undefined) {
    return { ok: false, code: "invalid", message: "Nothing to save." };
  }

  const set: Partial<typeof documents.$inferInsert> = {};
  if (b.title !== undefined) {
    if (typeof b.title !== "string") return { ok: false, code: "invalid", message: "Invalid title." };
    const title = b.title.replace(/[\u0000-\u001f]/g, "").trim();
    if (title.length > 200) return { ok: false, code: "invalid", message: "Title is too long." };
    set.title = title || "Untitled document";
  }
  if (b.content !== undefined) {
    const checked = validateContent(b.content);
    if (!checked.ok) return { ok: false, code: "invalid", message: checked.reason };
    set.content = checked.content;
  }

  const db = getDb();
  const updated = await db
    .update(documents)
    .set({ ...set, version: sql`${documents.version} + 1`, updatedAt: new Date() })
    .where(and(eq(documents.id, docId), eq(documents.version, b.baseVersion as number)))
    .returning({ version: documents.version, updatedAt: documents.updatedAt });

  if (updated.length === 1) return { ok: true, ...updated[0] };

  // Zero rows: deleted/revoked meanwhile (not_found) or stale version (conflict).
  const stillAllowed = await resolveAccess(userId, docId);
  if (!stillAllowed) return { ok: false, code: "not_found" };
  const [current] = await db
    .select({ version: documents.version })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  return { ok: false, code: "conflict", currentVersion: current?.version ?? 0 };
}

export type ShareResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "forbidden" }
  | { ok: false; code: "self_share" | "invalid" };

/**
 * Neutral: for any well-formed email the result is { ok: true } whether or not
 * an account exists. Only the owner's collaborator list shows real membership.
 */
export async function shareDocument(
  userId: string,
  docId: string,
  email: unknown,
): Promise<ShareResult> {
  const role = await resolveAccess(userId, docId);
  if (!role) return { ok: false, code: "not_found" };
  if (role !== "owner") return { ok: false, code: "forbidden" };

  if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
    return { ok: false, code: "invalid" };
  }
  const normalized = email.trim().toLowerCase();

  const db = getDb();
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  if (target) {
    if (target.id === userId) return { ok: false, code: "self_share" };
    await db
      .insert(documentCollaborators)
      .values({ documentId: docId, userId: target.id })
      .onConflictDoNothing();
  }
  return { ok: true };
}
