"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Autosave, type SaveStatus } from "@/lib/autosave";
import { contentExtensions } from "@/lib/content/extensions";

type Collaborator = { id: string; name: string; email: string };

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  error: "Couldn't save. Retrying…",
  expired: "Session expired. Sign in again in another tab; your changes will then save.",
  conflict: "Not saved: the document changed elsewhere.",
  gone: "Not saved: this document is no longer available.",
  rejected: "Not saved: the server rejected the change. Edit the document to try again.",
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
  const router = useRouter();
  const [title, setTitle] = useState(props.title);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [detail, setDetail] = useState("");
  const [leaving, setLeaving] = useState(false);

  const allowUnload = useRef(false);

  const [autosave] = useState(
    () =>
      new Autosave({
        docId: props.id,
        version: props.version,
        onStatus: (s, d) => {
          setStatus(s);
          setDetail(d ?? "");
        },
      }),
  );

  const editor = useEditor({
    extensions: contentExtensions,
    content: props.content as Record<string, unknown>,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "ajaia-editor" } },
    onUpdate: ({ editor: e }) => {
      autosave.setContent(e.getJSON());
    },
  });

  // On unmount (including in-app navigation that bypassed leave()), keep
  // saving in the background: the page is still alive, so the request completes.
  useEffect(
    () => () => {
      autosave.dispose();
      void autosave.flushNow();
    },
    [autosave],
  );

  // Browser-level leave warning (reload, close tab, external navigation).
  useEffect(() => {
    if (status === "saved") return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!allowUnload.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  // In-app navigation: save first, and only leave silently if everything saved.
  async function leave() {
    setLeaving(true);
    const clean = await autosave.flushNow();
    if (clean || window.confirm("Some changes could not be saved. Leave anyway and lose them?")) {
      router.push("/documents");
      router.refresh();
    } else {
      setLeaving(false);
    }
  }

  function onTitleChange(value: string) {
    setTitle(value);
    autosave.setTitle(value);
  }

  function onTitleBlur() {
    // The server stores an empty title as "Untitled document"; show the same.
    if (title.trim() === "") onTitleChange("Untitled document");
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
        <button
          type="button"
          onClick={() => void leave()}
          disabled={leaving}
          className="text-zinc-500 hover:underline disabled:opacity-50"
        >
          {leaving ? "Saving…" : "← All documents"}
        </button>
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
                allowUnload.current = true;
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
          onBlur={onTitleBlur}
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
