// Idempotent demo seed. Run with: npm run db:seed
// - Users are inserted only if their email does not exist (never overwritten).
// - The demo document is inserted only if missing (reviewers' edits are never
//   overwritten).
// Demo credentials are public by design and documented in the README.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { documentCollaborators, documents, users } from "../src/lib/db/schema.ts";
import { hashPassword } from "../src/lib/password.ts";

const DEMO_USERS = [
  { email: "alice@demo.ajaia.example", name: "Alice (owner)", password: "Alice-Demo-2026" },
  { email: "bob@demo.ajaia.example", name: "Bob (editor)", password: "Bob-Demo-2026" },
  { email: "carol@demo.ajaia.example", name: "Carol (no access)", password: "Carol-Demo-2026" },
];

const DEMO_DOC_ID = "11111111-1111-4111-8111-111111111111";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("FAIL: DATABASE_URL is not set.");
  process.exit(1);
}

const client = postgres(url, { prepare: false, max: 1, ssl: "require", connect_timeout: 10 });
const db = drizzle(client);

try {
  for (const u of DEMO_USERS) {
    await db
      .insert(users)
      .values({ email: u.email, name: u.name, passwordHash: await hashPassword(u.password) })
      .onConflictDoNothing({ target: users.email });
  }

  const all = await db.select({ id: users.id, email: users.email }).from(users);
  const idOf = (email: string) => all.find((x) => x.email === email)!.id;
  const alice = idOf("alice@demo.ajaia.example");
  const bob = idOf("bob@demo.ajaia.example");

  await db
    .insert(documents)
    .values({
      id: DEMO_DOC_ID,
      ownerId: alice,
      title: "Welcome to Ajaia Docs",
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Welcome to Ajaia Docs" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "This document is owned by Alice and shared with Bob. Try " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: ", " },
              { type: "text", text: "italic", marks: [{ type: "italic" }] },
              { type: "text", text: " and " },
              { type: "text", text: "underline", marks: [{ type: "underline" }] },
              { type: "text", text: " formatting." },
            ],
          },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Edits save automatically." }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Only the owner can rename or share." }] }] },
            ],
          },
        ],
      },
    })
    .onConflictDoNothing({ target: documents.id });

  await db
    .insert(documentCollaborators)
    .values({ documentId: DEMO_DOC_ID, userId: bob })
    .onConflictDoNothing();

  console.log(`OK: seeded ${DEMO_USERS.length} demo users and the demo document.`);
} catch (err) {
  const e = err as { code?: string; message?: string };
  console.error("FAIL: seeding failed.");
  console.error(`  code:    ${e.code ?? "n/a"}`);
  console.error(`  message: ${String(e.message ?? err).replaceAll(url, "[redacted]")}`);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
