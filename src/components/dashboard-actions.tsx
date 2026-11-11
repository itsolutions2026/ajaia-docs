"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function NewDocumentButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/documents", { method: "POST" });
      if (!res.ok) throw new Error();
      const { id } = (await res.json()) as { id: string };
      router.push(`/documents/${id}`);
    } catch {
      setError("Couldn't create the document. Try again.");
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        New document
      </button>
      {error && <span className="ml-3 text-sm text-red-600">{error}</span>}
    </span>
  );
}

export function ImportButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!/\.(txt|md)$/i.test(file.name)) {
      setError("Unsupported file type. Use .txt or .md.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("File is too large (maximum 1 MB).");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/documents/import", { method: "POST", body: form });
      const data = (await res.json()) as { id?: string; error?: { message: string } };
      if (!res.ok || !data.id) {
        setError(data.error?.message ?? "Import failed.");
        setBusy(false);
        return;
      }
      router.push(`/documents/${data.id}`);
    } catch {
      setError("Import failed. Check your connection and try again.");
      setBusy(false);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  return (
    <span>
      <input
        ref={input}
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {busy ? "Importing…" : "Import .txt / .md"}
      </button>
      {error && (
        <span role="alert" className="ml-3 text-sm text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="text-sm text-zinc-500 hover:underline">
      Sign out
    </button>
  );
}
