import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";

import { contentExtensions } from "./extensions";

export const MAX_CONTENT_BYTES = 1_000_000;
const MAX_NODES = 50_000;
const MAX_DEPTH = 12;

const schema = getSchema(contentExtensions);

export type ContentResult =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; reason: string };

type JsonNode = { content?: JsonNode[] };

function depthOf(node: JsonNode, depth: number): number {
  if (!Array.isArray(node.content) || node.content.length === 0) return depth;
  let max = depth + 1;
  for (const child of node.content) {
    max = Math.max(max, depthOf(child, depth + 1));
  }
  return max;
}

/**
 * Validates TipTap JSON against the allowlisted schema and returns the
 * normalized form (unknown attributes dropped). Rejects unknown nodes/marks,
 * oversize or overly deep documents.
 */
export function validateContent(input: unknown): ContentResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "Content must be an object." };
  }
  let size: number;
  try {
    size = JSON.stringify(input).length;
  } catch {
    return { ok: false, reason: "Content is not valid JSON." };
  }
  if (size > MAX_CONTENT_BYTES) {
    return { ok: false, reason: "Content is too large." };
  }
  if ((input as { type?: unknown }).type !== "doc") {
    return { ok: false, reason: "Content root must be a doc." };
  }
  if (depthOf(input as JsonNode, 0) > MAX_DEPTH) {
    return { ok: false, reason: "Content is nested too deeply." };
  }

  try {
    const node = PMNode.fromJSON(schema, input);
    node.check();

    let count = 0;
    let bad: string | null = null;
    node.descendants((child) => {
      count += 1;
      if (count > MAX_NODES) bad = "Content has too many nodes.";
      if (child.type.name === "heading" && ![1, 2].includes(child.attrs.level)) {
        bad = "Unsupported heading level.";
      }
      return bad === null;
    });
    if (bad) return { ok: false, reason: bad };

    return { ok: true, content: node.toJSON() as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "Content structure is not allowed." };
  }
}
