import StarterKit from "@tiptap/starter-kit";

// Single source of truth for the allowed document structure. Used by the
// editor (client) and by server-side validation. No links, code, quotes, etc.
export const contentExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    link: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
  }),
];

export const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;
