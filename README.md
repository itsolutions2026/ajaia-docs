# Ajaia Docs

A lightweight collaborative document editor: create and edit rich-text documents, import `.txt` / `.md`, and share with other users. Built with Next.js (App Router, TypeScript), TipTap, Drizzle ORM and Supabase Postgres, deployed on Vercel.

## Demo accounts (public, for reviewers)

| Email | Password | Purpose |
|---|---|---|
| alice@demo.ajaia.example | Alice-Demo-2026 | Owns "Welcome to Ajaia Docs", which is shared with Bob |
| bob@demo.ajaia.example | Bob-Demo-2026 | Editor on Alice's document (cannot rename or share) |
| carol@demo.ajaia.example | Carol-Demo-2026 | No access to Alice's document |

Suggested checks: sign in as Alice, edit and rename the document, share a new document with Bob; sign in as Bob and edit it (title is read-only, no Share panel); as Carol, open Alice's document URL and see the generic "not found" page.

## Features

- Seeded demo users, scrypt password hashes, server-managed sessions (HttpOnly cookie, hashed token stored in the database)
- Create, rename (owner only), edit and reopen documents; TipTap JSON storage (bold, italic, underline, H1/H2, bullet and numbered lists)
- Debounced autosave with visible status; failures never discard editor content (retry, leave-page warning)
- Optimistic concurrency: every save carries the document version; stale saves get a 409 and the editor keeps local text with a conflict banner
- Sharing by email (owner only, editor access). The response is identical for known and unknown emails; only the owner's collaborator list shows real membership
- Import `.txt` / `.md` (max 1 MB), validated and converted server-side to the allowlisted editor schema (raw HTML becomes inert text, links are dropped)
- Unknown and unauthorized documents return identical not-found responses

## Security model

Application-level authorization through `resolveAccess()` (`src/lib/documents.ts`) is the security boundary for every document operation. Row Level Security is enabled on all tables with no policies so the Supabase public API exposes nothing, but RLS is not relied on for owner/editor permissions. Client-supplied user IDs are never trusted; identity comes only from the session cookie. State-changing API requests require a same-origin `Origin` header.

## Local development

```bash
npm install
# .env.local (never committed):
#   DATABASE_URL=postgresql://...:6543/postgres            (Supabase transaction pooler; used by the app)
#   MIGRATION_DATABASE_URL=postgresql://...:5432/postgres  (session pooler; migrations only)
npm run db:migrate   # apply SQL in ./drizzle
npm run db:seed      # idempotent: demo users + demo document
npm run dev
```

## Tests

```bash
npm test                          # unit tests; no database needed
ALLOW_DB_TESTS=1 npm run test:db  # database integration tests (explicit opt-in)
```

Integration tests create their own users on the reserved `@test.invalid` domain, only touch documents those users own, never act as demo users, delete only what they created, and compare a fingerprint of the demo documents before and after the run.

## Deployment (Vercel + Supabase Free)

- Vercel environment variable: `DATABASE_URL` (transaction pooler, port 6543), Production scope. Nothing else is required at runtime.
- Migrations and seeding run from a developer machine, not during the Vercel build.
- Preview deployments are disabled; only the production branch deploys.

## Known limitations

- **Supabase Free pauses inactive projects** (after about a week at the time of writing). There is no keep-alive. If the app shows "Service temporarily unavailable", open the Supabase dashboard and restore the project, then reload.
- No login rate limiting. Demo credentials are public by design; anyone can sign in as a demo user and change demo data.
- Concurrent edits are detected and rejected, never merged. The version number is a concurrency token, not history.
- Autosave on page unload is best effort; a leave-page warning covers unsaved changes.
- Not built: real-time collaboration, comments, version history, viewer role, document deletion, `.docx`/PDF import.
