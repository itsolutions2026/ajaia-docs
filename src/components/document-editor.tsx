"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { contentExtensions } from "@/lib/content/extensions";

type Status = "saved" | "dirty" | "saving" | "error" | "expired" | "conflict" | "gone" | "rejected";
type Collaborator = { id: string; name: string; email: string };

const DEBOUNCE_MS = 1500;
const RETRY_MS = 10_000;

const STATUS_TEXT: Record<Status, string> = {
  saved: "Saved",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  error: "Couldn't save. Retrying…",
  expired: "Session expired. Sign in again in another tab; your changes will then save.",
  conflict: "Not saved: the document changed elsewhere.",
  gone: "Not saved: this document is no longer available.",
  rejected: "Not saved: the server rejected the change.",
};

export default function DocumentEditor(props: {
  id: string;
  title: string;
  content: unknown;
  version: number;
  role: "owner" | "editor";
  ownerName: string;
  collaborators?: Collaborator[];
}) {
  const { id, role } = props;
  const [title, setTitle] = useState(props.title);
  const [status, setStatus] = useState<Status>("saved");
  const [detail, setDetail] = useState("");

  const baseVersion = useRef(props.version);
  const dirtyContent = useRef(false);
  const dirtyTitle = useRef(false);
  const inFlight = useRef(false);
  const halted = useRef(false);
  const titleRef = useRef(props.title);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), ms);
  }, []);

  async function flush() {
    if (inFlight.current || halted.current) return;
    const sendContent = dirtyContent.current;
    const sendTitle = dirtyTitle.current;
    if (!sendContent && !sendTitle) return;
    const editor = editorRef.current;
    if (sendContent && !editor) return;

    inFlight.current = true;
    dirtyContent.current = false;
    dirtyTitle.current = false;
    setStatus("saving");

    const body: Record<string, unknown> = { baseVersion: baseVersion.current };
    if (sendContent) body.content = editor!.getJSON();
    if (sendTitle) body.title = titleRef.current;

    let res: Response | null = null;
    try {
      res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      res = null;
    }
    inFlight.current = false;

    if (res?.ok) {
      const data = (await res.json()) as { version: number };
      baseVersion.current = data.version;
      if (dirtyContent.current || dirtyTitle.current) {
        setStatus("dirty");
        schedule(DEBOUNCE_MS);
      } else {
        setStatus("saved");
      }
      return;
    }

    // Failure: nothing is discarded. Mark the pending fields dirty again.
    if (sendContent) dirtyContent.current = true;
    if (sendTitle) dirtyTitle.current = true;

    if (!res) {
      setStatus("error");
      schedule(RETRY_MS);
    } else if (res.status === 401) {
      setStatus("expired");
      schedule(RETRY_MS);
    } else if (res.status >= 500) {
      setStatus("error");
      schedule(RETRY_MS);
    } else {
      halted.current = true; // 404 / 409 / 413 / 422 / 403: stop saving, keep content
      if (res.status === 409) setStatus("conflict");
      else if (res.status === 404) setStatus("gone");
      else {
        setStatus("rejected");
        try {
          setDetail(((await res.json()) as { error?: { message?: string } }).error?.message ?? "");
        } catch {
          /* ignore */
        }
      }
    }
  }

  const editor = useEditor({
    extensions: contentExtensions,
    content: props.content as Record<string, unknown>,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "ajaia-editor" } },
    onUpdate: () => {
      if (halted.current) return;
      dirtyContent.current = true;
      setStatus((s) => (s === "error" || s === "expired" || s === "saving" ? s : "dirty"));
      schedule(DEBOUNCE_MS);
    },
  });
  useEffect(() => {
    flushRef.current = flush;
    editorRef.current = editor;
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (status === "saved") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  function onTitleChange(value: string) {
    setTitle(value);
    titleRef.current = value;
    if (halted.current) return;
    dirtyTitle.current = true;
    setStatus((s) => (s === "error" || s === "expired" || s === "saving" ? s : "dirty"));
    schedule(DEBOUNCE_MS);
  }

  // ---- Sharing (owner only) ----
  const [collaborators, setCollaborators] = useState<Collaborator[]>(props.collaborators ?? []);
  const [email, setEmail] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [sharing, setSharing] = useState(false);

  async function share(e: React.FormEvent) {
    e.preventDefault();
    setSharing(true);
    setShareMsg("");
    try {
      const res = await fetch(`/api/documents/${id}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { message?: string; error?: { message: string } };
      setShareMsg(data.message ?? data.error?.message ?? "Something went wrong.");
      if (res.ok) {
        setEmail("");
        const doc = await fetch(`/api/documents/${id}`);
        if (doc.ok) setCollaborators(((await doc.json()) as { collaborators?: Collaborator[] }).collaborators ?? []);
      }
    } catch {
      setShareMsg("Network error. Try again.");
    } finally {
      setSharing(false);
    }
  }

  const btn = (active: boolean) =>
    `rounded px-2 py-1 text-sm font-medium border ${
      active
        ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900"
        : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    }`;

  const statusColor =
    status === "saved"
      ? "text-zinc-500"
      : status === "saving" || status === "dirty"
        ? "text-zinc-500"
        : "text-red-600";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between text-sm">
        <Link href="/documents" className="text-zinc-500 hover:underline">
          ← All documents
        </Link>
        <span className={statusColor} role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
      </div>

      {status === "conflict" && (
        <div className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          This document was updated by someone else. Your latest changes haven&apos;t been saved and are still
          shown below. Copy anything you need, then reload the latest version.{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              if (window.confirm("Reload the latest version? Your unsaved changes will be discarded.")) {
                halted.current = false;
                window.location.reload();
              }
            }}
          >
            Reload latest
          </button>
        </div>
      )}
      {status === "gone" && (
        <div className="mb-4 rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-900">
          This document is no longer available to you. Your text is still shown below so you can copy it.
        </div>
      )}
      {status === "rejected" && detail && (
        <div className="mb-4 rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-900">{detail}</div>
      )}

      {role === "owner" ? (
        <input
          value={title}
          maxLength={200}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="Document title"
          className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none"
        />
      ) : (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-zinc-500">Owned by {props.ownerName} · you can edit the content</p>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2" role="toolbar" aria-label="Formatting">
        <button type="button" className={btn(!!editor?.isActive("bold"))} onClick={() => editor?.chain().focus().toggleBold().run()}>
          Bold
        </button>
        <button type="button" className={btn(!!editor?.isActive("italic"))} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          Italic
        </button>
        <button type="button" className={btn(!!editor?.isActive("underline"))} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          Underline
        </button>
        <button type="button" className={btn(!!editor?.isActive("heading", { level: 1 }))} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
          H1
        </button>
        <button type="button" className={btn(!!editor?.isActive("heading", { level: 2 }))} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </button>
        <button type="button" className={btn(!!editor?.isActive("bulletList"))} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          • List
        </button>
        <button type="button" className={btn(!!editor?.isActive("orderedList"))} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          1. List
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
        <EditorContent editor={editor} />
      </div>

      {role === "owner" && (
        <section className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="share-h">
          <h2 id="share-h" className="text-base font-medium">
            Share
          </h2>
          <form onSubmit={share} className="mt-3 flex gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              aria-label="Email to share with"
              className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            <button
              type="submit"
              disabled={sharing}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Share
            </button>
          </form>
          {shareMsg && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{shareMsg}</p>}
          <h3 className="mt-4 text-sm font-medium">People with access</h3>
          {collaborators.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">Only you.</p>
          ) : (
            <ul className="mt-1 text-sm">
              {collaborators.map((c) => (
                <li key={c.id}>
                  {c.name} <span className="text-zinc-500">({c.email}) · editor</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
