import { notFound, redirect } from "next/navigation";

import DocumentEditor from "@/components/document-editor";
import { getSessionUser } from "@/lib/auth";
import { getDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;

  // null for unknown AND unauthorized documents: identical not-found page.
  const doc = await getDocument(user.id, id);
  if (!doc) notFound();

  return (
    <DocumentEditor
      id={doc.id}
      title={doc.title}
      content={doc.content}
      version={doc.version}
      role={doc.role}
      ownerName={doc.ownerName}
      collaborators={doc.collaborators}
    />
  );
}
