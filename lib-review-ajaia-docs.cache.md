version: 2
collected: 2026-11-12 UTC
model: claude-sonnet-5-5
domain: lightweight web collaborative document editor (serverless Next.js + managed Postgres), application
query: /aaa-review-this-pr-whole-architecture (repo: Ajaia Docs; change set = commit 0ad3423 vs parent 3b0172d)
governing_spec: none
spec_authority: n/a
spec_maturity: n/a
spec_accessibility: n/a
spec_relationship: n/a
spec_url: n/a

# Domain Brief

Evidence quality: secondary blogs only (no primary user research); confidence low-medium.

1. Concurrent-edit convergence (elevated 13, 31, 8). Edits from several users must not be lost or reordered; real-time products use OT or CRDTs.
2. Persistence without exhausting database connections (elevated 12, 11, 10). Short-lived serverless invocations need pooled connections.
3. Real-time transport kept separate from Postgres (elevated 21, 22, 24). Not applicable: subject excludes real-time by decision.
4. Offline tolerance and reconnect (elevated 35, 13). Not applicable: subject excludes offline editing.
5. Vendor-dependent real-time features (elevated 26, 34). Not applicable.

Not found: sourced material on import, sharing/permissions, user population.

# Competitive Map

Verified via GitHub API by the sub-agent (star counts are a point-in-time snapshot):

1. Outline - TypeScript, created 2016, 41,235 stars, license reported as BSL 1.1 by search results (API: NOASSERTION), real-time.
2. HedgeDoc - TypeScript, 2019, AGPL-3.0, 7,508 stars, real-time Markdown.
3. Docmost - TypeScript, 2023, AGPL-3.0, 22,303 stars, collaborative wiki (not re-verified in detail).
4. AFFiNE - TypeScript, 2022, license NOASSERTION, 74,459 stars, local-first, real-time sync.
5. Etherpad - TypeScript, 2011, Apache-2.0, 18,628 stars, real-time pad.

Gap: real-time co-editing (5 of 5 competitors). Version history and comments unverified, not counted.
Differentiator: version-number optimistic concurrency with no sync server; operationally simpler than Yjs/Hocuspocus stacks.
Other repositories with the same name as the subject were returned by search; excluded as not competitors.

# Diagnostic Detail

Subject type: application (not a library). Library-API tests are applied by analogy to the HTTP/service surface; inapplicable tests give a clean result with a note.

## Clean results

- 1 Naming Consistency: clean. Consistent camelCase TS, route/handler naming uniform.
- 2 Naming Clarity: clean. resolveAccess, updateDocument, shareDocument reveal intent.
- 3 Self-Documentation: clean. Service functions are typed discriminated unions.
- 4 Cognitive Load: clean. Three layers (route, service, db).
- 5 Boilerplate: clean. Route handlers are thin.
- 6 Type Safety: finding folded into T10 (readJson return type hides undefined). Otherwise clean (discriminated results).
- 8 Least Surprise: clean.
- 9 Defaults Quality: clean (EMPTY_DOC, title default).
- 12 Resource Management: clean. Pool singleton, timers cleaned up (see T11 for the navigation case).
- 14 Ownership Clarity: clean (inapplicable).
- 15 Mutability Discipline: clean.
- 17 Introductory Documentation: clean. README has demo accounts, setup, limitations.
- 18 Example Quality: clean (seed and README flow).
- 19 API Minimality: clean. Eight endpoints, each required.
- 20 Implementation Hiding: clean. server-only guards on db, auth, http, documents.
- 21 Physical Modularity: clean. Acyclic; schema.ts and password.ts deliberately import-free for the seed script.
- 22 Abstraction Coherence: clean.
- 23 Extensibility: clean (contentExtensions is the single schema source).
- 24 Ecosystem Interoperability: clean.
- 25 Dependency Count: clean. All runtime dependencies used.
- 26 Dependency Health: clean with note; npm audit output was not inspected.
- 27 Build Portability: clean with note; only Windows/Node 22 exercised locally, Vercel unverified.
- 29 Compilation Cost: inapplicable.
- 30 Test Presence: partial; folded into T31.
- 33 Benchmark Presence: clean (no performance claims).
- 34 API Stability Discipline: clean (0.1.0, private, one migration).
- 35 Evolution Freedom: clean.
- 38 Maintenance Health: candidate (4 commits, single maintainer) killed in challenge.

## Surviving findings (breadcrumbs)

- T7 (Correctness of Use), medium-high: editor accepts list nesting deeper than the server depth cap (MAX_DEPTH 12, about 6 nested list levels), yielding a deterministic 422 that the client treats as a permanent halt. Evidence: validate.ts MAX_DEPTH; document-editor.tsx halted=true for non-401 4xx.
- T10 (Failure Resilience), medium-high: no API route wraps DB calls in try/catch; only the PATCH route maps oversize bodies to 413 (collaborators and login do not); readJson's declared return type omits undefined; error.tsx claims a database outage for any error; LogoutButton has no try/catch.
- T11 (Failure Resilience), high: edits made within the 1.5 s debounce window are dropped on in-app navigation. Unmount cleanup only clears the timer; beforeunload does not fire for client-side links.
- T13 (Concurrency and State), medium-high: inFlight is cleared before baseVersion is updated (an await on res.json() sits between), so a debounce firing in that gap sends a stale baseVersion, producing a self-inflicted 409 that halts saving. A throw from res.json() on a 200 leaves status "saving" with dirty flags already cleared. The window is narrow.
- T16 (Documentation), medium-high: README states that failures never discard editor content (contradicted by T11); preview-deployments-disabled claim is not verifiable from the repo.
- T28 (Dependencies and Build), medium: implicit environment contract (Node >= 22.6 with --experimental-strip-types for db:seed, --webpack for dev/build, network for next/font/google), no engines range.
- T31 (Verification), high: no tests for login/sessions, route handlers, import route, or editor client logic; database tests are opt-in.
- T32 (Verification), high: no CI configuration; no test ever runs automatically.
- T36 (Sustainability and Trust), medium: no LICENSE file.
- T37 (Sustainability and Trust), medium-high: no security response headers or CSP, although the approved architecture planned basic headers (next.config.ts is empty).

## Killed findings (Phase 8)

- Public demo credentials and no login rate limit: killed by test 1 (documented, approved decision; README states the limitation).
- No per-user document or import quotas: killed by test 2 (never claimed).
- Content size measured in characters, not bytes: killed by test 5 (JSON size is also bounded by the request limit; no failure mechanism shown).
- Session cleanup only at login, no expires_at index: killed by test 3 (common pattern at this scale).
- Client import pre-check duplicates server limits: killed by test 1 (intentional UX pre-check; server is authoritative).
- getDocument resolves access twice / sequential round trips: killed by test 5 (latency impact depends on an unverified function region).
- Missing .env.example: killed by test 1 (README lists the required variables).
- Single maintainer / 4 commits: killed by tests 6 and scope (snapshot, not trajectory; assignment context).

## Coupling (Phases 9 and 10)

Killed compounds:
- Silent content loss (T10 with T11): the error page is not on the navigation-loss path, so the constituents do not amplify each other.
- Unexposed risk (T37 with T36): generic truism.
- False-clean dirty state (T13 with T11): the beforeunload guard keys off status, not the dirty flags, and status stays "saving"; the mechanism is contradicted by the code.
- Environment-dependent verification (T28 with T31/T32): the database tests create their own users and do not use the seed script; mechanism wrong.
- Trust erosion (T37 with T31 and T36 with T32): inferred, no grounded mechanism.

Surviving compounds:
1. Halt-and-drop autosave (T13, T7, T11): two independent triggers (stale-version 409, depth 422) lead to the same permanent halt, and halted edits stay exposed to the navigation drop.
2. Unchecked guarantees (T31, T32, T16, with the defects of compound 1): no client tests and no CI, so the README guarantee that compound 1 violates is never checked.

Standalone surviving findings: T10, T28, T36, T37.

## Deviations

- Phase 1: origin/main equals HEAD, so the change set is the single commit 0ad3423 against its parent 3b0172d (severity low).
- Phases 4 and 5 were launched concurrently with Phase 3 using the README-derived feature set (low).
- Phase 3 used a general-purpose sub-agent on a stronger model than the "fast" tier, for accuracy (low).
- Phase 6 asked no questions: assumptions were resolved from the project's approved decisions (low).
- Design parallel (synthesis step 3) omitted: no verifiable project matches the compound picture (low).
