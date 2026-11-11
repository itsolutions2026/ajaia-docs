import { describe, expect, it } from "vitest";

import { importFile, markdownToDoc } from "@/lib/content/import";
import { validateContent } from "@/lib/content/validate";
import { hashPassword, verifyPassword } from "@/lib/password";

const p = (text: string, marks?: { type: string }[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});
const doc = (...content: unknown[]) => ({ type: "doc", content });
const enc = (s: string) => new TextEncoder().encode(s);

describe("validateContent", () => {
  it("accepts allowed formatting and returns normalized JSON", () => {
    const r = validateContent(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H" }] },
        p("a", [{ type: "bold" }, { type: "underline" }]),
        { type: "bulletList", content: [{ type: "listItem", content: [p("x")] }] },
      ),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects link marks (no link support)", () => {
    const r = validateContent(doc(p("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } } as never])));
    expect(r.ok).toBe(false);
  });

  it("rejects unknown nodes, heading level 3, non-doc roots and non-objects", () => {
    expect(validateContent(doc({ type: "script", content: [] })).ok).toBe(false);
    expect(validateContent(doc({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "x" }] })).ok).toBe(false);
    expect(validateContent({ type: "paragraph" }).ok).toBe(false);
    expect(validateContent("nope").ok).toBe(false);
    expect(validateContent(null).ok).toBe(false);
  });

  it("rejects oversized and overly deep content", () => {
    expect(validateContent(doc(p("a".repeat(1_100_000)))).ok).toBe(false);
    let deep: unknown = p("x");
    for (let i = 0; i < 20; i++) {
      deep = { type: "bulletList", content: [{ type: "listItem", content: [deep] }] };
    }
    expect(validateContent(doc(deep)).ok).toBe(false);
  });
});

describe("importFile", () => {
  it("imports markdown headings, bold and lists", () => {
    const r = importFile("My Notes.md", enc("# Title\n\nHello **bold**\n\n- a\n- b\n"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.title).toBe("My Notes");
      expect(JSON.stringify(r.content)).toContain('"bulletList"');
      expect(JSON.stringify(r.content)).toContain('"bold"');
    }
  });

  it("imports plain text as paragraphs", () => {
    const r = importFile("a.txt", enc("one\n\ntwo\nthree"));
    expect(r.ok).toBe(true);
  });

  it("keeps raw HTML and script payloads as inert text, drops link URLs", () => {
    const tree = markdownToDoc("Hi <script>alert(1)</script> [x](javascript:alert(1))");
    const json = JSON.stringify(tree);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain('"link"');
    const r = importFile("x.md", enc("Hi <script>alert(1)</script> [x](javascript:alert(1))"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.content)).not.toContain("javascript:");
  });

  it("rejects unsupported types, empty, oversized, binary and invalid UTF-8", () => {
    expect(importFile("a.pdf", enc("x"))).toMatchObject({ ok: false, status: 415 });
    expect(importFile("a.docx", enc("x"))).toMatchObject({ ok: false, status: 415 });
    expect(importFile("a.txt", new Uint8Array(0))).toMatchObject({ ok: false, status: 422 });
    expect(importFile("a.txt", enc("  \n\n "))).toMatchObject({ ok: false, status: 422 });
    expect(importFile("a.txt", new Uint8Array(1024 * 1024 + 1).fill(97))).toMatchObject({ ok: false, status: 413 });
    expect(importFile("a.txt", new Uint8Array([97, 0, 98]))).toMatchObject({ ok: false, status: 422 });
    expect(importFile("a.txt", new Uint8Array([0xff, 0xfe, 0xfd]))).toMatchObject({ ok: false, status: 422 });
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});
