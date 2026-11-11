import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Heading, List, ListItem, Nodes, PhrasingContent, RootContent } from "mdast";

import { validateContent } from "./validate";

export const MAX_IMPORT_BYTES = 1024 * 1024;

type Mark = { type: "bold" | "italic" };
type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Mark[];
};

export type ImportResult =
  | { ok: true; title: string; content: Record<string, unknown> }
  | { ok: false; status: 413 | 415 | 422; message: string };

// ---- Markdown -> allowlisted TipTap JSON. No HTML is ever produced. --------

function text(value: string, marks: Mark[]): PMNode[] {
  if (!value) return [];
  return [{ type: "text", text: value, ...(marks.length ? { marks: [...marks] } : {}) }];
}

function plain(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plain).join("");
  if (node.type === "image") return node.alt ?? "";
  return "";
}

function inline(nodes: PhrasingContent[], marks: Mark[] = []): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push(...text(n.value, marks));
        break;
      case "strong":
        out.push(...inline(n.children, [...marks, { type: "bold" }]));
        break;
      case "emphasis":
        out.push(...inline(n.children, [...marks, { type: "italic" }]));
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "inlineCode":
      case "html":
        // Raw HTML / code becomes literal text, never markup.
        out.push(...text(n.value, marks));
        break;
      case "link": // no link support: keep the text only
      case "delete":
        out.push(...inline(n.children, marks));
        break;
      case "image":
        out.push(...text(n.alt ?? "", marks));
        break;
      default:
        out.push(...text(plain(n), marks));
    }
  }
  return out;
}

function paragraphFromLines(value: string): PMNode {
  const content: PMNode[] = [];
  value.split(/\r?\n/).forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push(...text(line, []));
  });
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

function listNode(list: List): PMNode {
  return {
    type: list.ordered ? "orderedList" : "bulletList",
    content: list.children.map(listItem),
  };
}

function listItem(item: ListItem): PMNode {
  const content: PMNode[] = [];
  for (const child of item.children) content.push(...block(child));
  if (content.length === 0 || content[0].type !== "paragraph") {
    content.unshift({ type: "paragraph" });
  }
  return { type: "listItem", content };
}

function block(node: RootContent): PMNode[] {
  switch (node.type) {
    case "heading": {
      const level = Math.min(Math.max((node as Heading).depth, 1), 2);
      const content = inline(node.children);
      return [{ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) }];
    }
    case "paragraph": {
      const content = inline(node.children);
      return [{ type: "paragraph", ...(content.length ? { content } : {}) }];
    }
    case "list":
      return [listNode(node)];
    case "blockquote":
      return node.children.flatMap(block);
    case "code":
    case "html":
      return [paragraphFromLines(node.value)];
    case "thematicBreak":
    case "definition":
    case "yaml":
      return [];
    case "table":
      return node.children.map((row) =>
        paragraphFromLines(row.children.map((cell) => plain(cell)).join(" | ")),
      );
    default: {
      const value = plain(node);
      return value ? [paragraphFromLines(value)] : [];
    }
  }
}

export function markdownToDoc(source: string): PMNode {
  const tree = unified().use(remarkParse).parse(source);
  const content = tree.children.flatMap(block);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function textToDoc(source: string): PMNode {
  const blocks = source
    .split(/\r?\n[ \t]*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(paragraphFromLines);
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

// ---- File validation ---------------------------------------------------------

function titleFromFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  const cleaned = base.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  return cleaned || "Imported document";
}

export function importFile(filename: string, bytes: Uint8Array): ImportResult {
  const lower = filename.toLowerCase();
  const isMd = lower.endsWith(".md");
  const isTxt = lower.endsWith(".txt");
  if (!isMd && !isTxt) {
    return { ok: false, status: 415, message: "Unsupported file type. Use .txt or .md." };
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, status: 413, message: "File is too large (maximum 1 MB)." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, status: 422, message: "File is empty." };
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 422, message: "File is not valid UTF-8 text." };
  }
  source = source.replace(/^﻿/, "");
  if (/[\u0000-\u0008\u000e-\u001f]/.test(source)) {
    return { ok: false, status: 422, message: "File does not look like text." };
  }
  if (source.trim().length === 0) {
    return { ok: false, status: 422, message: "File is empty." };
  }

  const doc = isMd ? markdownToDoc(source) : textToDoc(source);
  const checked = validateContent(doc);
  if (!checked.ok) {
    return { ok: false, status: 422, message: "File content could not be imported." };
  }
  return { ok: true, title: titleFromFilename(filename), content: checked.content };
}
