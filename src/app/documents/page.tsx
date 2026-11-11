import Link from "next/link";
import { redirect } from "next/navigation";

import { ImportButton, LogoutButton, NewDocumentButton } from "@/components/dashboard-actions";
import { getSessionUser } from "@/lib/auth";
import { listDocuments, type DocumentSummary } from "@/lib/documents";

export const dynamic = "force-dynamic";

function DocList({ title, docs, empty, showOwner }: { title: string; docs: DocumentSummary[]; empty: string; showOwner?: boolean }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">{title}</h2>
      {docs.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/documents/${d.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="font-medium">{d.title}</span>
                <span className="text-xs text-zinc-500">
                  {showOwner && <>Owned by {d.ownerName} · </>}
                  {new Date(d.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function DocumentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { owned, shared } = await listDocuments(user.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Ajaia Docs</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <NewDocumentButton />
        <ImportButton />
      </div>
      <DocList title="My documents" docs={owned} empty="You have no documents yet. Create one or import a file." />
      <DocList title="Shared with me" docs={shared} empty="Nothing has been shared with you." showOwner />
    </main>
  );
}
