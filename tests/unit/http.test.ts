import { describe, expect, it, vi } from "vitest";

// http.ts imports the session module; stub it so no database is needed.
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));

const { handle, readJson, sameOrigin } = await import("@/lib/http");

function req(headers: Record<string, string>, body?: string) {
  return new Request("http://localhost:3000/api/x", { method: "POST", headers, body });
}

describe("sameOrigin", () => {
  it("accepts a matching Origin and rejects missing or foreign ones", () => {
    expect(sameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(sameOrigin(req({ host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(req({ origin: "not a url", host: "localhost:3000" }))).toBe(false);
  });
});

describe("readJson", () => {
  it("parses valid JSON", async () => {
    expect(await readJson(req({}, '{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
  });

  it("distinguishes invalid JSON from oversized bodies", async () => {
    expect(await readJson(req({}, "{nope"))).toEqual({ ok: false, reason: "invalid" });
    expect(await readJson(req({}, JSON.stringify({ s: "x".repeat(200) })), 100)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(await readJson(req({ "content-length": "999999999" }, "{}"))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("handle", () => {
  it("turns unexpected errors into a JSON 503 without leaking the message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = handle(async () => {
      throw Object.assign(new Error("postgres://user:secret@host failed"), { code: "ECONNREFUSED" });
    });
    const res = await route();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "unavailable" } });
    expect(spy).toHaveBeenCalledWith("api error: ECONNREFUSED");
    spy.mockRestore();
  });
});
