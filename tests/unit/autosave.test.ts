import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Autosave, type SaveStatus } from "@/lib/autosave";

type Call = { baseVersion: number; content?: unknown; title?: string };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Fake server that behaves like PATCH /api/documents/:id (version check). */
function makeServer() {
  const state = { version: 1, calls: [] as Call[] };
  const handlers: ((call: Call) => Promise<Response> | Response)[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const call = JSON.parse(String(init?.body)) as Call;
    state.calls.push(call);
    const override = handlers.shift();
    if (override) return override(call);
    if (call.baseVersion !== state.version) {
      return jsonResponse(409, { error: { code: "version_conflict" }, currentVersion: state.version });
    }
    state.version += 1;
    return jsonResponse(200, { version: state.version });
  }) as unknown as typeof fetch;
  return { state, handlers, fetchImpl };
}

function setup(server = makeServer()) {
  const statuses: SaveStatus[] = [];
  const a = new Autosave({
    docId: "d1",
    version: 1,
    onStatus: (s) => statuses.push(s),
    fetchImpl: server.fetchImpl,
    debounceMs: 1500,
    retryMs: 10_000,
  });
  return { a, server, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Autosave", () => {
  it("debounces edits into one save with the current version", async () => {
    const { a, server, statuses } = setup();
    a.setContent({ type: "doc", content: [] });
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1499);
    expect(server.state.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.state.calls).toEqual([{ baseVersion: 1, content: { type: "doc", content: [] } }]);
    expect(a.version).toBe(2);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("never sends a stale version when edits arrive during an in-flight save", async () => {
    const server = makeServer();
    let release!: () => void;
    server.handlers.push(
      () =>
        new Promise<Response>((resolve) => {
          release = () => {
            server.state.version += 1;
            resolve(jsonResponse(200, { version: server.state.version }));
          };
        }),
    );
    const { a, statuses } = setup(server);
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1500); // first save in flight
    a.setContent({ type: "doc", content: [] }); // edit during flight
    await vi.advanceTimersByTimeAsync(1500); // debounce fires while still in flight
    release();
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.state.calls.map((c) => c.baseVersion)).toEqual([1, 2]);
    expect(statuses).not.toContain("conflict");
    expect(a.isClean).toBe(true);
  });

  it("keeps content dirty and retries after a network error", async () => {
    const server = makeServer();
    server.handlers.push(() => Promise.reject(new TypeError("offline")));
    const { a, statuses } = setup(server);
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("error");
    expect(a.isClean).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.state.calls).toHaveLength(2);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("treats an unreadable success body as an error, not as saved", async () => {
    const server = makeServer();
    server.handlers.push(() => new Response("not json", { status: 200 }));
    const { a, statuses } = setup(server);
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("error");
    expect(a.isClean).toBe(false);
  });

  it("halts on conflict and ignores later edits", async () => {
    const server = makeServer();
    server.state.version = 5; // someone else saved
    const { a, statuses } = setup(server);
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("conflict");
    expect(a.isHalted).toBe(true);
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(server.state.calls).toHaveLength(1);
  });

  it("does not halt on rejected content; the next edit tries again", async () => {
    const server = makeServer();
    server.handlers.push(() => jsonResponse(422, { error: { message: "Content is nested too deeply." } }));
    const { a, statuses } = setup(server);
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("rejected");
    expect(a.isHalted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(server.state.calls).toHaveLength(1); // no automatic retry
    a.setContent({ type: "doc", content: [] });
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.state.calls).toHaveLength(2);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("retries after a session expiry", async () => {
    const server = makeServer();
    server.handlers.push(() => jsonResponse(401, { error: { code: "unauthenticated" } }));
    const { a, statuses } = setup(server);
    a.setTitle("T");
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("expired");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.state.calls.at(-1)).toEqual({ baseVersion: 1, title: "T" });
    expect(statuses.at(-1)).toBe("saved");
  });

  it("flushNow saves pending edits immediately and reports clean", async () => {
    const { a, server } = setup();
    a.setContent({ type: "doc", content: [] });
    const clean = await a.flushNow();
    expect(clean).toBe(true);
    expect(server.state.calls).toHaveLength(1);
  });

  it("flushNow reports not clean when the save fails", async () => {
    const server = makeServer();
    server.handlers.push(() => jsonResponse(503, { error: { code: "unavailable" } }));
    const { a } = setup(server);
    a.setContent({ type: "doc", content: [] });
    expect(await a.flushNow()).toBe(false);
  });
});
