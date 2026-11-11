# A strongly verified server core behind a weakly verified autosave client

**Ajaia Docs is a small serverless document editor whose authorization and concurrency contract is sound and tested, while the client code that depends on that contract is untested and has several ways to stop saving.**

November 2026, by ljsitsolution

---

## 1. Executive Summary

The change set is the MVP commit (0ad3423) on top of a bare Next.js skeleton.<sup>1</sup> Measured against that baseline, it improves the project's structural health substantially: it introduces a layered, acyclic server with one authorization function, an atomic version-checked save, and an allowlist-based content pipeline, all with meaningful tests. It also introduces two structural weaknesses that did not exist before because the code did not exist: a fragile client save loop and a verification gap around it.

The dominant dynamic is an asymmetry of rigor. The server side is hardened and tested (single `resolveAccess` boundary, uniform 404s, atomic `UPDATE ... WHERE version = base`, a simultaneous-save test).<sup>2</sup> The autosave client, which is the only consumer of that contract, has two independent triggers that permanently halt saving and a navigation path that drops pending edits, and nothing checks it: no client tests, no CI, and a README guarantee that the code contradicts.<sup>3</sup>

Competitively, the subject trades real-time co-editing, which all five verified competitors provide, for operational simplicity.<sup>4</sup> That trade is deliberate and approved, so its absence is not a finding. The overall verdict is Promising.

---

## 2. The Project

Ajaia Docs is a Next.js 16 App Router application in TypeScript. It stores rich-text documents as TipTap JSON in Supabase Postgres through Drizzle ORM and postgres-js, runs on Vercel, and exposes eight HTTP endpoints for login, logout, document listing and creation, reading and saving, sharing, and import.<sup>1</sup> The repository holds about 2,100 lines across `src`, `scripts` and `tests`, one migration, and four commits from a single maintainer.<sup>1</sup>

It claims: seeded demo users with scrypt-hashed passwords and server-side sessions; owner/editor roles where only owners rename and share; debounced autosave; optimistic concurrency by version number; neutral sharing responses; TXT and Markdown import up to 1 MB; and identical not-found responses for unknown and unauthorized documents.<sup>5</sup>

Structure:

1. Route handlers and server pages are thin and call `lib/documents.ts`.
2. `lib/documents.ts` owns authorization and persistence and calls `lib/db` and `lib/content`.
3. `lib/content` holds the single editor schema, the validator, and the importers.
4. `lib/auth.ts` and `lib/password.ts` own sessions and hashing.
5. `server-only` guards the server modules, and `schema.ts` and `password.ts` import nothing relative so the seed script can load them directly.<sup>1</sup>

---

## 3. The Domain

Domain evidence is thin: the research agent found only secondary blogs and nothing on import or sharing demands, so these stress points carry low-medium confidence.<sup>6</sup> (low-medium)

1. Concurrent edits must not be lost. Real-time products use OT or CRDTs; the subject chose conflict rejection instead.
2. Frequent saves from short-lived serverless invocations must not exhaust database connections, which makes pooling and failure handling on the save path matter most.
3. Real-time transport and offline merge are demanded of the domain but excluded from this subject by decision, so they carry no weight here.

---

## 4. The Landscape

Verified competitors, with adoption figures as a point-in-time snapshot:<sup>4</sup>

1. Outline: TypeScript, 2016, about 41,000 stars, license reported as BSL 1.1 (source-available, not OSI), real-time.
2. AFFiNE: TypeScript, 2022, about 74,000 stars, license not asserted by the API, local-first with real-time sync.
3. Docmost: TypeScript, 2023, about 22,000 stars, AGPL-3.0, collaborative wiki.
4. Etherpad: TypeScript, 2011, about 18,600 stars, Apache-2.0, real-time.
5. HedgeDoc: TypeScript, 2019, about 7,500 stars, AGPL-3.0, real-time Markdown.

The one verified gap is real-time co-editing, present in all five. Version history and comments were not verified for the competitors and are not counted. The differentiator is operational: version-number conflict rejection needs no sync server, which is simpler to deploy on Vercel Free plus Supabase Free than the Yjs-style stacks real-time competitors use. The design pattern comparison is therefore OT/CRDT over WebSockets versus optimistic REST saves.

---

## 5. Design Assessment

### 5.1 Halt-and-drop autosave

The client save loop in `document-editor.tsx` has two independent routes into the same dead end and one route around its own safety net.<sup>7</sup>

1. **Self-inflicted conflict.** The in-flight flag is cleared before `baseVersion` is updated, and an `await` on the response body sits between the two. A debounce timer firing in that gap sends a stale version, receives a 409, and the client marks itself halted until reload. The window is narrow. (medium-high)
2. **Depth mismatch.** The editor permits list nesting deeper than the server's depth cap (about six nested levels), so a valid-looking edit gets a deterministic 422 (Bloch 2006). The client treats every non-401 4xx as a permanent halt, so this trigger is reproducible, not a race. (medium-high)
3. **Dropped edits on navigation.** Unmount cleanup only clears the timer, and the `beforeunload` guard does not fire for the in-app "All documents" link. Edits made in the last debounce window are lost without any error path running (Abrahams 2001).<sup>7</sup>
4. **Halt widens the drop.** Once saving halts, every later edit stays unsent, so the amount of content exposed to the navigation drop grows until reload.

A related edge sits inside the same state machine: if reading the response body throws on a successful save, the dirty flags are already cleared and the status stays "saving". The leave-page guard still fires in that case because it keys off status, so it is a stuck-state bug, not a silent-loss bug. (medium)

The server half of this contract is sound: the save is one conditional update, a zero-row result is re-checked to distinguish not-found from conflict, and a database test verifies that of two simultaneous saves exactly one wins.<sup>2</sup> The weakness is entirely on the client.

### 5.2 Unchecked guarantees

Three findings keep the defects in 5.1 from being noticed.

1. **No client or route tests.** Unit tests cover the content validator, importer and password hashing, and opt-in database tests cover authorization, ordering, concurrency and neutral sharing. Nothing covers login and session handling, any route handler, the import route, or any editor logic (Lakos 1996; Boost Contributor Checklist).<sup>8</sup>
2. **No CI.** There is no workflow configuration, so even the existing tests never run automatically (OpenSSF Scorecard). The database tests are also opt-in by design, so a pipeline would skip them unless configured otherwise.<sup>8</sup>
3. **A README claim that is false.** The README states that save failures never discard editor content, which the navigation case contradicts (Cwalina and Abrams 2009). With no test of that guarantee, the claim persists unchallenged.<sup>5</sup>

Together these let the autosave defects in 5.1 ship with documentation that says they cannot exist.

### 5.3 Standalone findings

1. **Inconsistent API failure handling.** No route handler wraps database calls in `try/catch`, so a database outage returns the framework's default 500 instead of the JSON error envelope. Only the save route maps oversize bodies to 413; the collaborators and login routes do not. The `readJson` helper's declared return type omits the `undefined` case it returns, and the global error page claims a database outage for any error (Rust API Guidelines C-VALIDATE). The editor's retry-on-5xx behavior contains most of the user impact. (medium-high)
2. **Security headers absent.** `next.config.ts` is empty, although the approved architecture planned basic response headers, and there is no CSP. The editor renders content through ProseMirror and the server validates against an allowlist, which limits exposure, but the planned defense in depth is not present (OpenSSF Scorecard). (medium-high)
3. **Implicit environment contract.** `db:seed` needs Node 22.6 or later with an experimental flag, development and build use `--webpack`, and builds need network access for a web font. No `engines` range or `.nvmrc` declares any of it (Microsoft Pragmatic Rust Guidelines M-OOBE). (medium)
4. **No license file.** (Rust API Guidelines C-PERMISSIVE) (medium)

### What is sound

The following held up under review and is worth stating because it is the project's structural strength:

1. Sessions use 32 random bytes stored as a SHA-256 hash, a fresh token per login, an HttpOnly, SameSite=Lax cookie with the `__Host-` prefix in production, and server-side revocation.
2. Authorization checks access before validating the body, and unknown, malformed and unauthorized IDs return identical responses.
3. Every mutating route checks a same-origin `Origin` header before doing anything else.
4. Content passes through a schema allowlist with size, node and depth caps, and imports produce allowlisted JSON only: raw HTML becomes inert text and links are dropped.
5. Database tests create their own users, never act as demo users, and check a fingerprint of the demo documents before and after.

---

## 6. Design Maturity

The verdict is Promising. The core is sound and the gaps are addressable without redesign: the server contract needs no change, and the client defects, the missing tests and CI, and the small hygiene items are local fixes. The findings form one coherent picture, a rigorous server paired with a client that has not been given the same discipline, so the verification gap is the lever. Closing it means a flush on unmount, updating `baseVersion` before releasing the in-flight flag, treating only terminal 4xx as a halt, aligning the depth cap, and a small client test plus a CI job that runs the unit suite.

Change-set impact against the pre-MVP skeleton:

1. Halt-and-drop autosave: introduced by this change set (worsens relative to a project with no editor, and it is the most consequential new weakness).
2. Unchecked guarantees: introduced in part (tests added for the server side, which improves; no CI and no client tests, which leaves the new surface unprotected).
3. Layered server, authorization and content pipeline: new and sound (improves).
4. Standalone findings: introduced with the code, low individual weight.

Overall, the change set moves the project toward production-grade, and what remains is concentrated in one component.

---

## 7. Audit Trail

1. Subject resolved to the local repository root. `origin/main` equals `HEAD`, so the change set is commit 0ad3423 against its parent 3b0172d.
2. No prior `code-review-*.md` or `lib-review-*.md` report existed, so Phase 2 was skipped.
3. Reconnaissance, domain research, competitive research and coupling analysis ran in separate sub-agents. Reconnaissance claims about the editor were cross-checked against the code before being retained.
4. No user questions were asked. Assumptions were resolved from the approved decision record.
5. No governing specification was identified.
6. Diagnosis ran all 38 tests. Ten findings survived and eight were killed: public demo credentials and no login rate limit (documented, approved decision), per-user quotas (never claimed), character-versus-byte size measurement (no failure mechanism), session cleanup design (common pattern), duplicated client import checks (intentional pre-check), double access resolution (latency impact depends on an unverified deployment region), missing `.env.example` (README lists the variables), and single-maintainer status (snapshot, not trajectory).
7. Coupling analysis returned six candidate compounds beyond the two within-cluster ones. Five were killed, including a "false-clean dirty state" whose mechanism the code contradicts, because the leave-page guard keys off status and not the dirty flags. Two compounds survived and are merged into 5.1 and 5.2.
8. Deviations: the change-set base was the parent commit because the branch had no commits ahead of its remote; domain and competitive research ran concurrently with reconnaissance using the README-derived feature set; reconnaissance used a stronger model than the fast tier; no design-parallel project is named because none could be verified. Cache file: `lib-review-ajaia-docs.cache.md`.

Not verified: the deployed Vercel behavior, the editor in a browser, and `npm audit` output.

---

## 8. References

1. Repository `Aajia` (local), commits aa1c73a, 3247411, 3b0172d and 0ad3423; file listing and line counts from reconnaissance.
2. `src/lib/documents.ts` (`resolveAccess`, `updateDocument`) and `tests/db/documents.test.ts` (simultaneous-save and parity tests).
3. `README.md` and `src/components/document-editor.tsx`.
4. Competitive research via the GitHub API (Outline, AFFiNE, Docmost, Etherpad, HedgeDoc), snapshot taken during this review; Outline license per search results, not the API.
5. `README.md` (feature and limitation claims).
6. Domain research, secondary sources: DEV Community, "CRDT vs Operational Transformation"; Neon FAQ on serverless connections; Front Tribe, "Postgres connection pooling on serverless".
7. `src/components/document-editor.tsx` (save loop, unmount cleanup, `beforeunload` handler, halt rule) and `src/lib/content/validate.ts` (depth cap).
8. Repository tree: no `.github/`, no CI configuration, `tests/unit` and `tests/db` only, `package.json` test scripts.

---

Abrahams, D. "Exception Safety in Generic Components." 2001.

Bloch, J. "How to Design a Good API and Why it Matters." *Companion to OOPSLA*, 2006.

Boost Contributor Checklist.

Cwalina, K. and Abrams, B. *Framework Design Guidelines.* Addison-Wesley, 2009.

Lakos, J. *Large-Scale C++ Software Design.* Addison-Wesley, 1996.

Microsoft Pragmatic Rust Guidelines, M-OOBE.

OpenSSF Scorecard.

Rust API Guidelines, C-PERMISSIVE and C-VALIDATE.

---

*November 2026 - claude-sonnet-5-5*
