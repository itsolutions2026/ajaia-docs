import { describe, expect, it, vi } from "vitest";

// http.ts imports the session module; stub it so no database is needed.
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));

const { handle, readJson, sameOrigin, MAX_REQUEST_BYTES } = await import("@/lib/http");
const { validateContent, MAX_CONTENT_BYTES } = await import("@/lib/content/validate");

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

describe("size limits (UTF-8 bytes)", () => {
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

  it("counts multibyte characters as bytes in readJson", async () => {
    // 60 characters, 120 UTF-8 bytes: over a 100-byte cap.
    const body = JSON.stringify({ s: "é".repeat(60) });
    expect(await readJson(req({}, body), 100)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects content over the limit when measured in bytes, not characters", () => {
    // 340k CJK characters: under 1M characters but over 1M UTF-8 bytes.
    expect(validateContent(doc("中".repeat(340_000))).ok).toBe(false);
  });

  it("lets any content that passes validation fit in a save request", async () => {
    // Just under the content limit in CJK (3 bytes per character).
    const content = doc("中".repeat(Math.floor((MAX_CONTENT_BYTES - 200) / 3)));
    expect(validateContent(content).ok).toBe(true);
    const body = JSON.stringify({ baseVersion: 1, title: "中".repeat(200), content });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
    expect((await readJson(req({}, body))).ok).toBe(true);
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
