// Database integration tests. They run ONLY when ALLOW_DB_TESTS=1 is set.
//
// Safety: tests create their own users on the reserved @test.invalid domain and
// only ever touch documents owned by those users. Seeded demo users/documents
// are never read as actors or modified; a fingerprint of the demo documents is
// compared before and after the run. Cleanup deletes only rows created here.
import { randomUUID } from "node:crypto";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { documentCollaborators, documents, users } from "@/lib/db/schema";
import {
  createDocument,
  getDocument,
  resolveAccess,
  shareDocument,
  updateDocument,
} from "@/lib/documents";

const enabled = process.env.ALLOW_DB_TESTS === "1";
const TEST_DOMAIN = "@test.invalid";
const DEMO_DOMAIN = "@demo.ajaia.example";
const run = randomUUID().slice(0, 8);

const CONTENT = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
};

async function demoFingerprint() {
  const [row] = await getDb()
    .select({
      n: sql<number>`count(*)::int`,
      v: sql<number>`coalesce(sum(${documents.version}),0)::int`,
      t: sql<string>`coalesce(max(${documents.updatedAt})::text,'')`,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.ownerId))
    .where(like(users.email, `%${DEMO_DOMAIN}`));
  return row;
}

describe.skipIf(!enabled)("documents (database)", () => {
  const ids: Record<"owner" | "editor" | "outsider", string> = { owner: "", editor: "", outsider: "" };
  const createdUsers: string[] = [];
  let before: Awaited<ReturnType<typeof demoFingerprint>>;

  async function makeUser(label: string) {
    const [u] = await getDb()
      .insert(users)
      .values({ email: `${run}-${label}${TEST_DOMAIN}`, name: `Test ${label}`, passwordHash: "x" })
      .returning({ id: users.id });
    createdUsers.push(u.id);
    return u.id;
  }

  beforeAll(async () => {
    before = await demoFingerprint();
    ids.owner = await makeUser("owner");
    ids.editor = await makeUser("editor");
    ids.outsider = await makeUser("outsider");
  });

  afterAll(async () => {
    // Deletes only users this run created (cascades to their documents).
    if (createdUsers.length) {
      await getDb()
        .delete(users)
        .where(and(inArray(users.id, createdUsers), like(users.email, `%${TEST_DOMAIN}`)));
    }
    const after = await demoFingerprint();
    expect(after).toEqual(before); // demo documents untouched
  });

  async function newSharedDoc() {
    const id = await createDocument(ids.owner);
    await getDb().insert(documentCollaborators).values({ documentId: id, userId: ids.editor });
    return id;
  }

  it("authorizes owner and editor, and hides the document from others", async () => {
    const id = await newSharedDoc();
    expect(await resolveAccess(ids.owner, id)).toBe("owner");
    expect(await resolveAccess(ids.editor, id)).toBe("editor");
    expect(await resolveAccess(ids.outsider, id)).toBeNull();

    // Unauthorized, unknown and malformed ids are indistinguishable.
    expect(await getDocument(ids.outsider, id)).toBeNull();
    expect(await getDocument(ids.outsider, randomUUID())).toBeNull();
    expect(await getDocument(ids.outsider, "not-a-uuid")).toBeNull();
    expect((await getDocument(ids.owner, id))?.collaborators).toHaveLength(1);
    expect((await getDocument(ids.editor, id))?.collaborators).toBeUndefined();
  });

  it("checks access before validating the body (no existence leak)", async () => {
    const id = await newSharedDoc();
    const a = await updateDocument(ids.outsider, id, { nonsense: true });
    const b = await updateDocument(ids.outsider, randomUUID(), { nonsense: true });
    expect(a).toEqual({ ok: false, code: "not_found" });
    expect(b).toEqual(a);
  });

  it("lets editors change content but not the title", async () => {
    const id = await newSharedDoc();
    expect(await updateDocument(ids.editor, id, { baseVersion: 1, title: "hack" })).toEqual({
      ok: false,
      code: "forbidden",
    });
    const ok = await updateDocument(ids.editor, id, { baseVersion: 1, content: CONTENT });
    expect(ok).toMatchObject({ ok: true, version: 2 });
    const renamed = await updateDocument(ids.owner, id, { baseVersion: 2, title: "Plan" });
    expect(renamed).toMatchObject({ ok: true, version: 3 });
    expect((await getDocument(ids.owner, id))?.title).toBe("Plan");
  });

  it("rejects stale versions and never overwrites newer content", async () => {
    const id = await createDocument(ids.owner);
    expect(await updateDocument(ids.owner, id, { baseVersion: 1, content: CONTENT })).toMatchObject({ ok: true, version: 2 });
    const stale = await updateDocument(ids.owner, id, {
      baseVersion: 1,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "STALE" }] }] },
    });
    expect(stale).toEqual({ ok: false, code: "conflict", currentVersion: 2 });
    expect(JSON.stringify((await getDocument(ids.owner, id))?.content)).not.toContain("STALE");
  });

  it("allows exactly one of two simultaneous saves from the same version", async () => {
    const id = await newSharedDoc();
    const [a, b] = await Promise.all([
      updateDocument(ids.owner, id, { baseVersion: 1, content: CONTENT }),
      updateDocument(ids.editor, id, { baseVersion: 1, content: CONTENT }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "conflict")).toHaveLength(1);
    expect((await getDocument(ids.owner, id))?.version).toBe(2);
  });

  it("rejects invalid content without writing", async () => {
    const id = await createDocument(ids.owner);
    const r = await updateDocument(ids.owner, id, {
      baseVersion: 1,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:1" } }] }] }] },
    });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect((await getDocument(ids.owner, id))?.version).toBe(1);
  });

  it("shares neutrally: same result for known and unknown emails", async () => {
    const id = await createDocument(ids.owner);
    const known = await shareDocument(ids.owner, id, `${run}-editor${TEST_DOMAIN}`);
    const unknown = await shareDocument(ids.owner, id, `${run}-nobody${TEST_DOMAIN}`);
    expect(known).toEqual({ ok: true });
    expect(unknown).toEqual(known);

    const collaborators = (await getDocument(ids.owner, id))?.collaborators ?? [];
    expect(collaborators.map((c) => c.id)).toEqual([ids.editor]); // unknown created nothing

    expect(await shareDocument(ids.owner, id, `${run}-editor${TEST_DOMAIN}`)).toEqual({ ok: true }); // idempotent
    expect((await getDocument(ids.owner, id))?.collaborators).toHaveLength(1);
    expect(await shareDocument(ids.owner, id, `${run}-owner${TEST_DOMAIN}`)).toMatchObject({ ok: false, code: "self_share" });
  });

  it("only owners can share; outsiders get not_found", async () => {
    const id = await newSharedDoc();
    expect(await shareDocument(ids.editor, id, `${run}-outsider${TEST_DOMAIN}`)).toEqual({ ok: false, code: "forbidden" });
    expect(await shareDocument(ids.outsider, id, `${run}-outsider${TEST_DOMAIN}`)).toEqual({ ok: false, code: "not_found" });
  });
});
